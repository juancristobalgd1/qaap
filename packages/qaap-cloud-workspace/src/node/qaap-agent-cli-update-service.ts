// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import {
    isVersionOutdated,
    parseCliVersion,
    type QaapAgentCliUpdateInfo,
    type QaapAgentCliUpdateResult,
    type QaapAgentCliUpdatesResponse,
} from '@theia/qaap-agents-ui/lib/common/qaap-agent-cli-update';
import { isQaapProductionRuntime } from './qaap-agent-spawn-identity';
import { stripBackendOnlyEnv } from './qaap-child-process-env';
import { resolveQaapWritableHome } from './qaap-writable-home';
import { QAAP_HARNESS_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    canExposeAgentCliBinToChild,
    prependAgentCliBinToPath,
    resolveAgentCliPrefix,
    resolveAgentCliPrefixBinDirectory,
} from './qaap-agent-cli-prefix';
import {
    currentProcessUid,
    filterTrustedPath,
    findExecutableOnPath,
    readEnvPath,
    resolveTrustedExecutable,
    resolveTrustedSystemExecutable,
} from './qaap-trusted-executable';

/** Retained for compatibility with older configuration; this flag never bypasses the agent uid. */
export const QAAP_ALLOW_IN_PLACE_CLI_UPDATE = 'QAAP_ALLOW_IN_PLACE_CLI_UPDATE';

/**
 * Production supports installs only when lifecycle scripts can run under a configured non-root uid.
 * The legacy override is intentionally ignored.
 */
export function isInPlaceCliUpdateAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    if (!isQaapProductionRuntime(env)) {
        return true;
    }
    const configuredUid = Number.parseInt(env.QAAP_AGENT_UID?.trim() ?? '', 10);
    // Production installs are only supported when npm lifecycle scripts can run as a non-root
    // tenant uid. The legacy allow-in-place flag never grants permission to run as root.
    return Number.isInteger(configuredUid) && configuredUid > 0;
}

/** npm registry GET timeout — boot toast must never block the backend event loop long. */
const NPM_FETCH_TIMEOUT_MS = 4_000;
/** Cache npm `latest` lookups for the process lifetime (and a short TTL for freshness). */
const NPM_CACHE_TTL_MS = 30 * 60_000;
/** Cap `npm install` so a hung registry cannot wedge the UI action; the process group is killed then. */
const NPM_INSTALL_TIMEOUT_MS = 120_000;
/** Cap `<cli> --version` probes. */
const CLI_VERSION_PROBE_TIMEOUT_MS = 8_000;
/** Cap the writable-prefix check run as the agent uid. */
const PREFIX_WRITABLE_PROBE_TIMEOUT_MS = 5_000;
/** Keep only the tail of child output (npm can be chatty); the UI shows at most 500 characters. */
const MAX_CHILD_OUTPUT_CHARS = 16_000;
/** Install attempts allowed per user within {@link INSTALL_RATE_WINDOW_MS}. */
const MAX_INSTALLS_PER_WINDOW = 5;
const INSTALL_RATE_WINDOW_MS = 10 * 60_000;

/**
 * Environment keys npm may inherit from the backend: locale, temp dirs, proxy/CA settings, registry
 * and cache config, and the Windows system variables npm needs. Everything else (provider API keys,
 * GitHub tokens, backend secrets) is withheld from npm and its lifecycle scripts.
 */
const NPM_ENV_ALLOWLIST = new RegExp('^(?:'
    + 'LANG|LANGUAGE|LC_[A-Z_]+|TZ|TMPDIR|TEMP|TMP'
    + '|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR'
    + '|NPM_CONFIG_(?:CACHE|REGISTRY|PROXY|HTTPS_PROXY|NOPROXY|STRICT_SSL|CAFILE|PREFER_OFFLINE)'
    + '|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMDATA'
    + ')$', 'i');
/** Credential-looking keys are dropped even from the server-built storage overlay. */
const NPM_ENV_SECRET_PATTERN = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|_AUTH)/i;

interface TrackedAgentCli {
    readonly id: string;
    readonly label: string;
    readonly bins: readonly string[];
    readonly npmPackage?: string;
    /**
     * The package only works after its own install script ran. npm runs with `--ignore-scripts`
     * for every other package. Scripts always run as the agent uid with the scrubbed env.
     */
    readonly requiresInstallScripts?: boolean;
    /** Optional env override for a minimum / expected version (skips npm when set and not `latest`). */
    readonly expectedVersionEnv?: string;
}

/**
 * CLIs we can version-check for the boot "Update Available" toast.
 * npm-backed agents support tenant-prefix updates; QAIQ/OpenClaude are shipped in the image.
 */
export const TRACKED_AGENT_CLIS: readonly TrackedAgentCli[] = [
    {
        id: 'codex',
        label: 'Codex',
        bins: ['codex'],
        npmPackage: '@openai/codex',
        expectedVersionEnv: 'CODEX_CLI_VERSION',
    },
    {
        id: 'claude',
        label: 'Claude Code',
        bins: ['claude'],
        npmPackage: '@anthropic-ai/claude-code',
        // postinstall (install.cjs) copies the platform binary over the `bin/claude.exe` placeholder.
        requiresInstallScripts: true,
        expectedVersionEnv: 'CLAUDE_CODE_VERSION',
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        bins: ['opencode'],
        npmPackage: 'opencode-ai',
        // postinstall (postinstall.mjs) replaces the `bin/opencode.exe` placeholder with the platform binary.
        requiresInstallScripts: true,
        expectedVersionEnv: 'OPENCODE_CLI_VERSION',
    },
    {
        id: 'copilot',
        label: 'Copilot CLI',
        bins: ['copilot'],
        npmPackage: '@github/copilot',
        expectedVersionEnv: 'COPILOT_CLI_VERSION',
    },
    {
        id: 'antigravity',
        label: 'Antigravity CLI',
        bins: ['antigravity', 'agy', 'ag'],
        npmPackage: '@sanchaymittal/antigravity-cli',
        expectedVersionEnv: 'ANTIGRAVITY_CLI_VERSION',
    },
    {
        id: 'qaiq',
        label: 'QAIQ',
        bins: ['qaiq'],
        // No public npm package — Docker rebuild / QAIQ_REF bump is the real update path.
        expectedVersionEnv: 'QAAP_QAIQ_MIN_VERSION',
    },
    {
        id: 'openclaude',
        label: 'OpenClaude',
        bins: ['openclaude'],
        // The OpenClaude harness is shipped alongside QAIQ; rebuild the image to update it.
        expectedVersionEnv: 'QAAP_QAIQ_MIN_VERSION',
    },
];

interface NpmLatestCacheEntry {
    readonly version: string | undefined;
    readonly at: number;
}

interface NpmInstallResult {
    readonly status: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error?: Error;
}

export interface QaapAgentCliInstallTarget {
    /** HOME of the npm process (the agent's HOME). */
    readonly home: string;
    /** npm `--prefix`; defaults to `<home>/.qaap/cli`. */
    readonly prefix?: string;
    /** Agent uid; when omitted the agent runs as the backend user. */
    readonly uid?: number;
    readonly gid?: number;
    readonly user?: string;
    /** Extra child env for the agent (e.g. relocated npm cache on a read-only rootfs). */
    readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface QaapNpmAgentTarget {
    readonly prefix: string;
    readonly uid: number;
    readonly gid: number;
}

interface ResolvedNpmInstallTarget extends QaapAgentCliInstallTarget {
    readonly home: string;
    readonly prefix: string;
    readonly binDirectory: string;
    readonly uid: number;
    readonly gid: number;
    readonly user?: string;
}

/** Message for a harness whose CLI has no package this server can install. */
export function packagelessHarnessInstallMessage(label: string): string {
    return `${label} has no installable package on this server yet. Ask your administrator to add it to the Qaap image.`;
}

export interface QaapNpmInstallInvocation {
    readonly file: string;
    readonly args: readonly string[];
    readonly shell: boolean;
}

export interface QaapNpmInstallInvocationOptions {
    readonly backendUid?: number;
    readonly platform?: NodeJS.Platform;
    /** Absolute, root-owned `setpriv`; required when a root backend drops to the agent uid. */
    readonly setprivPath?: string;
    /** Run the package's own install scripts (only packages that need them, see `requiresInstallScripts`). */
    readonly runInstallScripts?: boolean;
}

/** `setpriv` options that drop to the agent uid without supplementary groups, capabilities or setuid gains. */
export function buildQaapSetprivDropArgs(uid: number, gid: number): string[] {
    return [
        '--reuid', String(uid),
        '--regid', String(gid),
        '--clear-groups',
        '--no-new-privs',
        '--inh-caps=-all',
        '--bounding-set=-all',
    ];
}

/** Build an argv-only npm command; lifecycle scripts run only for packages that cannot work without them. */
export function buildQaapNpmInstallInvocation(
    npmPackage: string,
    target: QaapNpmAgentTarget,
    options: QaapNpmInstallInvocationOptions = {},
): QaapNpmInstallInvocation {
    const platform = options.platform ?? process.platform;
    const npmExecutable = platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmArgs = [
        'install',
        '-g',
        '--prefix',
        target.prefix,
        options.runInstallScripts ? '--ignore-scripts=false' : '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `${npmPackage}@latest`,
    ];
    if (options.backendUid === 0 && target.uid !== 0) {
        if (!options.setprivPath) {
            throw new Error('setpriv was not found in a root-owned system directory; refusing to run npm as root.');
        }
        const gid = target.gid || target.uid;
        return {
            file: options.setprivPath,
            args: [...buildQaapSetprivDropArgs(target.uid, gid), '--', npmExecutable, ...npmArgs],
            shell: false,
        };
    }
    return {
        file: npmExecutable,
        args: npmArgs,
        shell: platform === 'win32',
    };
}

/**
 * Probes installed agent CLIs, compares against npm `latest` (or env pins), and can attempt
 * a tenant-scoped `npm install -g --prefix` for whitelisted packages.
 *
 * Nothing here executes a CLI from the tenant prefix with the backend's privileges: detection is an
 * in-process PATH lookup, and `--version` probes and npm run as the agent uid when the backend is root.
 * Installs are asynchronous, serialized per prefix and rate limited per user.
 *
 * Disable entirely with `QAAP_AGENT_CLI_UPDATE_CHECK=0` (air-gapped / CI).
 */
@injectable()
export class QaapAgentCliUpdateService {

    protected readonly npmLatestCache = new Map<string, NpmLatestCacheEntry>();
    protected readonly listInFlightByPrefix = new Map<string, Promise<QaapAgentCliUpdatesResponse>>();
    protected readonly installsInFlightByPrefix = new Map<string, Promise<QaapAgentCliUpdateResult>>();
    protected readonly installStartsByUser = new Map<string, number[]>();
    protected setprivExecutable: string | undefined;

    isUpdateCheckEnabled(): boolean {
        const raw = process.env.QAAP_AGENT_CLI_UPDATE_CHECK?.trim().toLowerCase();
        return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
    }

    isInPlaceCliUpdateAllowed(): boolean {
        return isInPlaceCliUpdateAllowed();
    }

    isInstallSupported(): boolean {
        return this.isInstallSupportedForTarget();
    }

    /** Whether this target can install whitelisted packages without running npm as a foreign or root uid. */
    isInstallSupportedForTarget(target?: QaapAgentCliInstallTarget): boolean {
        if (!this.isUpdateCheckEnabled() || (!target && !this.isInPlaceCliUpdateAllowed())) {
            return false;
        }
        const resolved = this.resolveNpmInstallTarget(target);
        if (!resolved) {
            return false;
        }
        const backendUid = this.backendUid();
        if (backendUid === 0 && resolved.uid !== 0) {
            return this.isSetprivAvailable();
        }
        return backendUid === undefined || backendUid === resolved.uid;
    }

    /** Whether this harness has a whitelisted npm package at all (independent of server policy). */
    hasInstallablePackage(agentId: string): boolean {
        return !!TRACKED_AGENT_CLIS.find(entry => entry.id === agentId.trim().toLowerCase())?.npmPackage;
    }

    /** Whether this harness has a whitelisted npm package and the current server permits installs. */
    isAgentInstallSupported(agentId: string, target?: QaapAgentCliInstallTarget): boolean {
        const tracked = TRACKED_AGENT_CLIS.find(entry => entry.id === agentId.trim().toLowerCase());
        return !!tracked?.npmPackage && this.isInstallSupportedForTarget(target);
    }

    /** Outdated CLIs only — empty when check disabled or everything is current. */
    async listOutdated(requestedTarget?: QaapAgentCliInstallTarget): Promise<QaapAgentCliUpdatesResponse> {
        if (!this.isUpdateCheckEnabled()) {
            return { updates: [] };
        }
        const target = this.resolveNpmInstallTarget(requestedTarget);
        const cacheKey = target?.prefix ?? '';
        let inFlight = this.listInFlightByPrefix.get(cacheKey);
        if (!inFlight) {
            inFlight = this.collectOutdated(target).finally(() => {
                this.listInFlightByPrefix.delete(cacheKey);
            });
            this.listInFlightByPrefix.set(cacheKey, inFlight);
        }
        return inFlight;
    }

    /**
     * Best-effort tenant-prefix install/update for a whitelisted npm package.
     * QAIQ and unknown agents return a clear non-ok message (no shell injection — id is mapped).
     * Only one install runs per prefix (`reason: 'busy'` otherwise) and each user (`userKey`, else the
     * prefix) gets {@link MAX_INSTALLS_PER_WINDOW} attempts per window (`reason: 'rate-limited'`).
     */
    async installUpdate(
        agentId: string,
        requestedTarget?: QaapAgentCliInstallTarget,
        options: { readonly userKey?: string } = {},
    ): Promise<QaapAgentCliUpdateResult> {
        const id = agentId.trim().toLowerCase();
        if (!this.isUpdateCheckEnabled()) {
            return {
                ok: false,
                id,
                reason: 'refused',
                message: 'Agent CLI update checks are disabled (QAAP_AGENT_CLI_UPDATE_CHECK=0).',
            };
        }
        const tracked = TRACKED_AGENT_CLIS.find(entry => entry.id === id);
        if (!tracked) {
            const harness = QAAP_HARNESS_DEFINITIONS.find(definition => definition.id === id);
            return harness
                ? { ok: false, id, reason: 'refused', message: packagelessHarnessInstallMessage(harness.label) }
                : { ok: false, id, message: `Unknown agent CLI: ${agentId}` };
        }
        if (!tracked.npmPackage) {
            return {
                ok: false,
                id: tracked.id,
                reason: 'refused',
                message: `${tracked.label} is not updated in-place. Rebuild the Qaap image (or bump QAIQ_REF) to pick up a newer CLI.`,
            };
        }
        if (!this.isInstallSupportedForTarget(requestedTarget)) {
            return {
                ok: false,
                id,
                reason: 'refused',
                message: 'Installation is not available with the configured tenant user on this server.',
            };
        }
        const target = this.resolveNpmInstallTarget(requestedTarget);
        if (!target) {
            return {
                ok: false,
                id: tracked.id,
                reason: 'refused',
                message: 'Installation requires a writable tenant home and a non-root agent uid.',
            };
        }
        if (this.installsInFlightByPrefix.has(target.prefix)) {
            return {
                ok: false,
                id: tracked.id,
                reason: 'busy',
                message: 'Another harness installation is already running for this user. Try again when it finishes.',
            };
        }
        if (!this.tryStartInstallForUser(options.userKey ?? target.prefix)) {
            return {
                ok: false,
                id: tracked.id,
                reason: 'rate-limited',
                message: 'Too many harness installations. Wait a few minutes and try again.',
            };
        }
        // The lock is taken synchronously, before the first await, so concurrent requests see it.
        const install = this.installLocked(tracked, tracked.npmPackage, target).finally(() => {
            this.installsInFlightByPrefix.delete(target.prefix);
        });
        this.installsInFlightByPrefix.set(target.prefix, install);
        return install;
    }

    protected async installLocked(
        tracked: TrackedAgentCli,
        npmPackage: string,
        target: ResolvedNpmInstallTarget,
    ): Promise<QaapAgentCliUpdateResult> {
        if (!await this.isInstallPrefixWritableAsTarget(target.prefix, target.uid, target.gid)) {
            return {
                ok: false,
                id: tracked.id,
                reason: 'refused',
                message: 'Installation requires a writable tenant directory; the CLI prefix is read-only or owned by another user.',
            };
        }
        const install = await this.runNpmInstall(npmPackage, target, !!tracked.requiresInstallScripts);
        if (install.error || install.status !== 0) {
            const detail = [
                install.stderr.trim(),
                install.stdout.trim(),
                install.error?.message,
                install.signal ? `npm install was terminated by ${install.signal}.` : undefined,
                install.status === null ? 'npm install did not exit normally.' : undefined,
            ].find(value => !!value) ?? 'npm install failed without a diagnostic.';
            return {
                ok: false,
                id: tracked.id,
                reason: 'failed',
                message: `${tracked.label} update failed: ${detail}`.slice(0, 500),
            };
        }
        // Invalidate cached latest so the next list re-probes.
        this.npmLatestCache.delete(npmPackage);
        const probed = await this.probeInstalled(tracked, target);
        return {
            ok: true,
            id: tracked.id,
            installedVersion: probed.version,
            message: probed.version
                ? `${tracked.label} updated to v${probed.version}`
                : `${tracked.label} update finished`,
        };
    }

    /** Sliding-window limit on install attempts per user. */
    protected tryStartInstallForUser(userKey: string, now: number = Date.now()): boolean {
        const recent = (this.installStartsByUser.get(userKey) ?? []).filter(at => now - at < INSTALL_RATE_WINDOW_MS);
        if (recent.length >= MAX_INSTALLS_PER_WINDOW) {
            this.installStartsByUser.set(userKey, recent);
            return false;
        }
        recent.push(now);
        this.installStartsByUser.set(userKey, recent);
        return true;
    }

    protected async runNpmInstall(
        npmPackage: string,
        target: ResolvedNpmInstallTarget,
        runInstallScripts: boolean,
    ): Promise<NpmInstallResult> {
        let invocation: QaapNpmInstallInvocation;
        try {
            const backendUid = this.backendUid();
            invocation = buildQaapNpmInstallInvocation(npmPackage, target, {
                backendUid,
                setprivPath: backendUid === 0 && target.uid !== 0 ? this.resolveSetprivExecutable() : undefined,
                runInstallScripts,
            });
        } catch (error) {
            return { status: null, signal: null, stdout: '', stderr: '', error: error as Error };
        }
        return this.runBoundedProcess(invocation.file, invocation.args, {
            cwd: this.nearestExistingDirectory(target.prefix),
            env: this.npmEnvironment(target),
            shell: invocation.shell,
            timeoutMs: NPM_INSTALL_TIMEOUT_MS,
        });
    }

    /**
     * Asynchronous spawn with a hard timeout: the whole process group is killed when it expires, and
     * only the tail of the output is kept. Never blocks the backend event loop.
     */
    protected runBoundedProcess(
        file: string,
        args: readonly string[],
        options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly shell?: boolean; readonly timeoutMs: number },
    ): Promise<NpmInstallResult> {
        return new Promise<NpmInstallResult>(resolve => {
            let child: ChildProcess;
            try {
                child = spawn(file, [...args], {
                    cwd: options.cwd,
                    env: options.env,
                    shell: options.shell ?? false,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                    detached: process.platform !== 'win32',
                });
            } catch (error) {
                resolve({ status: null, signal: null, stdout: '', stderr: '', error: error as Error });
                return;
            }
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let settled = false;
            const appendTail = (current: string, chunk: Buffer): string => (current + chunk.toString('utf8')).slice(-MAX_CHILD_OUTPUT_CHARS);
            child.stdout?.on('data', (chunk: Buffer) => {
                stdout = appendTail(stdout, chunk);
            });
            child.stderr?.on('data', (chunk: Buffer) => {
                stderr = appendTail(stderr, chunk);
            });
            const timer = setTimeout(() => {
                timedOut = true;
                this.killProcessTree(child);
            }, options.timeoutMs);
            const finish = (result: NpmInstallResult): void => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(result);
                }
            };
            child.on('error', error => finish({ status: null, signal: null, stdout, stderr, error }));
            child.on('close', (status, signal) => finish({
                status: timedOut ? null : status,
                signal,
                stdout,
                stderr,
                error: timedOut ? new Error(`${path.basename(file)} timed out after ${Math.round(options.timeoutMs / 1000)} s.`) : undefined,
            }));
        });
    }

    protected killProcessTree(child: ChildProcess): void {
        try {
            if (child.pid !== undefined && process.platform !== 'win32') {
                process.kill(-child.pid, 'SIGKILL');
                return;
            }
        } catch {
            // Fall through to killing the direct child.
        }
        child.kill('SIGKILL');
    }

    /**
     * Allowlisted environment for npm and its lifecycle scripts (see {@link NPM_ENV_ALLOWLIST}): no
     * provider keys, tokens or backend secrets. PATH keeps only directories the backend uid trusts,
     * plus the CLI prefix when the process runs as the agent uid or the prefix is root-trusted.
     */
    protected npmEnvironment(target: ResolvedNpmInstallTarget): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && NPM_ENV_ALLOWLIST.test(key)) {
                env[key] = value;
            }
        }
        for (const [key, value] of Object.entries(target.env ?? {})) {
            if (value !== undefined && !NPM_ENV_SECRET_PATTERN.test(key)) {
                env[key] = value;
            }
        }
        stripBackendOnlyEnv(env);
        for (const key of Object.keys(env)) {
            if (key.toLowerCase() === 'path') {
                delete env[key];
            }
        }
        env.PATH = filterTrustedPath(readEnvPath(process.env), this.backendUid());
        env.HOME = target.home;
        env.USER = target.user || String(target.uid);
        env.LOGNAME = target.user || String(target.uid);
        if (canExposeAgentCliBinToChild(target.prefix, () => target.uid !== 0, this.backendUid())) {
            prependAgentCliBinToPath(env, target.prefix);
        }
        return env;
    }

    /** Uid of the backend process; `undefined` where POSIX uids do not exist. Overridable in tests. */
    protected backendUid(): number | undefined {
        return currentProcessUid();
    }

    /**
     * A local (non-production) backend running as root without an agent identity installs as itself
     * into its own home — devcontainers and Codespaces usually run as root. Production never does.
     */
    protected isLocalRootInstallAllowed(target?: QaapAgentCliInstallTarget): boolean {
        return !isQaapProductionRuntime(process.env) && this.backendUid() === 0 && target?.uid === undefined;
    }

    protected resolveInstallUid(target?: QaapAgentCliInstallTarget): number | undefined {
        const configuredUid = Number.parseInt(process.env.QAAP_AGENT_UID?.trim() ?? '', 10);
        const currentUid = this.backendUid();
        // A target without a uid means the agent runs as the backend user (no privilege drop).
        const uid = target
            ? target.uid ?? currentUid
            : Number.isInteger(configuredUid) ? configuredUid : currentUid;
        if (typeof uid !== 'number' || !Number.isInteger(uid)) {
            return undefined;
        }
        if (uid > 0) {
            return uid;
        }
        return uid === 0 && this.isLocalRootInstallAllowed(target) ? 0 : undefined;
    }

    protected resolveNpmInstallTarget(target?: QaapAgentCliInstallTarget): ResolvedNpmInstallTarget | undefined {
        const uid = this.resolveInstallUid(target);
        if (uid === undefined) {
            return undefined;
        }
        const rawHome = target?.home?.trim() || process.env.QAAP_AGENT_HOME?.trim() || os.homedir();
        if (!path.isAbsolute(rawHome)) {
            return undefined;
        }
        const home = path.resolve(rawHome);
        const rawPrefix = target?.prefix?.trim() || resolveAgentCliPrefix(home);
        if (!path.isAbsolute(rawPrefix)) {
            return undefined;
        }
        const prefix = path.resolve(rawPrefix);
        const ownHomeAllowed = uid === 0;
        if (!this.isAllowedInstallPath(home, ownHomeAllowed) || !this.isAllowedInstallPath(prefix, ownHomeAllowed) || prefix === home) {
            return undefined;
        }
        // HOME may sit on a private tmpfs, but the installed CLIs must survive a restart.
        if (isQaapProductionRuntime(process.env) && (prefix === '/tmp' || prefix.startsWith(`/tmp${path.sep}`))) {
            return undefined;
        }
        const currentUid = this.backendUid();
        if (currentUid !== undefined && currentUid !== 0 && currentUid !== uid) {
            return undefined;
        }
        const configuredGid = Number.parseInt(process.env.QAAP_AGENT_GID?.trim() ?? '', 10);
        const requestedGid = target?.gid;
        const gid = uid === 0
            ? 0
            : requestedGid !== undefined && Number.isInteger(requestedGid) && requestedGid > 0
                ? requestedGid
                : Number.isInteger(configuredGid) && configuredGid > 0 ? configuredGid : uid;
        return {
            // npm writes its cache and logs under HOME: on a read-only HOME (rootless production
            // `/home/theia`) that fails with `ENOENT … mkdir`, so use a home next to the prefix.
            home: resolveQaapWritableHome(home, path.dirname(prefix)),
            prefix,
            binDirectory: resolveAgentCliPrefixBinDirectory(prefix),
            uid,
            gid,
            user: target?.user,
            env: target?.env,
        };
    }

    /**
     * Never install into the filesystem root, root's home or system directories. A local root install
     * ({@link isLocalRootInstallAllowed}) may use the backend user's own home, which is `/root` there.
     */
    protected isAllowedInstallPath(candidate: string, ownHomeAllowed: boolean = false): boolean {
        if (candidate === path.parse(candidate).root) {
            return false;
        }
        const ownHome = path.resolve(os.homedir());
        if (ownHomeAllowed && (candidate === ownHome || candidate.startsWith(`${ownHome}${path.sep}`))) {
            return true;
        }
        const blockedRoots = ['/root', '/usr', '/opt', '/etc', '/bin', '/sbin', '/lib'];
        return !blockedRoots.some(blocked => candidate === blocked || candidate.startsWith(`${blocked}${path.sep}`));
    }

    protected nearestExistingDirectory(candidate: string): string {
        let current = candidate;
        while (!fs.existsSync(current)) {
            const parent = path.dirname(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }
        return current;
    }

    /** Whether the agent uid can create (or write) the npm prefix: checks its nearest existing ancestor. */
    protected async isInstallPrefixWritableAsTarget(prefix: string, uid: number, gid: number): Promise<boolean> {
        const existing = this.nearestExistingDirectory(prefix);
        const currentUid = this.backendUid();
        if (currentUid !== 0 || uid === 0) {
            if (currentUid !== undefined && currentUid !== uid) {
                return false;
            }
            try {
                await fs.promises.access(existing, fs.constants.W_OK);
                return true;
            } catch {
                return false;
            }
        }
        const setpriv = this.resolveSetprivExecutable();
        if (!setpriv) {
            return false;
        }
        const result = await this.runBoundedProcess(setpriv, [
            ...buildQaapSetprivDropArgs(uid, gid),
            '--',
            '/bin/sh', '-c', 'test -w "$1"',
            'qaap-agent-cli-prefix-check', existing,
        ], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: PREFIX_WRITABLE_PROBE_TIMEOUT_MS });
        return !result.error && result.status === 0;
    }

    /** Absolute, root-owned `setpriv` from a system directory — never resolved through PATH. */
    protected resolveSetprivExecutable(): string | undefined {
        if (!this.setprivExecutable) {
            this.setprivExecutable = resolveTrustedSystemExecutable('setpriv');
        }
        return this.setprivExecutable;
    }

    protected isSetprivAvailable(): boolean {
        return this.resolveSetprivExecutable() !== undefined;
    }

    protected async collectOutdated(target?: ResolvedNpmInstallTarget): Promise<QaapAgentCliUpdatesResponse> {
        const updates: QaapAgentCliUpdateInfo[] = [];
        for (const tracked of TRACKED_AGENT_CLIS) {
            const probed = await this.probeInstalled(tracked, target);
            if (!probed.bin) {
                continue;
            }
            const latestVersion = await this.resolveLatestVersion(tracked);
            if (!latestVersion) {
                continue;
            }
            const installedVersion = probed.version;
            const updateAvailable = isVersionOutdated(installedVersion, latestVersion);
            if (!updateAvailable) {
                continue;
            }
            updates.push({
                id: tracked.id,
                label: tracked.label,
                bin: probed.bin,
                installedVersion,
                latestVersion,
                updateAvailable: true,
                npmPackage: tracked.npmPackage,
                updateSupported: !!tracked.npmPackage && this.isAgentInstallSupported(tracked.id, target),
            });
        }
        return { updates };
    }

    /**
     * Find a tracked CLI (in-process lookup) and read its version. A root backend runs a tenant
     * target's `--version` as the agent uid through `setpriv`; otherwise only a binary the backend uid
     * trusts is executed.
     */
    protected async probeInstalled(
        tracked: TrackedAgentCli,
        target?: ResolvedNpmInstallTarget,
    ): Promise<{ bin?: string; version?: string }> {
        const env = target ? this.npmEnvironment(target) : { ...process.env };
        const backendUid = this.backendUid();
        const dropsToTarget = !!target && backendUid === 0 && target.uid !== 0;
        for (const bin of tracked.bins) {
            const found = findExecutableOnPath(bin, readEnvPath(env));
            if (!found) {
                continue;
            }
            let file: string | undefined;
            let args: string[];
            if (dropsToTarget && target) {
                file = this.resolveSetprivExecutable();
                args = [...buildQaapSetprivDropArgs(target.uid, target.gid), '--', found, '--version'];
            } else {
                file = resolveTrustedExecutable(bin, env, backendUid);
                args = ['--version'];
            }
            if (!file) {
                return { bin };
            }
            const probe = await this.runBoundedProcess(file, args, {
                cwd: target?.home,
                env,
                timeoutMs: CLI_VERSION_PROBE_TIMEOUT_MS,
            });
            const raw = `${probe.stdout}\n${probe.stderr}`.trim();
            return { bin, version: parseCliVersion(raw) };
        }
        return {};
    }

    protected async resolveLatestVersion(tracked: TrackedAgentCli): Promise<string | undefined> {
        if (tracked.npmPackage) {
            const fromNpm = await this.fetchNpmLatest(tracked.npmPackage);
            if (fromNpm) {
                return fromNpm;
            }
        }
        // Fallback when registry is unreachable (air-gapped) or the agent has no npm package (QAIQ).
        return this.readExpectedVersionFromEnv(tracked.expectedVersionEnv);
    }

    /**
     * Use a concrete env pin (e.g. `CODEX_CLI_VERSION=0.145.0`) as the comparison target.
     * Values of `latest` / empty are ignored so we fall through to the npm registry.
     */
    protected readExpectedVersionFromEnv(envName: string | undefined): string | undefined {
        if (!envName) {
            return undefined;
        }
        const raw = process.env[envName]?.trim();
        if (!raw || raw.toLowerCase() === 'latest') {
            return undefined;
        }
        return parseCliVersion(raw) ?? (/^\d+\.\d+\.\d+/.test(raw) ? raw : undefined);
    }

    protected async fetchNpmLatest(npmPackage: string): Promise<string | undefined> {
        const cached = this.npmLatestCache.get(npmPackage);
        if (cached && Date.now() - cached.at < NPM_CACHE_TTL_MS) {
            return cached.version;
        }
        const version = await this.requestNpmLatest(npmPackage);
        this.npmLatestCache.set(npmPackage, { version, at: Date.now() });
        return version;
    }

    protected requestNpmLatest(npmPackage: string): Promise<string | undefined> {
        const encoded = npmPackage.split('/').map(encodeURIComponent).join('/');
        const url = `https://registry.npmjs.org/${encoded}/latest`;
        return new Promise(resolve => {
            const req = https.get(url, { timeout: NPM_FETCH_TIMEOUT_MS, headers: { Accept: 'application/json' } }, res => {
                if (res.statusCode && res.statusCode >= 400) {
                    res.resume();
                    resolve(undefined);
                    return;
                }
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { version?: unknown };
                        resolve(typeof body.version === 'string' ? parseCliVersion(body.version) ?? body.version : undefined);
                    } catch {
                        resolve(undefined);
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(undefined);
            });
            req.on('error', () => resolve(undefined));
        });
    }
}

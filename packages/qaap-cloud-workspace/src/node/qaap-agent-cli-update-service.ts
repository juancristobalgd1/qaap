// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
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
import { isOnPath } from './qaap-agent-task-runner-utils';
import { childProcessEnv } from './qaap-child-process-env';
import { QAAP_HARNESS_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    prependAgentCliBinToPath,
    resolveAgentCliPrefix,
    resolveAgentCliPrefixBinDirectory,
} from './qaap-agent-cli-prefix';

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
/** Cap `npm install` so a hung registry cannot wedge the UI action. */
const NPM_INSTALL_TIMEOUT_MS = 120_000;
interface TrackedAgentCli {
    readonly id: string;
    readonly label: string;
    readonly bins: readonly string[];
    readonly npmPackage?: string;
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
        expectedVersionEnv: 'CLAUDE_CODE_VERSION',
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        bins: ['opencode'],
        npmPackage: 'opencode-ai',
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

/** Build an argv-only npm command; lifecycle scripts are deliberately retained for these packages. */
export function buildQaapNpmInstallInvocation(
    npmPackage: string,
    target: QaapNpmAgentTarget,
    options: { readonly backendUid?: number; readonly platform?: NodeJS.Platform } = {},
): QaapNpmInstallInvocation {
    const platform = options.platform ?? process.platform;
    const npmExecutable = platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmArgs = [
        'install',
        '-g',
        '--prefix',
        target.prefix,
        '--ignore-scripts=false',
        `${npmPackage}@latest`,
    ];
    if (options.backendUid === 0) {
        const gid = target.gid || target.uid;
        return {
            file: 'setpriv',
            args: ['--reuid', String(target.uid), '--regid', String(gid), '--clear-groups', '--', npmExecutable, ...npmArgs],
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
 * Disable entirely with `QAAP_AGENT_CLI_UPDATE_CHECK=0` (air-gapped / CI).
 */
@injectable()
export class QaapAgentCliUpdateService {

    protected readonly npmLatestCache = new Map<string, NpmLatestCacheEntry>();
    protected readonly listInFlightByPrefix = new Map<string, Promise<QaapAgentCliUpdatesResponse>>();

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

    /** Whether this target can install whitelisted packages without running npm as root. */
    isInstallSupportedForTarget(target?: QaapAgentCliInstallTarget): boolean {
        if (!this.isUpdateCheckEnabled() || (!target && !this.isInPlaceCliUpdateAllowed())) {
            return false;
        }
        const uid = this.resolveInstallUid(target);
        if (uid === undefined || uid <= 0) {
            return false;
        }
        if (!this.resolveNpmInstallTarget(target)) {
            return false;
        }
        if (typeof process.getuid === 'function' && process.getuid() === 0) {
            return this.isSetprivAvailable();
        }
        return typeof process.getuid !== 'function' || process.getuid() === uid;
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
     */
    async installUpdate(agentId: string, requestedTarget?: QaapAgentCliInstallTarget): Promise<QaapAgentCliUpdateResult> {
        const id = agentId.trim().toLowerCase();
        if (!this.isUpdateCheckEnabled()) {
            return {
                ok: false,
                id,
                message: 'Agent CLI update checks are disabled (QAAP_AGENT_CLI_UPDATE_CHECK=0).',
            };
        }
        const tracked = TRACKED_AGENT_CLIS.find(entry => entry.id === id);
        if (!tracked) {
            const harness = QAAP_HARNESS_DEFINITIONS.find(definition => definition.id === id);
            return harness
                ? { ok: false, id, message: packagelessHarnessInstallMessage(harness.label) }
                : { ok: false, id, message: `Unknown agent CLI: ${agentId}` };
        }
        if (!tracked.npmPackage) {
            return {
                ok: false,
                id: tracked.id,
                message: `${tracked.label} is not updated in-place. Rebuild the Qaap image (or bump QAIQ_REF) to pick up a newer CLI.`,
            };
        }
        if (!this.isInstallSupportedForTarget(requestedTarget)) {
            return {
                ok: false,
                id,
                message: 'Installation is not available with the configured tenant user on this server.',
            };
        }
        const target = this.resolveNpmInstallTarget(requestedTarget);
        if (!target) {
            return {
                ok: false,
                id: tracked.id,
                message: 'Installation requires a writable tenant home and a non-root agent uid.',
            };
        }
        if (!this.isInstallPrefixWritableAsTarget(target.prefix, target.uid, target.gid)) {
            return {
                ok: false,
                id: tracked.id,
                message: 'Installation requires a writable tenant directory; the CLI prefix is read-only or owned by another user.',
            };
        }
        const install = this.runNpmInstall(tracked.npmPackage, target);
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
                message: `${tracked.label} update failed: ${detail}`.slice(0, 500),
            };
        }
        // Invalidate cached latest so the next list re-probes.
        this.npmLatestCache.delete(tracked.npmPackage);
        const probed = this.probeInstalled(tracked, target);
        return {
            ok: true,
            id: tracked.id,
            installedVersion: probed.version,
            message: probed.version
                ? `${tracked.label} updated to v${probed.version}`
                : `${tracked.label} update finished`,
        };
    }

    protected runNpmInstall(npmPackage: string, target: ResolvedNpmInstallTarget): NpmInstallResult {
        let invocation: QaapNpmInstallInvocation;
        try {
            invocation = buildQaapNpmInstallInvocation(npmPackage, target, {
                backendUid: typeof process.getuid === 'function' ? process.getuid() : undefined,
            });
        } catch (error) {
            return { status: null, signal: null, stdout: '', stderr: '', error: error as Error };
        }
        return spawnSync(invocation.file, [...invocation.args], {
            cwd: this.nearestExistingDirectory(target.prefix),
            encoding: 'utf8',
            timeout: NPM_INSTALL_TIMEOUT_MS,
            env: this.npmEnvironment(target),
            shell: invocation.shell,
        });
    }

    protected npmEnvironment(target: ResolvedNpmInstallTarget): NodeJS.ProcessEnv {
        const env = childProcessEnv();
        for (const [key, value] of Object.entries(target.env ?? {})) {
            if (value !== undefined) {
                env[key] = value;
            }
        }
        env.HOME = target.home;
        env.QAAP_AGENT_HOME = target.home;
        env.USER = target.user || String(target.uid);
        env.LOGNAME = target.user || String(target.uid);
        prependAgentCliBinToPath(env, target.prefix);
        return env;
    }

    protected resolveInstallUid(target?: QaapAgentCliInstallTarget): number | undefined {
        const configuredUid = Number.parseInt(process.env.QAAP_AGENT_UID?.trim() ?? '', 10);
        const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
        // A target without a uid means the agent runs as the backend user (no privilege drop).
        const uid = target
            ? target.uid ?? currentUid
            : Number.isInteger(configuredUid) ? configuredUid : currentUid;
        return typeof uid === 'number' && Number.isInteger(uid) && uid > 0 ? uid : undefined;
    }

    protected resolveNpmInstallTarget(target?: QaapAgentCliInstallTarget): ResolvedNpmInstallTarget | undefined {
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
        if (!this.isAllowedInstallPath(home) || !this.isAllowedInstallPath(prefix) || prefix === home) {
            return undefined;
        }
        // HOME may sit on a private tmpfs, but the installed CLIs must survive a restart.
        if (isQaapProductionRuntime(process.env) && (prefix === '/tmp' || prefix.startsWith(`/tmp${path.sep}`))) {
            return undefined;
        }
        const uid = this.resolveInstallUid(target);
        if (uid === undefined) {
            return undefined;
        }
        const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
        if (currentUid !== undefined && currentUid !== 0 && currentUid !== uid) {
            return undefined;
        }
        const configuredGid = Number.parseInt(process.env.QAAP_AGENT_GID?.trim() ?? '', 10);
        const requestedGid = target?.gid;
        const gid = requestedGid !== undefined && Number.isInteger(requestedGid) && requestedGid > 0
            ? requestedGid
            : Number.isInteger(configuredGid) && configuredGid > 0 ? configuredGid : uid;
        return {
            home,
            prefix,
            binDirectory: resolveAgentCliPrefixBinDirectory(prefix),
            uid,
            gid,
            user: target?.user,
            env: target?.env,
        };
    }

    /** Never install into the filesystem root, root's home or system directories. */
    protected isAllowedInstallPath(candidate: string): boolean {
        if (candidate === path.parse(candidate).root) {
            return false;
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
    protected isInstallPrefixWritableAsTarget(prefix: string, uid: number, gid: number): boolean {
        const existing = this.nearestExistingDirectory(prefix);
        const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
        if (currentUid !== 0) {
            if (currentUid !== undefined && currentUid !== uid) {
                return false;
            }
            try {
                fs.accessSync(existing, fs.constants.W_OK);
                return true;
            } catch {
                return false;
            }
        }
        if (!this.isSetprivAvailable()) {
            return false;
        }
        const result = spawnSync('setpriv', [
            '--reuid', String(uid),
            '--regid', String(gid),
            '--clear-groups',
            '--',
            '/bin/sh', '-c', 'test -w "$1"',
            'qaap-agent-cli-prefix-check', existing,
        ], { stdio: 'ignore', timeout: 5_000 });
        return !result.error && result.status === 0;
    }

    protected isSetprivAvailable(): boolean {
        return isOnPath('setpriv');
    }

    protected async collectOutdated(target?: ResolvedNpmInstallTarget): Promise<QaapAgentCliUpdatesResponse> {
        const updates: QaapAgentCliUpdateInfo[] = [];
        for (const tracked of TRACKED_AGENT_CLIS) {
            const probed = this.probeInstalled(tracked, target);
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

    protected probeInstalled(
        tracked: TrackedAgentCli,
        target?: ResolvedNpmInstallTarget,
    ): { bin?: string; version?: string } {
        const env = target ? this.npmEnvironment(target) : process.env;
        for (const bin of tracked.bins) {
            if (!isOnPath(bin, env)) {
                continue;
            }
            try {
                const probe = spawnSync(bin, ['--version'], {
                    encoding: 'utf8',
                    timeout: 8_000,
                    ...(target ? { cwd: target.home, env } : {}),
                });
                const raw = `${probe.stdout || ''}\n${probe.stderr || ''}`.trim();
                const version = parseCliVersion(raw);
                return { bin, version };
            } catch {
                return { bin };
            }
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

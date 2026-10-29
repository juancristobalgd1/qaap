// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile, spawn, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { quoteShellArg } from './qaap-agent-task-runner-utils';

/** File name of the standalone Codex PreToolUse hook shipped in this package's `resources/`. */
export const QAAP_TOOL_GATE_CODEX_HOOK_FILE = 'qaap-tool-gate-codex-hook.mjs';

/** Margin between the hook timeout and the gate ask window: the gate must always answer first. */
const HOOK_TIMEOUT_MARGIN_SEC = 60;
const STALE_OVERLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HOOK_KEY_SUFFIX = 'pre_tool_use:0:0';
const BASE_PREFIX = 'qaap-codex-gate-';
const MAX_SECRET_FILE_BYTES = 1024 * 1024;
// O_NOFOLLOW does not exist on Windows (where tenant privilege drops do not apply either).
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

interface SafeRead {
    readonly text: string;
    readonly uid: number;
    readonly gid: number;
}

/** Absolute path of the Codex gate hook, resolved from the compiled module location at spawn time. */
export function resolveQaapToolGateCodexHookPath(): string {
    return path.resolve(__dirname, '..', '..', 'resources', QAAP_TOOL_GATE_CODEX_HOOK_FILE);
}

export interface QaapCodexGateOverlayOptions {
    readonly taskId: string;
    /** The workspace Codex runs in. */
    readonly cwd: string;
    /** Per-project folder trust decision: only a trusted folder may load its own `.codex` config and hooks. */
    readonly folderTrusted: boolean;
    /** The Codex home the owner signed in to (`auth.json`, `config.toml`). Read only. */
    readonly sourceCodexHome: string;
    readonly askTtlSec: number;
    /**
     * The OS identity Codex runs as (`setpriv` drop in tenant mode). When it differs from this process,
     * the overlay is created owned by it and the trust probe runs as it: a 0700 root-owned home would be
     * unreadable to Codex and every task would fail.
     */
    readonly agentIdentity?: { readonly uid?: number; readonly gid?: number };
    /** Where overlays live. Defaults to a private directory under the OS temp dir. */
    readonly overlayRoot?: string;
    readonly nodeBin?: string;
    readonly hookPath?: string;
}

export interface QaapCodexGateOverlay {
    /** Value of `CODEX_HOME` for the Codex process. */
    readonly codexHome: string;
    /** Writes a refreshed `auth.json` back to the owner's home, then deletes the overlay. Idempotent. */
    dispose(): void;
}

/** Checks that Codex really considers the generated hook trusted. Injectable so tests need no Codex binary. */
export type QaapCodexHookTrustProbe = (codexHome: string, cwd: string, env: NodeJS.ProcessEnv, identity?: { uid: number; gid?: number }) => Promise<'trusted' | 'untrusted' | 'missing'>;

/**
 * Builds the per-task `CODEX_HOME` that routes every Codex tool call through the Qaap gate.
 *
 * Contract (verified on codex-cli 0.165, see doc/qaap-codex-tool-gate.md):
 * - A hook is only run once its content hash is trusted in `config.toml` (`hooks.state`), and an
 *   untrusted hook is skipped silently, so a wrong hash would let tools run UNGATED. The hash is
 *   therefore computed locally and confirmed against Codex itself (`hooks/list`) once per Codex
 *   version; a mismatch fails the spawn.
 * - `codex exec` trusts its own cwd by writing a `[projects]` entry. An explicit `untrusted` entry is
 *   honoured and keeps project hooks and project config out; this is why untrusted folders get one.
 * - A hook that crashes or times out lets the tool run, so the command ends in `|| exit 2`.
 */
export class QaapCodexGateOverlayBuilder {

    protected readonly verifiedVersions = new Set<string>();

    constructor(protected readonly probe: QaapCodexHookTrustProbe = QaapCodexGateOverlayBuilder.probeWithAppServer) { }

    async create(options: QaapCodexGateOverlayOptions, env: NodeJS.ProcessEnv = process.env): Promise<QaapCodexGateOverlay> {
        const drop = this.resolveDrop(options.agentIdentity);
        // Codex keys hook trust by the CANONICAL hooks.json path (macOS /var -> /private/var): a symlinked
        // path would leave the hook untrusted, and an untrusted hook is skipped silently.
        const base = QaapCodexGateOverlayBuilder.canonical(this.resolveBase(options.overlayRoot, drop));
        this.sweepStale(base);
        // Root-owned 0700 until everything is written, so the agent cannot plant links while root builds.
        const taskDir = fs.mkdtempSync(path.join(base, `${QaapCodexGateOverlayBuilder.safeSegment(options.taskId)}-`));
        const codexHome = path.join(taskDir, 'codex-home');
        fs.mkdirSync(codexHome, { mode: 0o700 });
        const overlayAuth = path.join(codexHome, 'auth.json');
        const sourceAuth = path.join(options.sourceCodexHome, 'auth.json');
        const expectedUid = drop ? drop.uid : QaapCodexGateOverlayBuilder.currentUid();
        let initialAuth: SafeRead | undefined;
        let disposed = false;
        const dispose = (): void => {
            if (disposed) {
                return;
            }
            disposed = true;
            if (drop) {
                // The overlay and the owner's home belong to the agent uid: root never walks them by path.
                this.finishAsAgent(drop, taskDir, overlayAuth, sourceAuth, initialAuth?.text);
            } else {
                this.writeBackRefreshedAuth(taskDir, codexHome, overlayAuth, sourceAuth, initialAuth, expectedUid);
                this.removeTaskTree(taskDir);
            }
        };
        try {
            // The owner's files are read as the owner would: a link to a root-only file is refused.
            initialAuth = QaapCodexGateOverlayBuilder.readRegularFile(sourceAuth, true, drop?.uid);
            if (initialAuth) {
                this.writeOwnedFile(overlayAuth, initialAuth.text, drop);
            }
            const hooksPath = path.join(codexHome, 'hooks.json');
            const hookCommand = this.hookCommand(options);
            const timeoutSec = Math.max(1, Math.round(options.askTtlSec)) + HOOK_TIMEOUT_MARGIN_SEC;
            this.writeOwnedFile(hooksPath, QaapCodexGateOverlayBuilder.renderHooksJson(hookCommand, timeoutSec), drop);
            const trustedHash = QaapCodexGateOverlayBuilder.hookHash(hookCommand, timeoutSec);
            const sourceConfig = QaapCodexGateOverlayBuilder.readRegularFile(path.join(options.sourceCodexHome, 'config.toml'), true, drop?.uid)?.text;
            this.writeOwnedFile(path.join(codexHome, 'config.toml'), QaapCodexGateOverlayBuilder.renderConfigToml({
                cwd: QaapCodexGateOverlayBuilder.canonical(options.cwd),
                folderTrusted: options.folderTrusted,
                hookStateKey: `${hooksPath}:${HOOK_KEY_SUFFIX}`,
                trustedHash,
                sourceConfig,
            }), drop);
            if (drop) {
                // Only these two directories and the files above are ever handed over; never the base.
                this.handOverDirectory(codexHome, drop);
                this.handOverDirectory(taskDir, drop);
            }
            await this.verifyOnce(codexHome, options.cwd, env, drop);
        } catch (error) {
            dispose();
            throw error;
        }
        return { codexHome, dispose };
    }

    protected hookCommand(options: QaapCodexGateOverlayOptions): string {
        const node = quoteShellArg(options.nodeBin ?? process.execPath);
        const hook = quoteShellArg(options.hookPath ?? resolveQaapToolGateCodexHookPath());
        // `|| exit 2`: any crash (exit 1, missing node) would otherwise let the tool run.
        return `${node} ${hook} --dialect codex || exit 2`;
    }

    /** The identity to drop to, only when it really differs from this process (root backend, agent uid). */
    protected resolveDrop(identity: QaapCodexGateOverlayOptions['agentIdentity']): { uid: number; gid?: number } | undefined {
        const current = typeof process.getuid === 'function' ? process.getuid() : undefined;
        if (identity?.uid === undefined || identity.uid === current) {
            return undefined;
        }
        return { uid: identity.uid, gid: identity.gid };
    }

    /** Creates a file root owns exclusively (O_EXCL|O_NOFOLLOW) and, with a drop, hands it to the agent by fd. */
    protected writeOwnedFile(file: string, text: string, owner: { uid: number; gid?: number } | undefined): void {
        const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
        try {
            fs.writeSync(fd, text);
            if (owner) {
                this.handOver(fd, file, owner);
            }
        } finally {
            fs.closeSync(fd);
        }
    }

    protected handOverDirectory(dir: string, owner: { uid: number; gid?: number }): void {
        const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | NOFOLLOW);
        try {
            this.handOver(fd, dir, owner);
        } finally {
            fs.closeSync(fd);
        }
    }

    /** The only place that chowns: by file descriptor, so a link can never redirect it. Overridable for tests. */
    protected handOver(fd: number, _target: string, owner: { uid: number; gid?: number }): void {
        fs.fchownSync(fd, owner.uid, owner.gid ?? owner.uid);
    }

    protected async verifyOnce(codexHome: string, cwd: string, env: NodeJS.ProcessEnv, identity?: { uid: number; gid?: number }): Promise<void> {
        const version = await QaapCodexGateOverlayBuilder.codexVersion(env);
        if (this.verifiedVersions.has(version)) {
            return;
        }
        const status = await this.probe(codexHome, cwd, env, identity);
        if (status !== 'trusted') {
            throw new Error(`Codex does not trust the Qaap safety hook (${status}, codex ${version}); refusing to run Codex without the gate.`);
        }
        this.verifiedVersions.add(version);
    }

    /**
     * Rewrites an `auth.json` Codex refreshed during the task back to the owner's home (refresh tokens
     * rotate). Compare-and-swap: only while the owner's file is still what we copied. The overlay is
     * agent-controlled, so root reads it only as a regular, single-link file owned by the agent
     * (O_NOFOLLOW); a link to a root-only file is therefore never read, let alone copied.
     */
    protected writeBackRefreshedAuth(taskDir: string, codexHome: string, overlayAuth: string, sourceAuth: string,
        initial: SafeRead | undefined, expectedUid: number | undefined): void {
        try {
            if (!initial) {
                return;
            }
            for (const dir of [taskDir, codexHome]) {
                if (!fs.lstatSync(dir).isDirectory()) {
                    console.warn('[qaap-codex-gate] overlay layout was tampered with; not writing the Codex login back');
                    return;
                }
            }
            const refreshed = QaapCodexGateOverlayBuilder.readRegularFile(overlayAuth, false, expectedUid);
            if (!refreshed || refreshed.text === initial.text) {
                return;
            }
            JSON.parse(refreshed.text);
            const target = fs.realpathSync(sourceAuth);
            if (QaapCodexGateOverlayBuilder.readRegularFile(target, false, undefined)?.text !== initial.text) {
                console.warn('[qaap-codex-gate] the Codex login changed during the task; not overwriting it with the refreshed copy');
                return;
            }
            const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
            const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
            try {
                fs.writeSync(fd, refreshed.text);
                if (QaapCodexGateOverlayBuilder.currentUid() === 0) {
                    this.handOver(fd, temp, { uid: initial.uid, gid: initial.gid });
                }
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(temp, target);
        } catch (error) {
            console.warn('[qaap-codex-gate] could not write the refreshed Codex login back', error instanceof Error ? error.message : String(error));
        }
    }

    /** `hooks.json` in Codex's schema. The field is `timeout` (seconds); `timeoutSec` is silently ignored. */
    static renderHooksJson(command: string, timeoutSec: number): string {
        return `${JSON.stringify({
            hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: timeoutSec }] }] },
        }, undefined, 2)}\n`;
    }

    /** Codex's trust hash for one command hook: sha256 of the key-sorted normalized identity. */
    static hookHash(command: string, timeoutSec: number): string {
        const identity = { event_name: 'pre_tool_use', hooks: [{ async: false, command, timeout: timeoutSec, type: 'command' }], matcher: '*' };
        return `sha256:${crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
    }

    static renderConfigToml(input: {
        cwd: string;
        folderTrusted: boolean;
        hookStateKey: string;
        trustedHash: string;
        sourceConfig: string | undefined;
    }): string {
        const lines = [
            '# Generated by Qaap for one task. Never edit: deleted when the task ends.',
            // The hook is the approval authority; Codex must not also prompt (no tty in `exec`).
            'approval_policy = "never"',
            'sandbox_mode = "workspace-write"',
            '',
        ];
        if (input.sourceConfig) {
            lines.push(QaapCodexGateOverlayBuilder.filterSourceConfig(input.sourceConfig), '');
        }
        if (!input.folderTrusted) {
            // Without an entry `codex exec` trusts its cwd itself and would load project hooks and config.
            lines.push(`[projects.${JSON.stringify(input.cwd)}]`, 'trust_level = "untrusted"', '');
        }
        lines.push(`[hooks.state.${JSON.stringify(input.hookStateKey)}]`, `trusted_hash = ${JSON.stringify(input.trustedHash)}`, '');
        return lines.join('\n');
    }

    /**
     * Keeps the owner's provider, model and MCP settings but drops what the overlay owns: the approval
     * and sandbox keys, every `[projects]` and `[hooks]` table (their trust/hook state is regenerated).
     */
    static filterSourceConfig(source: string): string {
        const kept: string[] = [];
        let skipping = false;
        let inTable = false;
        for (const line of source.split(/\r?\n/)) {
            const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
            if (header) {
                inTable = true;
                const name = header[1].replace(/["']/g, '');
                skipping = /^(projects|hooks)(\.|$)/.test(name);
            }
            if (skipping) {
                continue;
            }
            if (!inTable && /^\s*(approval_policy|sandbox_mode|hooks|projects)\s*=/.test(line)) {
                continue;
            }
            kept.push(line);
        }
        return kept.join('\n').trim();
    }

    protected processBase: string | undefined;
    protected sweptBases = false;

    /**
     * Where overlays live. An explicit root (option or `QAAP_CODEX_GATE_DIR`) gets the usual checks. Otherwise
     * the base is an UNPREDICTABLE directory this process creates in the OS temp dir (the only place a
     * read-only tenant backend can write that the agent can also traverse): mkdtemp makes the name random,
     * so the agent cannot pre-plant a link there. It is re-verified (lstat) on every use and recreated if
     * it was tampered with.
     */
    protected resolveBase(explicit: string | undefined, drop: { uid: number } | undefined): string {
        const configured = explicit ?? (process.env.QAAP_CODEX_GATE_DIR?.trim() || undefined);
        if (configured) {
            return this.ensureBase(configured, drop);
        }
        if (!this.sweptBases) {
            this.sweptBases = true;
            this.sweepOldBases(os.tmpdir());
        }
        if (this.processBase) {
            try {
                this.verifyBase(this.processBase, drop);
                return this.processBase;
            } catch (error) {
                console.warn('[qaap-codex-gate] the overlay base failed verification; creating a new one');
                this.removeBase(this.processBase);
                this.processBase = undefined;
            }
        }
        const base = fs.mkdtempSync(path.join(os.tmpdir(), BASE_PREFIX));
        fs.chmodSync(base, drop ? 0o711 : 0o700);
        this.verifyBase(base, drop);
        this.processBase = base;
        process.once('exit', () => this.removeBase(base));
        return base;
    }

    /** Old bases of crashed backends: real directories owned by us, idle for a day, never links. */
    protected sweepOldBases(tmpRoot: string): void {
        try {
            const uid = QaapCodexGateOverlayBuilder.currentUid();
            for (const entry of fs.readdirSync(tmpRoot)) {
                if (!entry.startsWith(BASE_PREFIX)) {
                    continue;
                }
                const dir = path.join(tmpRoot, entry);
                const stat = fs.lstatSync(dir);
                if (stat.isDirectory() && (uid === undefined || stat.uid === uid) && dir !== this.processBase
                    && Date.now() - stat.mtimeMs > STALE_OVERLAY_MAX_AGE_MS) {
                    this.removeBase(dir);
                }
            }
        } catch {
            // nothing to sweep
        }
    }

    protected static currentUid(): number | undefined {
        return typeof process.getuid === 'function' ? process.getuid() : undefined;
    }

    /**
     * The base directory is created and owned by this process (root when dropping) and is never chowned.
     * With a drop it is 0711: the agent can traverse to its own task directory but cannot create, rename
     * or list anything in it. A pre-existing link, foreign owner or writable base is refused.
     */
    protected ensureBase(base: string, drop: { uid: number } | undefined): string {
        fs.mkdirSync(base, { recursive: true, mode: drop ? 0o711 : 0o700 });
        return this.verifyBase(base, drop);
    }

    /** lstat checks: a real directory, owned by this process, not writable by others (searchable by the agent with a drop). */
    protected verifyBase(base: string, drop: { uid: number } | undefined): string {
        const stat = fs.lstatSync(base);
        const uid = QaapCodexGateOverlayBuilder.currentUid();
        if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) {
            throw new Error(`Refusing to use ${base} for Codex overlays: it is not a real directory owned by the backend.`);
        }
        const forbidden = drop ? 0o022 : 0o077;
        if ((stat.mode & forbidden) !== 0 || (drop && (stat.mode & 0o001) === 0)) {
            throw new Error(`Refusing to use ${base} for Codex overlays: its mode is ${(stat.mode & 0o777).toString(8)}.`);
        }
        if (drop) {
            this.assertReachable(base);
        }
        return base;
    }

    /** The agent uid must be able to traverse every ancestor of the base; fail with a clear message otherwise. */
    protected assertReachable(base: string): void {
        for (let dir = path.dirname(fs.realpathSync(base)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
            if ((fs.statSync(dir).mode & 0o001) === 0) {
                throw new Error(`Codex cannot reach ${base}: ${dir} is not searchable by other users (set QAAP_CODEX_GATE_DIR).`);
            }
        }
    }

    /** Reads a regular, single-link file without following a final link (or after resolving it, for the owner's files). */
    static readRegularFile(file: string, resolveLink: boolean, requiredUid: number | undefined): SafeRead | undefined {
        let target = file;
        if (resolveLink) {
            try {
                target = fs.realpathSync(file);
            } catch {
                return undefined;
            }
        }
        let fd: number;
        try {
            fd = fs.openSync(target, fs.constants.O_RDONLY | NOFOLLOW);
        } catch {
            return undefined;
        }
        try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_SECRET_FILE_BYTES || (requiredUid !== undefined && stat.uid !== requiredUid)) {
                console.warn('[qaap-codex-gate] refusing to read an unexpected file (link, hardlink or foreign owner)');
                return undefined;
            }
            return { text: fs.readFileSync(fd, 'utf8'), uid: stat.uid, gid: stat.gid };
        } finally {
            fs.closeSync(fd);
        }
    }

    /**
     * Script run AS THE AGENT'S UID (never as root) to finish a task: write a refreshed login back
     * (compare-and-swap) and empty the task directory. Whatever links the agent planted can then only
     * reach what the agent could already reach, because root never walks agent-owned trees by path.
     */
    protected static readonly AGENT_FINISH_SCRIPT = [
        "const fs=require('fs'),path=require('path');",
        "const i=JSON.parse(fs.readFileSync(0,'utf8'));",
        'try{if(typeof i.initial==="string"){const cur=fs.readFileSync(i.overlayAuth,"utf8");if(cur!==i.initial){JSON.parse(cur);',
        'const target=fs.realpathSync(i.sourceAuth);if(fs.readFileSync(target,"utf8")===i.initial){',
        'const tmp=target+"."+process.pid+".tmp";const fd=fs.openSync(tmp,"wx",0o600);fs.writeSync(fd,cur);fs.closeSync(fd);fs.renameSync(tmp,target);}}}}',
        'catch(e){process.stderr.write("login write-back skipped\\n");}',
        'let failed=false;',
        'for(const e of fs.readdirSync(i.taskDir)){try{fs.rmSync(path.join(i.taskDir,e),{recursive:true,force:true});}catch(e2){failed=true;}}',
        'process.exit(failed?1:0);',
    ].join('');

    /** Runs {@link AGENT_FINISH_SCRIPT} as `owner`. Returns false on any failure. Overridable for tests. */
    protected runAsOwner(owner: { uid: number; gid: number }, input: object): boolean {
        const result = spawnSync(process.execPath, ['-e', QaapCodexGateOverlayBuilder.AGENT_FINISH_SCRIPT], {
            uid: owner.uid, gid: owner.gid, cwd: '/', input: JSON.stringify(input), timeout: 30000,
            env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['pipe', 'ignore', 'ignore'],
        });
        return result.status === 0;
    }

    protected finishAsAgent(owner: { uid: number; gid?: number }, taskDir: string, overlayAuth: string, sourceAuth: string, initial: string | undefined): void {
        try {
            if (this.treeOwner(fs.lstatSync(taskDir)).uid === QaapCodexGateOverlayBuilder.currentUid()) {
                // Never handed over (the build failed before the agent could touch it): root's own tree.
                this.removeTaskTree(taskDir);
                return;
            }
        } catch {
            return;
        }
        const ok = this.runAsOwner({ uid: owner.uid, gid: owner.gid ?? owner.uid }, { taskDir, overlayAuth, sourceAuth, initial: initial ?? null });
        if (!ok) {
            console.warn('[qaap-codex-gate] could not finish the Codex overlay as the agent; it is left for the sweep and no login was written by root');
            return;
        }
        // Empty and owned by the agent but inside our private base: rmdir is the only call root makes.
        try {
            fs.rmdirSync(taskDir);
        } catch {
            // not empty (a background agent process): the sweep retries
        }
    }

    /** Owner of an entry, overridable for tests that cannot chown. */
    protected treeOwner(stat: fs.Stats): { uid: number; gid: number } {
        return { uid: stat.uid, gid: stat.gid };
    }

    /**
     * Removes one task directory without root ever recursing into a tree another uid controls: a tree owned
     * by another uid is emptied by a child running as that uid, then rmdir'd. Trees owned by this process
     * (dev, or root's own half-built overlays that no agent ever touched) are removed directly.
     */
    protected removeTaskTree(dir: string): void {
        try {
            const stat = fs.lstatSync(dir);
            if (!stat.isDirectory()) {
                fs.unlinkSync(dir);
                return;
            }
            const owner = this.treeOwner(stat);
            if (owner.uid === QaapCodexGateOverlayBuilder.currentUid()) {
                fs.rmSync(dir, { recursive: true, force: true });
                return;
            }
            if (this.runAsOwner(owner, { taskDir: dir, initial: null })) {
                fs.rmdirSync(dir);
            }
        } catch {
            // already gone, or left for the next sweep
        }
    }

    /** Removes a base: a link is only unlinked; each task directory goes through {@link removeTaskTree}. */
    protected removeBase(base: string): void {
        try {
            const stat = fs.lstatSync(base);
            if (!stat.isDirectory()) {
                fs.unlinkSync(base);
                return;
            }
            for (const entry of fs.readdirSync(base)) {
                this.removeTaskTree(path.join(base, entry));
            }
            fs.rmdirSync(base);
        } catch {
            // already gone, or non-empty: the next sweep retries
        }
    }

    protected static canonical(target: string): string {
        try {
            return fs.realpathSync(target);
        } catch {
            return target;
        }
    }

    protected static safeSegment(value: string): string {
        return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'task';
    }

    /** Crash leftovers: overlays hold a copy of the login, so they must not linger. */
    protected sweepStale(root: string): void {
        try {
            for (const entry of fs.readdirSync(root)) {
                const dir = path.join(root, entry);
                const stat = fs.lstatSync(dir);
                if (stat.isDirectory() && Date.now() - stat.mtimeMs > STALE_OVERLAY_MAX_AGE_MS) {
                    this.removeTaskTree(dir);
                }
            }
        } catch {
            // The root does not exist yet.
        }
    }

    protected static codexVersion(env: NodeJS.ProcessEnv): Promise<string> {
        return new Promise(resolve => {
            execFile('codex', ['--version'], { env, timeout: 15000 }, (error, stdout) => resolve(error ? 'unknown' : stdout.trim()));
        });
    }

    /** Asks a real `codex app-server` (`hooks/list`) whether it trusts the hook in this overlay. */
    static probeWithAppServer(codexHome: string, cwd: string, env: NodeJS.ProcessEnv, identity?: { uid: number; gid?: number }): Promise<'trusted' | 'untrusted' | 'missing'> {
        return new Promise((resolve, reject) => {
            const child = spawn('codex', ['app-server'], { cwd, env: { ...env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'ignore'],
                ...(identity ? { uid: identity.uid, gid: identity.gid ?? identity.uid } : {}) });
            let buffer = '';
            let done = false;
            const finish = (error: Error | undefined, status?: 'trusted' | 'untrusted' | 'missing'): void => {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timer);
                child.kill();
                if (error) {
                    reject(error);
                } else {
                    resolve(status ?? 'missing');
                }
            };
            const timer = setTimeout(() => finish(new Error('Timed out asking Codex whether it trusts the Qaap safety hook.')), 20000);
            child.on('error', error => finish(error));
            child.stdout.on('data', chunk => {
                buffer += chunk;
                let index: number;
                while ((index = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, index);
                    buffer = buffer.slice(index + 1);
                    try {
                        const message = JSON.parse(line);
                        if (message.id === 2) {
                            const hooks: Array<{ sourcePath?: string; trustStatus?: string }> = message.result?.data?.[0]?.hooks ?? [];
                            const ours = hooks.find(hook => hook.sourcePath === path.join(codexHome, 'hooks.json'));
                            finish(undefined, !ours ? 'missing' : ours.trustStatus === 'trusted' ? 'trusted' : 'untrusted');
                        }
                    } catch {
                        // not a JSON-RPC line
                    }
                }
            });
            const send = (message: object): void => {
                child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
            };
            send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'qaap-gate-probe', version: '1' } } });
            send({ method: 'initialized' });
            send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } });
        });
    }
}

/** True when Codex tool calls reach the gate through a PreToolUse hook (the overlay applies). */
export function usesCodexToolGateHook(agentId: string | undefined): boolean {
    return agentId?.trim().toLowerCase() === 'codex' && resolveQaapHarnessCapabilities(agentId).gate === 'hook';
}

/** Shared builder: it remembers which Codex versions already passed the trust probe. */
export const DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER = new QaapCodexGateOverlayBuilder();

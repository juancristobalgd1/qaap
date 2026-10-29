// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile, spawn } from 'child_process';
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
export type QaapCodexHookTrustProbe = (codexHome: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<'trusted' | 'untrusted' | 'missing'>;

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
        const root = options.overlayRoot ?? QaapCodexGateOverlayBuilder.defaultRoot();
        this.sweepStale(root);
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        // Codex keys hook trust by the CANONICAL hooks.json path (macOS /var -> /private/var): a symlinked
        // path would leave the hook untrusted, and an untrusted hook is skipped silently.
        const taskDir = path.join(fs.realpathSync(root), QaapCodexGateOverlayBuilder.safeSegment(options.taskId));
        const codexHome = path.join(taskDir, 'codex-home');
        fs.rmSync(taskDir, { recursive: true, force: true });
        fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
        const overlayAuth = path.join(codexHome, 'auth.json');
        const sourceAuth = path.join(options.sourceCodexHome, 'auth.json');
        let initialAuth: string | undefined;
        let disposed = false;
        const dispose = (): void => {
            if (disposed) {
                return;
            }
            disposed = true;
            QaapCodexGateOverlayBuilder.writeBackRefreshedAuth(overlayAuth, sourceAuth, initialAuth);
            fs.rmSync(taskDir, { recursive: true, force: true });
        };
        try {
            if (fs.existsSync(sourceAuth)) {
                initialAuth = fs.readFileSync(sourceAuth, 'utf8');
                fs.writeFileSync(overlayAuth, initialAuth, { mode: 0o600 });
            }
            const hooksPath = path.join(codexHome, 'hooks.json');
            const hookCommand = this.hookCommand(options);
            const timeoutSec = Math.max(1, Math.round(options.askTtlSec)) + HOOK_TIMEOUT_MARGIN_SEC;
            fs.writeFileSync(hooksPath, QaapCodexGateOverlayBuilder.renderHooksJson(hookCommand, timeoutSec), { mode: 0o600 });
            const trustedHash = QaapCodexGateOverlayBuilder.hookHash(hookCommand, timeoutSec);
            const sourceConfig = QaapCodexGateOverlayBuilder.readIfExists(path.join(options.sourceCodexHome, 'config.toml'));
            fs.writeFileSync(path.join(codexHome, 'config.toml'), QaapCodexGateOverlayBuilder.renderConfigToml({
                cwd: options.cwd,
                folderTrusted: options.folderTrusted,
                hookStateKey: `${hooksPath}:${HOOK_KEY_SUFFIX}`,
                trustedHash,
                sourceConfig,
            }), { mode: 0o600 });
            await this.verifyOnce(codexHome, options.cwd, env);
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

    protected async verifyOnce(codexHome: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
        const version = await QaapCodexGateOverlayBuilder.codexVersion(env);
        if (this.verifiedVersions.has(version)) {
            return;
        }
        const status = await this.probe(codexHome, cwd, env);
        if (status !== 'trusted') {
            throw new Error(`Codex does not trust the Qaap safety hook (${status}, codex ${version}); refusing to run Codex without the gate.`);
        }
        this.verifiedVersions.add(version);
    }

    /** Rewrites an `auth.json` Codex refreshed during the task back to the owner's home (refresh tokens rotate). */
    static writeBackRefreshedAuth(overlayAuth: string, sourceAuth: string, initialAuth: string | undefined): void {
        try {
            if (initialAuth === undefined || !fs.existsSync(overlayAuth)) {
                return;
            }
            const current = fs.readFileSync(overlayAuth, 'utf8');
            if (current === initialAuth) {
                return;
            }
            JSON.parse(current);
            const temp = `${sourceAuth}.${process.pid}.${Date.now()}.tmp`;
            fs.writeFileSync(temp, current, { mode: 0o600 });
            fs.renameSync(temp, sourceAuth);
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

    static defaultRoot(): string {
        return path.join(os.tmpdir(), `qaap-codex-gate-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`);
    }

    protected static safeSegment(value: string): string {
        return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'task';
    }

    protected static readIfExists(file: string): string | undefined {
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
    }

    /** Crash leftovers: overlays hold a copy of the login, so they must not linger. */
    protected sweepStale(root: string): void {
        try {
            for (const entry of fs.readdirSync(root)) {
                const dir = path.join(root, entry);
                if (Date.now() - fs.statSync(dir).mtimeMs > STALE_OVERLAY_MAX_AGE_MS) {
                    fs.rmSync(dir, { recursive: true, force: true });
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
    static probeWithAppServer(codexHome: string, cwd: string, env: NodeJS.ProcessEnv): Promise<'trusted' | 'untrusted' | 'missing'> {
        return new Promise((resolve, reject) => {
            const child = spawn('codex', ['app-server'], { cwd, env: { ...env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'ignore'] });
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

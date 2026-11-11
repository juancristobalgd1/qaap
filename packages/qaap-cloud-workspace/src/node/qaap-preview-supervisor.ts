// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { qaapPreviewPortNodeImportFlag } from '@theia/qaap-shared-core/lib/common/qaap-preview-port-preload';
import { rememberAgentProcessIdentity, signalAgentProcessTree } from './qaap-agent-process-signal';
import {
    pruneRestartHistory,
    QaapStderrRing,
    shouldAutoRestartPreview,
    type QaapPreviewProcessSnapshot,
    type QaapPreviewProcessIdentity,
    type QaapPreviewProcessStatus,
} from '../common/qaap-preview-supervisor-types';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { childProcessEnv } from './qaap-child-process-env';

interface QaapPreviewProcessRecord {
    readonly key: string;
    readonly identity?: QaapPreviewProcessIdentity;
    port: number;
    cwd: string;
    status: QaapPreviewProcessStatus;
    child?: ChildProcess;
    startedAt?: number;
    exitedAt?: number;
    exitCode?: number;
    signal?: string;
    everStarted: boolean;
    readonly stderr: QaapStderrRing;
    /** Timestamps (ms) of automatic restarts within the current window. */
    autoRestartAt: number[];
    /** Structured launch supplied by the shared preview plan (non-Node/custom runtimes). */
    launch?: QaapPreviewSupervisorLaunch;
    /** Stop signalled SIGTERM: the record and its port are retired only when the child reports its exit. */
    stopRequested?: boolean;
}

export interface QaapPreviewSupervisorLaunch {
    readonly command: string;
    readonly args: readonly string[];
}

export type QaapPreviewPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Package-manager shims on Windows are usually `.cmd` files. They cannot be started with
 * child_process.spawn(file, args) directly, so run the known-safe manager/script pair through
 * cmd.exe. POSIX keeps argv execution without a shell.
 */
export function buildQaapPreviewScriptCommand(
    packageManager: QaapPreviewPackageManager,
    script: 'dev' | 'start',
    platform: string = process.platform,
): { readonly command: string; readonly args: string[] } {
    if (platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', `${packageManager} run ${script}`],
        };
    }
    return { command: packageManager, args: ['run', script] };
}

/**
 * A preview dev server is user app code: it must not inherit the Qaap host runtime. Every `QAAP_*`
 * key of the base env is dropped (case-insensitively, as Windows env names are). No `QAAP_*` key is
 * kept: Qaap sets `QAAP_PREVIEW_PORT` itself, and the port preload (`qaapPreviewPortNodeImportFlag`)
 * reads only that one. Inherited ones would point a nested Qaap at the host's stores, cloud mode,
 * preview base domain and task tokens.
 */
export function qaapPreviewProcessBaseEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(base)) {
        if (!/^QAAP_/i.test(key)) {
            env[key] = value;
        }
    }
    return env;
}

/**
 * Dev-server env pinned to `port` the way the frontend bootstrap pins it: `PORT` for generic
 * servers plus `QAAP_PREVIEW_PORT` and the framework preload, so Vite/Astro/Next/Remix (which
 * ignore `PORT`) bind exactly this port with `--strictPort` instead of their default one.
 * Inherited `QAAP_*` variables are stripped first (see {@link qaapPreviewProcessBaseEnv}).
 */
export function buildQaapPreviewProcessEnv(base: NodeJS.ProcessEnv, port: number): NodeJS.ProcessEnv {
    return {
        ...qaapPreviewProcessBaseEnv(base),
        PORT: String(port),
        QAAP_PREVIEW_PORT: String(port),
        // Same rule as the terminal path (`wrapCommandForDevNodeEnv`): a dev server must not inherit
        // the host's NODE_ENV=production (dev branches off, and a nested Qaap refuses skip-auth).
        NODE_ENV: 'development',
        NODE_OPTIONS: [base.NODE_OPTIONS, qaapPreviewPortNodeImportFlag(true)].filter(Boolean).join(' '),
        BROWSER: 'none',
    };
}

/**
 * Supervises dev-server child processes started via the preview restart endpoint. The primary
 * dev server is normally spawned by the frontend bootstrap terminal (which the backend cannot
 * reach); this supervisor owns only the children it (re)starts, so it can reliably detect their
 * death — recording exit code, signal, and a rolling stderr tail — and drive a friendly failure
 * page plus bounded auto-restart. Children are killed when the backend process exits to avoid
 * orphaned dev servers.
 */
@injectable()
export class QaapPreviewSupervisor implements BackendApplicationContribution {

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    protected readonly records = new Map<string, QaapPreviewProcessRecord>();
    /** Starts still spawning, per preview key: a concurrent start reuses the promise instead of a second dev server. */
    protected readonly pendingStarts = new Map<string, Promise<QaapPreviewProcessStatus>>();
    protected cleanupRegistered = false;

    /**
     * Starts (or restarts) a dev server for `cwd` on `port`. If a supervised child is already
     * live on that port it is returned as-is. Returns the resulting status.
     */
    async start(
        cwd: string,
        port: number,
        identity?: QaapPreviewProcessIdentity,
        launch?: QaapPreviewSupervisorLaunch,
    ): Promise<QaapPreviewProcessStatus> {
        const key = identity?.previewId ?? `legacy-port-${port}`;
        const pending = this.pendingStarts.get(key);
        if (pending) {
            return pending;
        }
        const existing = this.records.get(key);
        if (existing && existing.status !== 'exited' && existing.child && existing.child.exitCode === null) {
            return existing.status;
        }
        const collision = [...this.records.values()].find(record => record.key !== key
            && record.port === port && record.status !== 'exited' && record.child?.exitCode === null);
        if (collision) {
            throw new Error(`Preview port ${port} is already reserved by ${collision.identity?.previewId ?? collision.key}.`);
        }
        const starting = this.spawnDevServer(cwd, port, existing?.autoRestartAt ?? [], identity, launch)
            .finally(() => this.pendingStarts.delete(key));
        this.pendingStarts.set(key, starting);
        return starting;
    }

    /**
     * Terminates a supervised child and retires its record. Used by short-lived consumers
     * (headless capture) so their servers never outlive the job that needed them.
     */
    stop(previewId: string): boolean {
        const record = this.records.get(previewId);
        if (!record) {
            return false;
        }
        if (record.child && record.child.exitCode === null) {
            const outcome = signalAgentProcessTree(record.child, 'SIGTERM');
            if (outcome === 'failed') {
                // The dev server may still be running: keep its record (and port) so it is not reported as stopped.
                console.warn(`[qaap-preview] could not stop preview ${previewId}; its dev server may still be running`);
                return false;
            }
            if (outcome === 'sent') {
                // Not confirmed dead yet: the record and its port stay until the child exits (see recordExit).
                record.stopRequested = true;
                return true;
            }
        }
        // Already gone (ESRCH or never spawned): nothing can still hold the port.
        this.records.delete(previewId);
        return false;
    }

    /** The identity a preview dev server in `cwd` runs as, or undefined when it is not dropped (or cannot be resolved). */
    protected previewIdentityFor(cwd: string): { uid?: number; gid?: number } | undefined {
        try {
            return this.tenantSpawn.resolveSpawnIdentity(cwd);
        } catch {
            return undefined;
        }
    }

    /** Returns a serializable snapshot for the failure page, if this port was ever supervised. */
    describe(previewIdOrPort: string | number): QaapPreviewProcessSnapshot | undefined {
        const key = typeof previewIdOrPort === 'number' ? `legacy-port-${previewIdOrPort}` : previewIdOrPort;
        const record = this.records.get(key)
            ?? (typeof previewIdOrPort === 'number'
                ? [...this.records.values()].find(candidate => candidate.port === previewIdOrPort)
                : undefined);
        if (!record) {
            return undefined;
        }
        return {
            previewId: record.identity?.previewId,
            port: record.port,
            cwd: record.cwd,
            status: record.status,
            startedAt: record.startedAt ? new Date(record.startedAt).toISOString() : undefined,
            exitedAt: record.exitedAt ? new Date(record.exitedAt).toISOString() : undefined,
            exitCode: record.exitCode,
            signal: record.signal,
            stderrTail: record.stderr.snapshot(),
            autoRestartAt: [...record.autoRestartAt],
            processId: record.child?.pid,
        };
    }

    protected async spawnDevServer(
        cwd: string,
        port: number,
        autoRestartAt: number[],
        identity?: QaapPreviewProcessIdentity,
        launch?: QaapPreviewSupervisorLaunch,
    ): Promise<QaapPreviewProcessStatus> {
        const key = identity?.previewId ?? `legacy-port-${port}`;
        const plan = launch ?? this.resolveDevCommand(cwd);
        if (!plan) {
            const failed: QaapPreviewProcessRecord = {
                key,
                identity,
                port,
                cwd,
                status: 'exited',
                everStarted: false,
                exitCode: 1,
                exitedAt: Date.now(),
                stderr: new QaapStderrRing(),
                autoRestartAt,
                launch,
            };
            failed.stderr.push('No runnable preview launch plan was found for this workspace.\n');
            this.records.set(key, failed);
            return 'exited';
        }
        this.registerCleanup();
        // SEC-1: the dev server runs workspace-controlled code (package script or validated argv plan),
        // so it MUST drop to the tenant uid — otherwise a malicious repo's `dev` script runs as root and
        // defeats uid-per-user isolation. spawnArgvPrepared enforces the fail-closed policy, provisions
        // + chowns the tenant tree, and wraps the command in `setpriv --clear-groups`. resolveProcessEnv
        // points HOME/USER at the tenant's writable home. No-op when uid-per-user is off / not root.
        let child: ChildProcess;
        try {
            const env = this.tenantSpawn.resolveProcessEnv(cwd, buildQaapPreviewProcessEnv(childProcessEnv(), port));
            child = await this.tenantSpawn.spawnArgvPreparedAsync(plan.command, plan.args, { cwd, env });
            rememberAgentProcessIdentity(child, this.previewIdentityFor(cwd));
        } catch (error) {
            const refused: QaapPreviewProcessRecord = {
                key,
                identity,
                port,
                cwd,
                status: 'exited',
                everStarted: false,
                exitCode: 1,
                exitedAt: Date.now(),
                stderr: new QaapStderrRing(),
                autoRestartAt,
            };
            refused.stderr.push(`Refusing to start the dev server: ${error instanceof Error ? error.message : String(error)}\n`);
            this.records.set(key, refused);
            return 'exited';
        }
        const record: QaapPreviewProcessRecord = {
            key,
            identity,
            port,
            cwd,
            status: 'starting',
            child,
            startedAt: Date.now(),
            everStarted: true,
            stderr: new QaapStderrRing(),
            autoRestartAt,
            launch,
        };
        this.records.set(key, record);

        child.stderr?.on('data', (chunk: Buffer) => record.stderr.push(chunk.toString()));
        child.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            if (record.status === 'starting') {
                record.status = 'running';
            }
            // Keep fatal stdout diagnostics (many dev servers print crashes to stdout).
            if (/error|fatal|exception|cannot find|failed/i.test(text)) {
                record.stderr.push(text);
            }
        });
        child.on('error', err => {
            record.stderr.push(`spawn error: ${err.message}\n`);
            this.recordExit(record, 1, undefined);
        });
        child.on('exit', (code, signal) => {
            this.recordExit(record, code ?? undefined, signal ?? undefined);
        });
        child.on('close', (code, signal) => {
            this.recordExit(record, code ?? undefined, signal ?? undefined);
        });
        return 'starting';
    }

    protected recordExit(record: QaapPreviewProcessRecord, exitCode: number | undefined, signal: string | undefined): void {
        if (record.status === 'exited') {
            return;
        }
        record.status = 'exited';
        record.exitedAt = Date.now();
        record.exitCode = exitCode;
        record.signal = signal;
        record.child = undefined;
        if (record.stopRequested) {
            // Stopped on purpose and confirmed gone: retire the record, which also frees its port. No auto-restart.
            if (this.records.get(record.key) === record) {
                this.records.delete(record.key);
            }
            return;
        }
        this.maybeAutoRestart(record);
    }

    protected maybeAutoRestart(record: QaapPreviewProcessRecord): void {
        // Clean exit (code 0, no signal): the user stopped it — do not resurrect.
        if (record.exitCode === 0 && !record.signal) {
            return;
        }
        const now = Date.now();
        const history = pruneRestartHistory(record.autoRestartAt, now);
        if (!shouldAutoRestartPreview(history, now)) {
            record.autoRestartAt = history;
            return;
        }
        record.autoRestartAt = [...history, now];
        // Small delay so a crash-on-boot app cannot busy-loop between spawns.
        setTimeout(() => {
            if (this.records.get(record.key) === record && record.status === 'exited') {
                void this.spawnDevServer(record.cwd, record.port, record.autoRestartAt, record.identity, record.launch);
            }
        }, 1500).unref?.();
    }

    protected resolveDevCommand(cwd: string): { command: string; args: string[] } | undefined {
        let script: 'dev' | 'start' = 'dev';
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
            const scripts = manifest.scripts ?? {};
            if (!scripts.dev && scripts.start) {
                script = 'start';
            } else if (!scripts.dev && !scripts.start) {
                return undefined;
            }
        } catch {
            return undefined;
        }
        const pm = this.detectPackageManager(cwd);
        return buildQaapPreviewScriptCommand(pm, script);
    }

    protected detectPackageManager(cwd: string): QaapPreviewPackageManager {
        if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
            return 'pnpm';
        }
        if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
            return 'yarn';
        }
        if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
            return 'bun';
        }
        return 'npm';
    }

    /**
     * Kills supervised dev servers as part of Theia's ordered shutdown. Theia's own
     * SIGINT/SIGTERM handler awaits every contribution's `onStop` (runner, stores, auto-resume
     * state) before exiting, so this must never call `process.exit()` itself.
     */
    onStop(): void {
        this.killAll();
    }

    protected killAll(): void {
        for (const record of this.records.values()) {
            if (record.child && record.child.exitCode === null
                && signalAgentProcessTree(record.child, 'SIGTERM') === 'failed') {
                console.warn(`[qaap-preview] could not stop preview on port ${record.port}; its dev server may still be running`);
            }
        }
    }

    protected registerCleanup(): void {
        if (this.cleanupRegistered) {
            return;
        }
        this.cleanupRegistered = true;
        // Safety net for exits that bypass graceful shutdown; signals go through `onStop`.
        process.once('exit', () => this.killAll());
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    pruneRestartHistory,
    QaapStderrRing,
    shouldAutoRestartPreview,
    type QaapPreviewProcessSnapshot,
    type QaapPreviewProcessStatus,
} from '../common/qaap-preview-supervisor-types';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

interface QaapPreviewProcessRecord {
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
export class QaapPreviewSupervisor {

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    protected readonly records = new Map<number, QaapPreviewProcessRecord>();
    protected cleanupRegistered = false;

    /**
     * Starts (or restarts) a dev server for `cwd` on `port`. If a supervised child is already
     * live on that port it is returned as-is. Returns the resulting status.
     */
    start(cwd: string, port: number): QaapPreviewProcessStatus {
        const existing = this.records.get(port);
        if (existing && existing.status !== 'exited' && existing.child && existing.child.exitCode === null) {
            return existing.status;
        }
        return this.spawnDevServer(cwd, port, existing?.autoRestartAt ?? []);
    }

    /** Returns a serializable snapshot for the failure page, if this port was ever supervised. */
    describe(port: number): QaapPreviewProcessSnapshot | undefined {
        const record = this.records.get(port);
        if (!record) {
            return undefined;
        }
        return {
            port: record.port,
            cwd: record.cwd,
            status: record.status,
            startedAt: record.startedAt ? new Date(record.startedAt).toISOString() : undefined,
            exitedAt: record.exitedAt ? new Date(record.exitedAt).toISOString() : undefined,
            exitCode: record.exitCode,
            signal: record.signal,
            stderrTail: record.stderr.snapshot(),
            autoRestartAt: [...record.autoRestartAt],
        };
    }

    protected spawnDevServer(cwd: string, port: number, autoRestartAt: number[]): QaapPreviewProcessStatus {
        const plan = this.resolveDevCommand(cwd);
        if (!plan) {
            const failed: QaapPreviewProcessRecord = {
                port,
                cwd,
                status: 'exited',
                everStarted: false,
                exitCode: 1,
                exitedAt: Date.now(),
                stderr: new QaapStderrRing(),
                autoRestartAt,
            };
            failed.stderr.push('No "dev" or "start" script found in package.json for this workspace.\n');
            this.records.set(port, failed);
            return 'exited';
        }
        this.registerCleanup();
        // SEC-1: the dev server runs the workspace's own package.json script (tenant-controlled code),
        // so it MUST drop to the tenant uid — otherwise a malicious repo's `dev` script runs as root and
        // defeats uid-per-user isolation. spawnArgvPrepared enforces the fail-closed policy, provisions
        // + chowns the tenant tree, and wraps the command in `setpriv --clear-groups`. resolveProcessEnv
        // points HOME/USER at the tenant's writable home. No-op when uid-per-user is off / not root.
        let child: ChildProcess;
        try {
            const env = this.tenantSpawn.resolveProcessEnv(cwd, { ...process.env, PORT: String(port), BROWSER: 'none' });
            child = this.tenantSpawn.spawnArgvPrepared(plan.command, plan.args, { cwd, env });
        } catch (error) {
            const refused: QaapPreviewProcessRecord = {
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
            this.records.set(port, refused);
            return 'exited';
        }
        const record: QaapPreviewProcessRecord = {
            port,
            cwd,
            status: 'starting',
            child,
            startedAt: Date.now(),
            everStarted: true,
            stderr: new QaapStderrRing(),
            autoRestartAt,
        };
        this.records.set(port, record);

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
            if (this.records.get(record.port) === record && record.status === 'exited') {
                this.spawnDevServer(record.cwd, record.port, record.autoRestartAt);
            }
        }, 1500).unref?.();
    }

    protected resolveDevCommand(cwd: string): { command: string; args: string[] } | undefined {
        let script = 'dev';
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
        return { command: pm, args: ['run', script] };
    }

    protected detectPackageManager(cwd: string): string {
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

    protected registerCleanup(): void {
        if (this.cleanupRegistered) {
            return;
        }
        this.cleanupRegistered = true;
        const killAll = () => {
            for (const record of this.records.values()) {
                if (record.child && record.child.exitCode === null) {
                    record.child.kill('SIGTERM');
                }
            }
        };
        process.once('exit', killAll);
        process.once('SIGINT', () => { killAll(); process.exit(130); });
        process.once('SIGTERM', () => { killAll(); process.exit(143); });
    }
}

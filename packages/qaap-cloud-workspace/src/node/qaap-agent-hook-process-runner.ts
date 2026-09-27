// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ChildProcess, spawnSync } from 'child_process';
import type { QaapAgentHookProcessResult } from '../common/qaap-agent-hooks';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/** Per-stream capture cap; hooks are meant to print short decisions / context. */
const MAX_HOOK_OUTPUT_CHARS = 64 * 1024;

/** Env var names never forwarded to hook commands (backend secrets and provider keys). */
const SECRET_ENV_PATTERN = /(API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIAL|SESSION_KEY|COOKIE)/i;

export interface QaapAgentHookProcessOptions {
    readonly cwd: string;
    /** Serialized as JSON on the hook's stdin. */
    readonly input: unknown;
    readonly timeoutMs: number;
    /** Extra env (e.g. `CLAUDE_PROJECT_DIR`), merged over the sanitized backend env. */
    readonly env?: Record<string, string>;
}

/**
 * Runs one hook command. Every spawn goes through {@link QaapTenantSpawnService} so hooks execute
 * under the tenant's identity / container exactly like the agent CLI (see doc/qaap-ci-invariants.md).
 * Never rejects: spawn failures, timeouts and crashes come back as a result the caller interprets.
 */
@injectable()
export class QaapAgentHookProcessRunner {

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    async run(command: string, options: QaapAgentHookProcessOptions): Promise<QaapAgentHookProcessResult> {
        let child: ChildProcess;
        try {
            child = await this.spawnHook(command, options.cwd, this.buildEnv(options));
        } catch (error) {
            return { stdout: '', stderr: '', timedOut: false, error: `Failed to start hook: ${this.errorMessage(error)}` };
        }
        return new Promise<QaapAgentHookProcessResult>(resolve => {
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            let settled = false;
            const finish = (result: QaapAgentHookProcessResult): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const timer = setTimeout(() => {
                timedOut = true;
                this.killTree(child);
                // Some shells never emit `close` once their tree is killed; do not wait for it.
                finish({ stdout, stderr, timedOut: true });
            }, Math.max(1, options.timeoutMs));
            child.stdout?.on('data', chunk => {
                stdout = this.append(stdout, chunk);
            });
            child.stderr?.on('data', chunk => {
                stderr = this.append(stderr, chunk);
            });
            child.on('error', error => {
                finish({ stdout, stderr, timedOut, error: `Hook process error: ${error.message}` });
            });
            child.on('close', code => {
                finish({ exitCode: code ?? undefined, stdout, stderr, timedOut });
            });
            if (child.stdin) {
                // A hook that ignores stdin may close it early; EPIPE must not crash the backend.
                child.stdin.on('error', () => undefined);
                try {
                    child.stdin.end(JSON.stringify(options.input));
                } catch {
                    // Ignored: the process result still decides the outcome.
                }
            }
        });
    }

    /** Spawn seam — overridden in tests. */
    protected async spawnHook(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
        return this.tenantSpawn.spawnPreparedAsync(command, {
            cwd,
            env: this.tenantSpawn.resolveProcessEnv(cwd, env),
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }

    protected buildEnv(options: QaapAgentHookProcessOptions): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && !SECRET_ENV_PATTERN.test(key)) {
                env[key] = value;
            }
        }
        env.PWD = options.cwd;
        return { ...env, ...(options.env ?? {}) };
    }

    protected killTree(child: ChildProcess): void {
        const pid = child.pid;
        if (!pid) {
            return;
        }
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
            return;
        }
        try {
            process.kill(-pid, 'SIGKILL');
            return;
        } catch { /* not a group leader; fall through */ }
        try {
            child.kill('SIGKILL');
        } catch { /* already gone */ }
    }

    protected append(current: string, chunk: unknown): string {
        if (current.length >= MAX_HOOK_OUTPUT_CHARS) {
            return current;
        }
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        return (current + text).slice(0, MAX_HOOK_OUTPUT_CHARS);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

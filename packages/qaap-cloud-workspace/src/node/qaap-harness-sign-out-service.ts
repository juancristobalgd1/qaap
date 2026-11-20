// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import {
    QAAP_BUILTIN_AGENT_IDS,
    resolveQaapBuiltinAgentSignOut,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    isQaapHarnessSettingsId,
    resolveQaapHarnessBaseId,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import type { QaapHarnessSignOutResult } from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
import {
    QaapHarnessCredentialPathError,
    removeHarnessCredentialFiles,
    stripHarnessJsonCredentialKeys,
} from './qaap-harness-credential-remover';
import { QaapAgentTaskRunner, type QaapHarnessCliInvocation } from './qaap-agent-task-runner';

/** Upper bound for a non-interactive CLI logout command before SIGTERM. */
export const QAAP_HARNESS_SIGN_OUT_TIMEOUT_MS = 10_000;
/** Grace period after SIGTERM before SIGKILL on a wedged logout command. */
const QAAP_HARNESS_SIGN_OUT_KILL_GRACE_MS = 1_500;
/** Cap captured stderr/stdout bytes from a logout command so a noisy CLI never balloons memory. */
const QAAP_HARNESS_SIGN_OUT_OUTPUT_MAX_BYTES = 8 * 1024;

export interface QaapHarnessCliLogoutOutcome {
    readonly ok: boolean;
    readonly timedOut?: boolean;
    readonly exitCode?: number | null;
    readonly message?: string;
}

/**
 * Signs the current owner out of one built-in harness using only the declared strategy in
 * `QAAP_BUILTIN_AGENT_DEFINITIONS`:
 * - `cli`: runs the CLI's logout subcommand in the owner's tenant wrapper/environment with stdin
 *   closed and a bounded timeout;
 * - `files` / `json-keys`: removes only the allowlisted credential file(s) or top-level JSON keys
 *   under the owner's allowed roots (never Settings API keys, never outside the root).
 * - `none` or unknown: refused fail-closed.
 */
@injectable()
export class QaapHarnessSignOutService {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    async signOut(harnessId: string, ownerLogin?: string): Promise<QaapHarnessSignOutResult> {
        const normalizedId = harnessId.trim().toLowerCase();
        if (!normalizedId || !isQaapHarnessSettingsId(normalizedId, QAAP_BUILTIN_AGENT_IDS)) {
            return {
                ok: false,
                harnessId: normalizedId,
                connectionState: 'unknown',
                reason: 'unsupported',
                message: 'Unknown harness.',
            };
        }
        const baseId = resolveQaapHarnessBaseId(normalizedId);
        const strategy = resolveQaapBuiltinAgentSignOut(baseId);
        if (!strategy || strategy.kind === 'none') {
            return {
                ok: false,
                harnessId: normalizedId,
                connectionState: 'unknown',
                reason: 'unsupported',
                message: strategy?.kind === 'none'
                    ? strategy.reason
                    : 'Sign out is not supported for this harness.',
            };
        }

        if (strategy.kind === 'cli') {
            const invocation = await this.runner.resolveHarnessCliInvocation(normalizedId, strategy.args, {
                ownerLogin,
                extraEnv: strategy.env,
            });
            if (!invocation) {
                return {
                    ok: false,
                    harnessId: normalizedId,
                    connectionState: 'unknown',
                    reason: 'unavailable',
                    message: 'Harness CLI is not available for sign out.',
                };
            }
            const outcome = await this.runCliLogout(invocation);
            if (!outcome.ok) {
                return {
                    ok: false,
                    harnessId: normalizedId,
                    connectionState: 'unknown',
                    reason: 'failed',
                    message: outcome.message ?? (outcome.timedOut ? 'Harness sign out timed out.' : 'Harness sign out command failed.'),
                };
            }
        } else {
            // File- and JSON-key-based sign-out targets the base harness's credential file; never
            // allow an extra harness instance id to touch the base harness's credentials.
            if (normalizedId !== baseId) {
                return {
                    ok: false,
                    harnessId: normalizedId,
                    connectionState: 'unknown',
                    reason: 'unsupported',
                    message: 'Sign out is not supported for this harness instance.',
                };
            }
            const roots = this.runner.resolveHarnessCredentialRoots(ownerLogin);
            if (!roots) {
                return {
                    ok: false,
                    harnessId: normalizedId,
                    connectionState: 'unknown',
                    reason: 'unavailable',
                    message: 'Harness credential storage is not accessible from this host.',
                };
            }
            try {
                if (strategy.kind === 'files') {
                    removeHarnessCredentialFiles(strategy.paths, roots);
                } else {
                    stripHarnessJsonCredentialKeys(strategy.path, strategy.keys, roots);
                }
            } catch (error) {
                const message = error instanceof QaapHarnessCredentialPathError
                    ? error.message
                    : 'Could not remove harness credentials.';
                return {
                    ok: false,
                    harnessId: normalizedId,
                    connectionState: 'unknown',
                    reason: 'failed',
                    message,
                };
            }
        }

        this.runner.forgetAgentSession(normalizedId, ownerLogin);
        const connectionState = await this.runner.agentConnectionStateFresh(normalizedId, ownerLogin);
        return {
            ok: true,
            harnessId: normalizedId,
            connectionState: connectionState ?? 'disconnected',
        };
    }

    /** Overridable in tests. Executes the logout CLI non-interactively with closed stdin and timeout. */
    protected runCliLogout(
        invocation: QaapHarnessCliInvocation,
        timeoutMs = QAAP_HARNESS_SIGN_OUT_TIMEOUT_MS,
    ): Promise<QaapHarnessCliLogoutOutcome> {
        return new Promise(resolve => {
            let settled = false;
            let timedOut = false;
            let stderrBytes = 0;
            const stderrChunks: Buffer[] = [];
            let killTimer: NodeJS.Timeout | undefined;

            const finish = (outcome: QaapHarnessCliLogoutOutcome): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutHandle);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                resolve(outcome);
            };

            let child;
            try {
                child = spawn(invocation.file, [...invocation.args], {
                    cwd: invocation.cwd,
                    env: invocation.env,
                    stdio: ['ignore', 'ignore', 'pipe'],
                    windowsHide: true,
                });
            } catch (error) {
                finish({
                    ok: false,
                    message: error instanceof Error ? error.message : 'Could not start harness logout command.',
                });
                return;
            }

            child.stderr?.on('data', (chunk: Buffer) => {
                if (stderrBytes >= QAAP_HARNESS_SIGN_OUT_OUTPUT_MAX_BYTES) {
                    return;
                }
                const remaining = QAAP_HARNESS_SIGN_OUT_OUTPUT_MAX_BYTES - stderrBytes;
                const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
                stderrChunks.push(slice);
                stderrBytes += slice.length;
            });

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                try {
                    child.kill('SIGTERM');
                } catch {
                    // Process already exited.
                }
                killTimer = setTimeout(() => {
                    try {
                        child.kill('SIGKILL');
                    } catch {
                        // Process already exited.
                    }
                    finish({ ok: false, timedOut: true, message: 'Harness sign out timed out.' });
                }, QAAP_HARNESS_SIGN_OUT_KILL_GRACE_MS);
            }, timeoutMs);

            child.on('error', error => {
                finish({ ok: false, message: error.message || 'Harness sign out command failed to start.' });
            });

            child.on('close', code => {
                if (timedOut) {
                    finish({ ok: false, timedOut: true, exitCode: code, message: 'Harness sign out timed out.' });
                    return;
                }
                if (code === 0) {
                    finish({ ok: true, exitCode: 0 });
                    return;
                }
                const firstLine = Buffer.concat(stderrChunks).toString('utf8')
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .find(Boolean);
                finish({
                    ok: false,
                    exitCode: code,
                    message: firstLine || `Harness sign out exited with code ${code ?? 'unknown'}.`,
                });
            });
        });
    }
}

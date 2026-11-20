// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { TerminalProcessFactory } from '@theia/process/lib/node/terminal-process';
import { spawn } from 'child_process';
import {
    QAAP_BUILTIN_AGENT_IDS,
    resolveQaapBuiltinAgentSignOut,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    isQaapHarnessSettingsId,
    resolveQaapHarnessBaseId,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';
import {
    findQaapHarnessEnvCredentials,
    resolveQaapHarnessSignOutForBin,
    type QaapHarnessConcreteSignOut,
    type QaapHarnessSignOutResult,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-sign-out';
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
/** Cap rolling PTY buffer inspected for TUI prompt / logout confirmation matching. */
const QAAP_HARNESS_TUI_SIGN_OUT_BUFFER_LIMIT = 16_000;

type QaapHarnessTuiSignOutStrategy = Extract<QaapHarnessConcreteSignOut, { readonly kind: 'tui' }>;

export interface QaapHarnessCliLogoutOutcome {
    readonly ok: boolean;
    readonly timedOut?: boolean;
    readonly exitCode?: number | null;
    readonly message?: string;
}

function stripTerminalEscapeSequences(value: string): string {
    return value
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
        .replace(/\r/g, '');
}

/**
 * Signs the current owner out of one built-in harness using only the declared strategy in
 * `QAAP_BUILTIN_AGENT_DEFINITIONS`:
 * - `cli`: runs the CLI's logout subcommand in the owner's tenant wrapper/environment with stdin
 *   closed and a bounded timeout;
 * - `tui`: drives the CLI's interactive logout command (e.g. `agy` `/logout`) in a bounded headless
 *   PTY using the declared steps and confirmation patterns;
 * - `files` / `json-keys`: removes only the allowlisted credential file(s) or top-level JSON/JSONC
 *   keys under the owner's allowed roots (never Settings API keys, never outside the root);
 * - `by-bin`: dispatches to the concrete strategy matching the detected binary (`agy` vs `gemini`);
 * - `none` or unknown: refused fail-closed.
 */
@injectable()
export class QaapHarnessSignOutService {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    @inject(TerminalProcessFactory)
    @optional()
    protected readonly terminalProcessFactory?: TerminalProcessFactory;

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
        const declared = resolveQaapBuiltinAgentSignOut(baseId);
        const detectedBin = this.runner.detectedAgentBin(baseId);
        const strategy = resolveQaapHarnessSignOutForBin(declared, detectedBin);
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

        if (strategy.kind === 'cli' || strategy.kind === 'tui') {
            const invocation = await this.runner.resolveHarnessCliInvocation(normalizedId, strategy.args ?? [], {
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
            const outcome = strategy.kind === 'cli'
                ? await this.runCliLogout(invocation)
                : await this.runTuiLogout(invocation, strategy);
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
        if (connectionState === 'connected') {
            // The command ran, but the harness still answers with a session: never report a sign-out that did
            // not happen. The usual cause is a credential the harness inherits from the environment.
            return {
                ok: false,
                harnessId: normalizedId,
                connectionState,
                reason: 'failed',
                message: await this.stillSignedInMessage(normalizedId, baseId, ownerLogin),
            };
        }
        return {
            ok: true,
            harnessId: normalizedId,
            connectionState: connectionState ?? 'disconnected',
        };
    }

    /** Why a harness still has a session after signing out: the inherited variables by name, never their values. */
    protected async stillSignedInMessage(harnessId: string, baseId: string, ownerLogin?: string): Promise<string> {
        const invocation = await this.runner.resolveHarnessCliInvocation(harnessId, [], { ownerLogin }).catch(() => undefined);
        const names = invocation ? findQaapHarnessEnvCredentials(baseId, invocation.env) : [];
        return names.length > 0
            ? `It still has a session from the environment (${names.join(', ')}). Remove that variable where the app starts to sign out.`
            : 'It still reports a session after signing out.';
    }

    /** Overridable in tests. Drives a TUI-based logout (e.g. `agy` `/logout`) in a bounded PTY. */
    protected runTuiLogout(
        invocation: QaapHarnessCliInvocation,
        strategy: QaapHarnessTuiSignOutStrategy,
    ): Promise<QaapHarnessCliLogoutOutcome> {
        const factory = this.terminalProcessFactory;
        if (!factory) {
            return Promise.resolve({
                ok: false,
                message: 'Interactive terminal is not available for harness sign out.',
            });
        }
        const timeoutMs = strategy.timeoutMs ?? QAAP_HARNESS_SIGN_OUT_TIMEOUT_MS;
        const successRegexes = strategy.successPatterns.map(source => new RegExp(source, 'i'));
        const steps = strategy.steps.map(step => ({
            waitFor: step.waitFor ? new RegExp(step.waitFor, 'i') : undefined,
            send: step.text,
            fallbackMs: step.fallbackMs,
        }));

        return new Promise(resolve => {
            let settled = false;
            let stepIndex = 0;
            let buffer = '';
            let fullOutput = '';
            let stepTimer: NodeJS.Timeout | undefined;
            let timeoutHandle: NodeJS.Timeout | undefined;
            let exitDisposable: { dispose(): void } | undefined;
            let errorDisposable: { dispose(): void } | undefined;
            let dataListener: ((chunk: Buffer | string) => void) | undefined;

            let pty: ReturnType<TerminalProcessFactory>;
            try {
                pty = factory({
                    command: invocation.file,
                    args: [...invocation.args],
                    options: {
                        cwd: invocation.cwd,
                        env: invocation.env,
                    },
                });
            } catch (error) {
                resolve({
                    ok: false,
                    message: error instanceof Error ? error.message : 'Could not start interactive harness logout.',
                });
                return;
            }

            const clearStepTimer = (): void => {
                if (stepTimer !== undefined) {
                    clearTimeout(stepTimer);
                    stepTimer = undefined;
                }
            };

            const finish = (outcome: QaapHarnessCliLogoutOutcome): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearStepTimer();
                if (timeoutHandle !== undefined) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = undefined;
                }
                exitDisposable?.dispose();
                errorDisposable?.dispose();
                if (dataListener) {
                    pty.outputStream.off('data', dataListener);
                }
                try {
                    pty.kill();
                } catch {
                    // PTY already exited.
                }
                resolve(outcome);
            };

            const sendCurrentStep = (): void => {
                if (settled || stepIndex >= steps.length) {
                    return;
                }
                clearStepTimer();
                const current = steps[stepIndex];
                stepIndex++;
                buffer = '';
                try {
                    pty.write(current.send);
                } catch (error) {
                    finish({
                        ok: false,
                        message: error instanceof Error ? error.message : 'Could not write to interactive harness logout.',
                    });
                    return;
                }
                scheduleCurrentStep();
            };

            const scheduleCurrentStep = (): void => {
                if (settled || stepIndex >= steps.length) {
                    return;
                }
                const current = steps[stepIndex];
                if (!current.waitFor || current.waitFor.test(buffer)) {
                    sendCurrentStep();
                    return;
                }
                if (current.fallbackMs && stepTimer === undefined) {
                    stepTimer = setTimeout(() => {
                        stepTimer = undefined;
                        sendCurrentStep();
                    }, current.fallbackMs);
                }
            };

            dataListener = (chunk: Buffer | string) => {
                if (settled) {
                    return;
                }
                const cleaned = stripTerminalEscapeSequences(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
                if (!cleaned) {
                    return;
                }
                buffer = `${buffer}${cleaned}`.slice(-QAAP_HARNESS_TUI_SIGN_OUT_BUFFER_LIMIT);
                if (fullOutput.length < QAAP_HARNESS_SIGN_OUT_OUTPUT_MAX_BYTES) {
                    fullOutput = `${fullOutput}${cleaned}`.slice(0, QAAP_HARNESS_SIGN_OUT_OUTPUT_MAX_BYTES);
                }
                if (successRegexes.some(pattern => pattern.test(buffer))) {
                    finish({ ok: true, exitCode: 0 });
                    return;
                }
                if (stepIndex < steps.length) {
                    const current = steps[stepIndex];
                    if (current.waitFor && current.waitFor.test(buffer)) {
                        sendCurrentStep();
                    }
                }
            };

            pty.outputStream.on('data', dataListener);

            errorDisposable = pty.onError(error => {
                finish({ ok: false, message: error.message || 'Interactive harness sign out failed to start.' });
            });

            exitDisposable = pty.onExit(event => {
                if (successRegexes.some(pattern => pattern.test(fullOutput))) {
                    finish({ ok: true, exitCode: event.code ?? 0 });
                    return;
                }
                if (stepIndex >= steps.length && event.code === 0) {
                    finish({ ok: true, exitCode: 0 });
                    return;
                }
                const lastLine = fullOutput
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(Boolean)
                    .pop();
                finish({
                    ok: false,
                    exitCode: event.code ?? null,
                    message: lastLine || 'Harness sign out exited before confirming logout.',
                });
            });

            timeoutHandle = setTimeout(() => {
                finish({ ok: false, timedOut: true, message: 'Harness sign out timed out.' });
            }, timeoutMs);

            scheduleCurrentStep();
        });
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

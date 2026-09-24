// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { extractAgentAuthLoginChallenge } from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import { resolveInteractiveAgentLoginCommand } from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { resolveAgentDisplayLabel } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { createTranscriptTerminalStagingHost, createTranscriptTerminalSurface } from '@theia/qaap-transcript/lib/browser/qaap-transcript-terminal-view';
import { createQaapAgentLoginDialog, type QaapAgentLoginDialogController } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-login-dialog';
import { resolveAgentLoginCwd } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-login-cwd';

function stripTerminalControlSequences(value: string): string {
    return value
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
        .replace(/\r/g, '');
}

function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

/** Runs the real CLI login without selecting or exposing the transcript terminal tab. */
export async function openAgentLoginDialogInBackground(
    ctx: any,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    agentId: string,
    onConnected?: () => boolean | void | Promise<boolean | void>,
): Promise<void> {
    const command = resolveInteractiveAgentLoginCommand(agentId);
    if (!command) {
        return;
    }

    let dialog: QaapAgentLoginDialogController | undefined;
    let staging: HTMLElement | undefined;
    let surface: any;
    let outputListener: { dispose(): void } | undefined;
    let pollHandle: number | undefined;
    let connectionPollHandle: number | undefined;
    let successCloseHandle: number | undefined;
    let connectionPollInFlight = false;
    let refreshConnectionState: (() => Promise<void>) | undefined;
    let closed = false;
    let output = '';

    const disposeTerminal = (): void => {
        if (pollHandle !== undefined) {
            window.clearInterval(pollHandle);
            pollHandle = undefined;
        }
        if (connectionPollHandle !== undefined) {
            window.clearInterval(connectionPollHandle);
            connectionPollHandle = undefined;
        }
        if (successCloseHandle !== undefined) {
            window.clearTimeout(successCloseHandle);
            successCloseHandle = undefined;
        }
        if (refreshConnectionState) {
            window.removeEventListener('focus', refreshConnectionState);
            window.removeEventListener('pageshow', refreshConnectionState);
            refreshConnectionState = undefined;
        }
        outputListener?.dispose();
        outputListener = undefined;
        if (surface) {
            try {
                surface.dispose.dispose();
            } catch {
                // The PTY may already have closed while the dialog was being dismissed.
            }
            surface = undefined;
        }
        staging?.remove();
        staging = undefined;
    };

    const close = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        disposeTerminal();
        dialog?.dispose();
    };

    const completeConnection = (): void => {
        if (closed || successCloseHandle !== undefined) {
            return;
        }
        dialog?.setConnected();
        successCloseHandle = window.setTimeout(close, 1800);
    };

    dialog = createQaapAgentLoginDialog({
        agentLabel: resolveAgentDisplayLabel(agentId),
        onClose: close,
    });

    try {
        const cwd = await resolveAgentLoginCwd(ctx, project, summary);
        const services = ctx.createTranscriptTerminalViewServices?.();
        if (!cwd || !services) {
            throw new Error('workspace terminal unavailable');
        }

        staging = createTranscriptTerminalStagingHost();
        surface = await createTranscriptTerminalSurface(staging, cwd, services);
        if (closed || !surface || surface.terminal.isDisposed) {
            return;
        }

        outputListener = surface.terminal.onOutput((chunk: string) => {
            output = `${output}${stripTerminalControlSequences(chunk)}`.slice(-16000);
            const challenge = extractAgentAuthLoginChallenge(output, {
                preferMode: 'session',
                agentId,
            });
            if (challenge) {
                dialog?.setChallenge(challenge);
            }
        });

        await wait(120);
        if (closed || surface.terminal.isDisposed) {
            return;
        }
        surface.terminal.sendText(`${command}\n`);

        refreshConnectionState = async (): Promise<void> => {
            if (closed || connectionPollInFlight || !onConnected) {
                return;
            }
            connectionPollInFlight = true;
            try {
                const connected = await onConnected();
                if (connected === true && !closed) {
                    completeConnection();
                }
            } catch (error) {
                console.warn('[qaap] Agent login connection refresh failed:', error);
            } finally {
                connectionPollInFlight = false;
            }
        };

        if (onConnected) {
            // The browser can return from device authorization before the CLI prints its final
            // line. Start immediately and keep polling; waiting for the challenge parser made the
            // VPS miss successful callbacks when a provider changed its terminal wording.
            void refreshConnectionState();
            connectionPollHandle = window.setInterval(() => {
                void refreshConnectionState?.();
            }, 2500);
            window.addEventListener('focus', refreshConnectionState);
            window.addEventListener('pageshow', refreshConnectionState);
        }

        pollHandle = window.setInterval(() => {
            if (closed || !surface || surface.terminal.isDisposed) {
                return;
            }
            const exitCode = surface.terminal.exitStatus?.code;
            if (typeof exitCode !== 'number') {
                return;
            }
            if (pollHandle !== undefined) {
                window.clearInterval(pollHandle);
                pollHandle = undefined;
            }
            outputListener?.dispose();
            outputListener = undefined;
            if (exitCode === 0) {
                completeConnection();
                void Promise.resolve(onConnected?.()).catch(error => {
                    console.warn('[qaap] Agent login UI refresh failed:', error);
                });
            } else {
                dialog?.setFailed(nls.localize(
                    'qaap/mobileProjects/agentLoginDialogProcessFailed',
                    'The {0} sign-in process ended before it connected.',
                    resolveAgentDisplayLabel(agentId),
                ));
                disposeTerminal();
            }
        }, 500);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[qaap] Agent login terminal unavailable:', reason);
        if (!closed) {
            dialog.setFailed(nls.localize(
                'qaap/mobileProjects/agentLoginDialogUnavailable',
                'Secure sign-in is not available for this workspace.',
            ));
            disposeTerminal();
        }
    }
}

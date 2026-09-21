// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { extractAgentAuthLoginChallenge } from '../common/qaap-agent-auth-login';
import { resolveInteractiveAgentLoginCommand } from '../common/qaap-agent-tui-command';
import type { MobileProjectEntry } from './mobile-projects-types';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { createTranscriptTerminalStagingHost, createTranscriptTerminalSurface } from './qaap-transcript-terminal-view';
import { createQaapAgentLoginDialog, type QaapAgentLoginDialogController } from './qaap-agent-login-dialog';

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
    let successCloseHandle: number | undefined;
    let closed = false;
    let output = '';

    const disposeTerminal = (): void => {
        if (pollHandle !== undefined) {
            window.clearInterval(pollHandle);
            pollHandle = undefined;
        }
        if (successCloseHandle !== undefined) {
            window.clearTimeout(successCloseHandle);
            successCloseHandle = undefined;
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

    dialog = createQaapAgentLoginDialog({
        agentLabel: resolveAgentDisplayLabel(agentId),
        onClose: close,
    });

    try {
        const cwd = ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
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
                dialog?.setConnected();
                successCloseHandle = window.setTimeout(close, 1800);
            } else {
                dialog?.setFailed(nls.localize(
                    'qaap/mobileProjects/agentLoginDialogProcessFailed',
                    'The {0} sign-in process ended before it connected.',
                    resolveAgentDisplayLabel(agentId),
                ));
                disposeTerminal();
            }
        }, 500);
    } catch {
        if (!closed) {
            dialog.setFailed(nls.localize(
                'qaap/mobileProjects/agentLoginDialogUnavailable',
                'Secure sign-in is not available for this workspace.',
            ));
            disposeTerminal();
        }
    }
}

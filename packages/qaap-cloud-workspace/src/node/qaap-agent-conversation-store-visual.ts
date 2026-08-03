// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Visual verification helpers extracted from QaapAgentConversationStore.
// Pure functions that operate only on their parameters.

import * as path from 'path';
import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { VISUAL_EVIDENCE_DIR, MAX_VISUAL_REPAIR_ATTEMPTS } from './qaap-agent-conversation-store-constants';

export function visualEvidenceDirectory(conversationId: string): string {
    return path.join(VISUAL_EVIDENCE_DIR, conversationId);
}

/**
 * The agent message evidence may attach to. With an explicit target (the message the capturing
 * frontend saw when the turn settled) the conversation status is irrelevant — auto-continue or
 * a follow-up user turn may have flipped it back to `streaming` while the dev server was still
 * booting, and rejecting on status was silently dropping every slow capture. The target must
 * still be the newest agent reply: when a newer turn already replaced it, the stale screenshot
 * is dropped and the newer turn's own settlement re-triggers a fresh capture.
 */
export function resolveVisualEvidenceTarget(
    conv: QaapAgentConversation,
    targetAgentMessageId: string | undefined,
): QaapAgentMessage | undefined {
    const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
    if (!lastAgent) {
        return undefined;
    }
    if (targetAgentMessageId !== undefined) {
        return lastAgent.id === targetAgentMessageId ? lastAgent : undefined;
    }
    // Legacy reports (no target): only trust them while the backend turn is truly idle.
    return conv.status === 'idle' ? lastAgent : undefined;
}

/** User turn whose agent reply owns the evidence target (array adjacency is only a legacy fallback). */
export function resolveVisualRepairSourceUserMessage(
    conv: QaapAgentConversation,
    target: QaapAgentMessage,
): QaapAgentMessage | undefined {
    if (target.runUserMessageId) {
        const runUser = conv.messages.find(message =>
            message.id === target.runUserMessageId && message.role === 'user'
        );
        if (runUser) {
            return runUser;
        }
    }
    const targetIndex = conv.messages.findIndex(message => message.id === target.id);
    for (let index = targetIndex - 1; index >= 0; index--) {
        if (conv.messages[index].role === 'user') {
            return conv.messages[index];
        }
    }
    return undefined;
}

export function countVisualRepairAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number {
    return conv.messages.filter(message =>
        message.role === 'user'
        && message.visualRepairRootMessageId === rootUserMessageId
        && typeof message.visualRepairAttempt === 'number'
    ).length;
}

export function buildVisualRepairPrompt(target: QaapAgentMessage, attempt: number): string {
    const markerIndex = target.content.lastIndexOf('[QAAP visual verification]');
    const evidence = (markerIndex >= 0 ? target.content.slice(markerIndex) : target.content)
        .trim()
        .slice(0, 3_000);
    return [
        nls.localize(
            'qaap/visualRepair/heading',
            'Automatic visual repair attempt {0} of {1}.',
            attempt,
            MAX_VISUAL_REPAIR_ATTEMPTS,
        ),
        nls.localize(
            'qaap/visualRepair/instruction',
            'The real browser render failed. Inspect the evidence and findings below, reproduce the problem in this same workspace, edit the app until the blocking render/runtime findings are fixed, and verify the change. An HTTP response alone is not visual success.',
        ),
        nls.localize(
            'qaap/visualRepair/capture',
            'Finish your reply with [QAAP capture] so Qaap runs the browser validation again. Do not claim success before that validation.',
        ),
        '',
        evidence,
    ].join('\n\n');
}

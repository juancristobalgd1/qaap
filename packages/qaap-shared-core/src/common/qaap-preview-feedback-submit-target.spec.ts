// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID } from './qaap-agents-hub-landing';
import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';
import { resolvePreviewFeedbackSubmitTarget } from './qaap-preview-feedback-submit-target';

function summary(partial: Partial<QaapAgentConversationSummaryDTO> & { id: string }): QaapAgentConversationSummaryDTO {
    return {
        cwd: '/tmp/proj',
        workspacePath: '/tmp/proj',
        agentId: 'codex',
        title: 'Task',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 0,
        ...partial,
    };
}

describe('resolvePreviewFeedbackSubmitTarget', () => {
    it('uses the open non-idle conversation when present', () => {
        const open = summary({ id: 'conv-open', status: 'idle' });
        const target = resolvePreviewFeedbackSubmitTarget(open, summary({ id: 'conv-composer' }));
        expect(target).to.deep.equal({ kind: 'active', summary: open });
    });

    it('falls back to composer summary when open is idle', () => {
        const idle = summary({ id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID });
        const composer = summary({ id: 'conv-live', status: 'streaming' });
        const target = resolvePreviewFeedbackSubmitTarget(idle, composer);
        expect(target).to.deep.equal({ kind: 'active', summary: composer });
    });

    it('targets a new idle submit when both summaries are idle or missing', () => {
        const idle = summary({ id: QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID });
        expect(resolvePreviewFeedbackSubmitTarget(idle, idle)).to.deep.equal({ kind: 'idle' });
        expect(resolvePreviewFeedbackSubmitTarget(undefined, undefined)).to.deep.equal({ kind: 'idle' });
        expect(resolvePreviewFeedbackSubmitTarget(idle, undefined)).to.deep.equal({ kind: 'idle' });
    });

    it('never targets legacy theia-chat sessions (backend post would fail)', () => {
        const theiaChat = summary({ id: 'chat-1', source: 'theia-chat' });
        expect(resolvePreviewFeedbackSubmitTarget(theiaChat, undefined)).to.deep.equal({ kind: 'idle' });
        const backend = summary({ id: 'conv-2', source: 'qaap-agent' });
        expect(resolvePreviewFeedbackSubmitTarget(theiaChat, backend)).to.deep.equal({ kind: 'active', summary: backend });
    });
});

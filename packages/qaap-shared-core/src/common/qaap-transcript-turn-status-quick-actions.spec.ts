// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import { resolveTranscriptComposerQuickActionsMode } from './qaap-transcript-turn-status';

function conversation(overrides: Partial<QaapAgentConversationDTO> = {}): QaapAgentConversationDTO {
    return {
        id: 'c1',
        cwd: '/workspace/app',
        agentId: 'agent',
        title: 'Chat',
        status: 'idle',
        createdAt: 0,
        updatedAt: 0,
        messages: [],
        ...overrides,
    } as QaapAgentConversationDTO;
}

const userMessage = { id: 'm1', role: 'user', content: 'hi', createdAt: 1 } as unknown as QaapAgentConversationDTO['messages'][number];

describe('resolveTranscriptComposerQuickActionsMode', () => {
    it('shows the full chip row on an empty chat', () => {
        expect(resolveTranscriptComposerQuickActionsMode(conversation(), undefined, false)).to.equal('full');
    });

    it('hides the row once the user has sent a message and no preview is starting', () => {
        const conv = conversation({ messages: [userMessage] });
        expect(resolveTranscriptComposerQuickActionsMode(conv, undefined, false)).to.equal('hidden');
    });

    it('keeps the preview chip visible while a preview starts after the chat left its empty state', () => {
        const conv = conversation({ messages: [userMessage] });
        expect(resolveTranscriptComposerQuickActionsMode(conv, undefined, true)).to.equal('preview-only');
    });

    it('does not show the full row while streaming, but keeps the preview chip when starting', () => {
        const conv = conversation({ status: 'streaming' });
        expect(resolveTranscriptComposerQuickActionsMode(conv, undefined, false)).to.equal('hidden');
        expect(resolveTranscriptComposerQuickActionsMode(conv, undefined, true)).to.equal('preview-only');
    });

    it('treats a cached user message as leaving the empty state', () => {
        const cached = { id: 'c1', messages: [userMessage] };
        expect(resolveTranscriptComposerQuickActionsMode(conversation(), cached, false)).to.equal('hidden');
    });
});

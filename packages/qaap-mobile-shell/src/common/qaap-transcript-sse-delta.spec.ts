// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    applyConversationMessageDelta,
    appendOptimisticPendingUserMessage,
    agentMessageDeltaChanged,
    canApplySseMessageDelta,
    shouldSkipStreamingTranscriptRefetch,
} from './qaap-transcript-sse-delta';

const baseConv = (): QaapAgentConversationDTO => ({
    id: 'conv-1',
    cwd: '/repo',
    agentId: 'qaiq',
    title: 'Test',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 10,
    messages: [{
        id: 'user-1',
        role: 'user',
        content: 'hi',
        createdAt: 5,
    }],
});

describe('canApplySseMessageDelta', () => {
    it('accepts structured agent segments for QAIQ', () => {
        expect(canApplySseMessageDelta(baseConv(), 'conv-1', {
            id: 'agent-1',
            role: 'agent',
            content: '…',
            segments: [{ type: 'text', content: 'Hello' }],
            createdAt: 12,
        })).to.equal(true);
    });

    it('rejects unknown conversations', () => {
        expect(canApplySseMessageDelta(baseConv(), 'other', {
            id: 'agent-1',
            role: 'agent',
            content: 'Hello',
            createdAt: 12,
        })).to.equal(false);
    });

    it('rejects brand-new agent rows after the turn has settled', () => {
        const idle = { ...baseConv(), status: 'idle' as const };
        expect(canApplySseMessageDelta(idle, 'conv-1', {
            id: 'agent-1',
            role: 'agent',
            content: 'late chunk',
            createdAt: 30,
        })).to.equal(false);
    });

    it('accepts in-place agent updates after settle (visual evidence attachment)', () => {
        const idle = {
            ...baseConv(),
            status: 'idle' as const,
            messages: [
                ...baseConv().messages,
                {
                    id: 'agent-1',
                    role: 'agent' as const,
                    content: 'Done.\n[QAAP record: /]',
                    createdAt: 20,
                },
            ],
        };
        expect(canApplySseMessageDelta(idle, 'conv-1', {
            id: 'agent-1',
            role: 'agent',
            content: 'Done.\n[QAAP record: /]\n\n---\n\n[QAAP visual verification]\nRecorded a video tour of 1 page.',
            createdAt: 21,
        })).to.equal(true);
    });

    it('accepts codex stdout agent chunks with plain content', () => {
        const conv = { ...baseConv(), agentId: 'codex' };
        expect(canApplySseMessageDelta(conv, 'conv-1', {
            id: 'agent-1',
            role: 'agent',
            content: 'plain stdout',
            createdAt: 12,
        })).to.equal(true);
    });
});

describe('shouldSkipStreamingTranscriptRefetch', () => {
    it('returns true while streaming and a recent SSE delta was applied', () => {
        const conv = { ...baseConv(), status: 'streaming' as const };
        expect(shouldSkipStreamingTranscriptRefetch(conv, Date.now())).to.equal(true);
        expect(shouldSkipStreamingTranscriptRefetch(conv, Date.now() - 20_000)).to.equal(false);
    });
});

describe('applyConversationMessageDelta', () => {
    it('appends a new agent message', () => {
        const next = applyConversationMessageDelta(baseConv(), {
            id: 'agent-1',
            role: 'agent',
            content: 'Hello',
            segments: [{ type: 'text', content: 'Hello' }],
            createdAt: 20,
        });
        expect(next.messages).to.have.length(2);
        expect(next.messages[1]?.id).to.equal('agent-1');
        expect(next.updatedAt).to.equal(20);
        expect(next.status).to.equal('streaming');
    });

    it('updates an existing agent message in place', () => {
        const withAgent = applyConversationMessageDelta(baseConv(), {
            id: 'agent-1',
            role: 'agent',
            content: 'Hel',
            segments: [{ type: 'text', content: 'Hel' }],
            createdAt: 20,
        });
        const next = applyConversationMessageDelta(withAgent, {
            id: 'agent-1',
            role: 'agent',
            content: 'Hello',
            segments: [{ type: 'text', content: 'Hello' }],
            createdAt: 21,
        });
        expect(next.messages).to.have.length(2);
        expect(next.messages[1]?.content).to.equal('Hello');
        expect(next.updatedAt).to.equal(21);
    });

    it('returns the same snapshot when the agent message did not change', () => {
        const agent = {
            id: 'agent-1',
            role: 'agent' as const,
            content: 'Hello',
            segments: [{ type: 'text' as const, content: 'Hello' }],
            createdAt: 20,
        };
        const conv = applyConversationMessageDelta(baseConv(), agent);
        const again = applyConversationMessageDelta(conv, { ...agent, createdAt: 99 });
        expect(again).to.equal(conv);
        expect(agentMessageDeltaChanged(agent, { ...agent, createdAt: 99 })).to.equal(false);
    });

    // The turn-provenance badge is fed by turnAgentId/turnAgentModel on the USER row. Both a first
    // seal and a fallback-model re-attribution change nothing else about that row, so a fingerprint
    // blind to them makes applyConversationMessageDelta early-return the unchanged conversation and
    // the badge stays wrong for the rest of the session.
    it('merges a turn-provenance seal that changes nothing else on the user row', () => {
        const conv = baseConv();
        const sealed = {
            ...conv.messages[0],
            turnAgentId: 'claude',
            turnAgentModel: { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'claude-4-sonnet' },
        };
        expect(agentMessageDeltaChanged(conv.messages[0], sealed), 'a provenance seal is a real change').to.equal(true);
        const merged = applyConversationMessageDelta(conv, sealed);
        expect(merged, 'the merge is not skipped').to.not.equal(conv);
        expect(merged.messages[0].turnAgentId).to.equal('claude');
        expect(merged.messages[0].turnAgentModel?.modelId).to.equal('claude-4-sonnet');
    });

    it('merges a fallback-model re-attribution of an already sealed user row', () => {
        const conv = baseConv();
        const sealed = {
            ...conv.messages[0],
            turnAgentId: 'claude',
            turnAgentModel: { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'claude-4-sonnet' },
        };
        const resealed = {
            ...sealed,
            turnAgentModel: { provider: 'openai' as const, vendor: 'openrouter', modelId: 'moonshotai/kimi-k2.6:free' },
        };
        expect(agentMessageDeltaChanged(sealed, resealed), 'a model re-attribution is a real change').to.equal(true);
        const merged = applyConversationMessageDelta({ ...conv, messages: [sealed] }, resealed);
        expect(merged.messages[0].turnAgentModel?.modelId).to.equal('moonshotai/kimi-k2.6:free');
    });

    it('reuses prefix message references when updating the streaming tail', () => {
        const user = { id: 'user-1', role: 'user' as const, content: 'hi', createdAt: 5 };
        const conv = { ...baseConv(), messages: [user] };
        const withAgent = applyConversationMessageDelta(conv, {
            id: 'agent-1',
            role: 'agent',
            content: 'Hel',
            segments: [{ type: 'text', content: 'Hel' }],
            createdAt: 20,
        });
        const next = applyConversationMessageDelta(withAgent, {
            id: 'agent-1',
            role: 'agent',
            content: 'Hello',
            segments: [{ type: 'text', content: 'Hello' }],
            createdAt: 21,
        });
        expect(next.messages[0]).to.equal(user);
    });

    it('replaces an optimistic pending-user row when the real user message arrives via SSE', () => {
        const pending = {
            id: 'pending-user-123',
            role: 'user' as const,
            content: 'fix the bug',
            createdAt: 15,
        };
        const conv = applyConversationMessageDelta(baseConv(), pending);
        const next = applyConversationMessageDelta(conv, {
            id: 'user-real-1',
            role: 'user',
            content: 'fix the bug',
            createdAt: 16,
        });
        expect(next.messages).to.have.length(2);
        expect(next.messages[1]?.id).to.equal('user-real-1');
        expect(next.messages[1]?.content).to.equal('fix the bug');
    });
});

describe('appendOptimisticPendingUserMessage', () => {
    const pending = (content: string, id = 'pending-user-1'): { id: string; role: 'user'; content: string; createdAt: number } => ({
        id,
        role: 'user',
        content,
        createdAt: 20,
    });

    it('replaces a trailing pending-user row instead of stacking another', () => {
        const messages = appendOptimisticPendingUserMessage(
            [{ id: 'pending-user-old', role: 'user', content: 'hello', createdAt: 10 }],
            pending('hello', 'pending-user-new'),
        );
        expect(messages).to.have.length(1);
        expect(messages[0]?.id).to.equal('pending-user-new');
    });

    it('does not duplicate a settled user row with the same content', () => {
        const messages = appendOptimisticPendingUserMessage(
            [{ id: 'user-real', role: 'user', content: 'hello', createdAt: 10 }],
            pending('hello'),
        );
        expect(messages).to.have.length(1);
        expect(messages[0]?.id).to.equal('user-real');
    });

    it('appends when the outbound content is new', () => {
        const messages = appendOptimisticPendingUserMessage(
            [{ id: 'user-real', role: 'user', content: 'hello', createdAt: 10 }],
            pending('follow up'),
        );
        expect(messages).to.have.length(2);
        expect(messages[1]?.id).to.equal('pending-user-1');
    });
});

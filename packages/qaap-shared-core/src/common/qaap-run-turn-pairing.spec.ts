// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pairing an agent turn with the user turn that drove it, once a session runs
// several agents at the same time (MAX_CONCURRENT_CONVERSATION_RUNS > 1).
//
// An agent message is created lazily, on its run's FIRST output, and appended at
// the end of the message array. So a user who sends A (QAIQ) and then B (@claude)
// before A has said anything leaves the array interleaved:
//
//     [userA, userB, agentA, agentB]
//
// Walking back from agentA to the nearest 'user' message lands on userB — the
// wrong turn. That mispairing feeds both the per-run stop button and the turn
// provenance badge, so agentA's accordion would claim it ran Claude.
//
// The fix is an explicit runUserMessageId link sealed onto the agent message when
// its run starts; the walk-back survives only as a fallback for turns recorded
// before the field existed.

import { expect } from 'chai';
import { type QaapAgentMessageDTO, resolveRunUserMessageId } from './qaap-agent-conversation-client';
import {
    applyAgentMessageWireDelta,
    computeAgentMessageWireDelta,
    toAgentMessageWirePayload,
    toAgentMessageWireSnapshot,
} from './qaap-agent-message-wire-delta';

function userMessage(id: string, turnAgentId: string, createdAt: number): QaapAgentMessageDTO {
    return { id, role: 'user', content: `ask ${id}`, createdAt, turnAgentId };
}

function agentMessage(id: string, createdAt: number, runUserMessageId?: string): QaapAgentMessageDTO {
    return {
        id,
        role: 'agent',
        content: `reply ${id}`,
        createdAt,
        ...(runUserMessageId ? { runUserMessageId } : {}),
    };
}

describe('resolveRunUserMessageId with concurrent runs in one session', () => {

    /** `[userA, userB, agentA, agentB]` — the array order two interleaved runs actually produce. */
    function interleavedSession(options?: { readonly sealed?: boolean }): QaapAgentMessageDTO[] {
        const sealed = options?.sealed ?? true;
        return [
            userMessage('user-a', 'qaiq', 1),
            userMessage('user-b', 'claude', 2),
            agentMessage('agent-a', 3, sealed ? 'user-a' : undefined),
            agentMessage('agent-b', 4, sealed ? 'user-b' : undefined),
        ];
    }

    it('pairs the first agent turn with the run that produced it, not the user turn directly above it', () => {
        const messages = interleavedSession();

        expect(resolveRunUserMessageId(messages, 'agent-a')).to.equal('user-a');
        expect(resolveRunUserMessageId(messages, 'agent-b')).to.equal('user-b');
    });

    it('attributes the interleaved turn to the agent that ran it', () => {
        const messages = interleavedSession();

        const driverOf = (agentMessageId: string): string | undefined => {
            const userMessageId = resolveRunUserMessageId(messages, agentMessageId);
            return messages.find(message => message.id === userMessageId)?.turnAgentId;
        };

        // The whole point of the badge: agent-a ran QAIQ even though the newest
        // user message in the session picked Claude.
        expect(driverOf('agent-a'), 'the first run is still attributed to QAIQ').to.equal('qaiq');
        expect(driverOf('agent-b')).to.equal('claude');
    });

    it('falls back to the positional walk-back for turns recorded before the link existed', () => {
        // Historical, strictly sequential transcript: no runUserMessageId anywhere.
        const messages = [
            userMessage('user-1', 'qaiq', 1),
            agentMessage('agent-1', 2),
            userMessage('user-2', 'claude', 3),
            agentMessage('agent-2', 4),
        ];

        expect(resolveRunUserMessageId(messages, 'agent-1')).to.equal('user-1');
        expect(resolveRunUserMessageId(messages, 'agent-2')).to.equal('user-2');
    });

    it('falls back rather than returning a link whose user message is gone', () => {
        // A checkpoint restore (or a partially-synced client) can leave the agent
        // message pointing at a user turn that is no longer in the array.
        const messages = [
            userMessage('user-1', 'qaiq', 1),
            agentMessage('agent-1', 2, 'user-rolled-back'),
        ];

        expect(resolveRunUserMessageId(messages, 'agent-1')).to.equal('user-1');
    });

    it('ignores a link that does not point at a user message', () => {
        const messages = [
            userMessage('user-1', 'qaiq', 1),
            agentMessage('agent-1', 2),
            agentMessage('agent-2', 3, 'agent-1'),
        ];

        expect(resolveRunUserMessageId(messages, 'agent-2')).to.equal('user-1');
    });

    it('returns undefined for an unknown message and for a run with no user turn at all', () => {
        const messages = interleavedSession();

        expect(resolveRunUserMessageId(messages, 'nope')).to.equal(undefined);
        expect(resolveRunUserMessageId(messages, undefined)).to.equal(undefined);
        expect(resolveRunUserMessageId([agentMessage('agent-orphan', 1)], 'agent-orphan')).to.equal(undefined);
    });
});

describe('runUserMessageId on the SSE wire', () => {

    const sealed = agentMessage('agent-a', 3, 'user-a');

    it('survives the message_start frame the live stream sends on first sight of a turn', () => {
        const delta = computeAgentMessageWireDelta(undefined, toAgentMessageWireSnapshot(sealed), 'qaiq');
        expect(delta.kind).to.equal('message_start');

        const applied = applyAgentMessageWireDelta({ messages: [] }, delta);

        expect(applied?.runUserMessageId, 'the run link reaches the browser').to.equal('user-a');
    });

    it('survives a replace frame', () => {
        const previous = toAgentMessageWireSnapshot({
            ...sealed,
            segments: [{ type: 'text', content: 'one' }],
        });
        const next = toAgentMessageWireSnapshot({
            ...sealed,
            segments: [{ type: 'text', content: 'one' }, { type: 'text', content: 'two' }, { type: 'text', content: 'three' }],
        });

        const delta = computeAgentMessageWireDelta(previous, next, 'qaiq');
        expect(delta.kind).to.equal('replace');

        const applied = applyAgentMessageWireDelta({ messages: [sealed] }, delta);
        expect(applied?.runUserMessageId).to.equal('user-a');
    });

    it('omits the field entirely for a message that has no run link', () => {
        const payload = toAgentMessageWirePayload(agentMessage('agent-legacy', 1));

        expect('runUserMessageId' in payload, 'no empty key on the wire for legacy turns').to.equal(false);
    });
});

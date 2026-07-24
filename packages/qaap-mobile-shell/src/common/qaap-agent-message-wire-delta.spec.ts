// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    applyAgentMessageWireDelta,
    computeAgentMessageWireDelta,
    toAgentMessageWirePayload,
    toAgentMessageWireSnapshot,
    type QaapAgentMessageWireSnapshot,
} from './qaap-agent-message-wire-delta';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';

function agentMessage(partial: Partial<QaapAgentMessageDTO> & Pick<QaapAgentMessageDTO, 'id'>): QaapAgentMessageWireSnapshot {
    return {
        id: partial.id,
        role: 'agent',
        content: partial.content ?? '',
        createdAt: partial.createdAt ?? 1,
        ...(partial.traceEvents ? { traceEvents: [...partial.traceEvents] } : {}),
        ...(partial.segments ? { segments: [...partial.segments] } : {}),
    };
}

describe('computeAgentMessageWireDelta', () => {
    it('starts a new agent row', () => {
        const next = agentMessage({ id: 'a1', content: 'Hi' });
        const delta = computeAgentMessageWireDelta(undefined, next, 'shell');
        expect(delta.kind).to.equal('message_start');
        if (delta.kind === 'message_start') {
            expect(delta.message).to.deep.equal({
                id: 'a1',
                role: 'agent',
                content: 'Hi',
                createdAt: 1,
            });
        }
    });

    it('appends stdout content incrementally', () => {
        const prev = agentMessage({ id: 'a1', content: 'Hel' });
        const next = agentMessage({ id: 'a1', content: 'Hello' });
        expect(computeAgentMessageWireDelta(prev, next, 'shell')).to.deep.equal({
            kind: 'append_content',
            messageId: 'a1',
            text: 'lo',
            baseLength: 3,
        });
    });

    it('appends structured text segment deltas', () => {
        const prev = agentMessage({
            id: 'a1',
            segments: [{ type: 'text', content: 'Hel' }],
        });
        const next = agentMessage({
            id: 'a1',
            segments: [{ type: 'text', content: 'Hello' }],
        });
        expect(computeAgentMessageWireDelta(prev, next, 'qaiq')).to.deep.equal({
            kind: 'append_segment_text',
            messageId: 'a1',
            segmentIndex: 0,
            text: 'lo',
            baseLength: 3,
        });
    });

    it('patches streaming tool results incrementally', () => {
        const prev = agentMessage({
            id: 'a1',
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Read',
                args: '{}',
                finished: false,
                result: 'line1',
            }],
        });
        const next = agentMessage({
            id: 'a1',
            segments: [{
                type: 'tool',
                toolUseId: 't1',
                name: 'Read',
                args: '{}',
                finished: true,
                result: 'line1\nline2',
            }],
        });
        expect(computeAgentMessageWireDelta(prev, next, 'qaiq')).to.deep.equal({
            kind: 'patch_tool',
            messageId: 'a1',
            toolUseId: 't1',
            resultAppend: '\nline2',
            finished: true,
        });
    });

    it('patches structured traceEvents incrementally when a tool settles', () => {
        const prev = agentMessage({
            id: 'a1',
            content: '',
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'Bash',
                args: '{}',
                status: 'running',
            }],
        });
        const next = agentMessage({
            id: 'a1',
            content: '',
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'Bash',
                args: '{}',
                status: 'completed',
                result: 'ok',
            }],
        });

        expect(computeAgentMessageWireDelta(prev, next, 'qaiq')).to.deep.equal({
            kind: 'patch_trace_event',
            messageId: 'a1',
            eventId: 'tool-1',
            resultAppend: 'ok',
            resultBaseLength: 0,
            status: 'completed',
        });
    });

    it('appends a new trace event without replacing the full message', () => {
        const prev = agentMessage({
            id: 'a1',
            traceEvents: [{
                type: 'tool_call',
                id: 'tool-1',
                name: 'Read',
                args: '{}',
                status: 'completed',
                result: 'done',
            }],
        });
        const next = agentMessage({
            id: 'a1',
            traceEvents: [
                {
                    type: 'tool_call',
                    id: 'tool-1',
                    name: 'Read',
                    args: '{}',
                    status: 'completed',
                    result: 'done',
                },
                {
                    type: 'tool_call',
                    id: 'tool-2',
                    name: 'Bash',
                    args: 'ls',
                    status: 'running',
                },
            ],
        });

        expect(computeAgentMessageWireDelta(prev, next, 'qaiq')).to.deep.equal({
            kind: 'append_trace_event',
            messageId: 'a1',
            event: next.traceEvents?.[1],
        });
    });
});

describe('applyAgentMessageWireDelta', () => {
    it('reconstructs the tail message from append_content', () => {
        const conv = {
            messages: [agentMessage({ id: 'a1', content: 'Hel' }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'append_content',
            messageId: 'a1',
            text: 'lo',
        });
        expect(patched?.content).to.equal('Hello');
    });

    it('rejects an append whose base is ahead of the local snapshot (lost delta)', () => {
        // The producer sliced this append assuming 5 chars were already applied, but we only
        // hold 3 — a delta went missing. Appending anyway would drop those 2 chars for the rest
        // of the turn; returning undefined routes the caller into its resync instead.
        const conv = {
            messages: [agentMessage({ id: 'a1', content: 'Hel' }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'append_content',
            messageId: 'a1',
            text: ' world',
            baseLength: 5,
        });
        expect(patched).to.equal(undefined);
    });

    it('applies only the unseen suffix when a duplicate append arrives late', () => {
        const conv = {
            messages: [agentMessage({ id: 'a1', content: 'Hello' }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'append_content',
            messageId: 'a1',
            text: 'llo world',
            baseLength: 2,
        });
        expect(patched?.content).to.equal('Hello world');
    });

    it('applies an append whose base matches exactly', () => {
        const conv = {
            messages: [agentMessage({ id: 'a1', content: 'Hel' }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'append_content',
            messageId: 'a1',
            text: 'lo',
            baseLength: 3,
        });
        expect(patched?.content).to.equal('Hello');
    });

    it('rejects a segment append whose base is ahead of the local segment', () => {
        const conv = {
            messages: [agentMessage({
                id: 'a1',
                segments: [{ type: 'text', content: 'Hel' }],
            }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'append_segment_text',
            messageId: 'a1',
            segmentIndex: 0,
            text: ' world',
            baseLength: 5,
        });
        expect(patched).to.equal(undefined);
    });

    it('rejects a trace-event append whose base is ahead of the local event (lost delta)', () => {
        // Structured agents stream assistant text through patch_trace_event, so this is the
        // path whose lost deltas surfaced as prose with fragments missing mid-stream.
        const conv = {
            messages: [agentMessage({
                id: 'a1',
                traceEvents: [{
                    type: 'assistant_text',
                    id: 'text-1',
                    content: 'Hel',
                    status: 'streaming',
                }],
            }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'patch_trace_event',
            messageId: 'a1',
            eventId: 'text-1',
            contentAppend: ' world',
            contentBaseLength: 5,
        });
        expect(patched).to.equal(undefined);
    });

    it('applies only the unseen suffix for a duplicate trace-event append', () => {
        const conv = {
            messages: [agentMessage({
                id: 'a1',
                traceEvents: [{
                    type: 'assistant_text',
                    id: 'text-1',
                    content: 'Hello',
                    status: 'streaming',
                }],
            }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'patch_trace_event',
            messageId: 'a1',
            eventId: 'text-1',
            contentAppend: 'llo world',
            contentBaseLength: 2,
        });
        expect(patched?.traceEvents?.[0]).to.include({ content: 'Hello world' });
    });

    it('applies patch_trace_event onto traceEvents', () => {
        const conv = {
            messages: [agentMessage({
                id: 'a1',
                traceEvents: [{
                    type: 'assistant_text',
                    id: 'text-1',
                    content: 'Hel',
                    status: 'streaming',
                }],
            }) as QaapAgentMessageDTO],
        };
        const patched = applyAgentMessageWireDelta(conv, {
            kind: 'patch_trace_event',
            messageId: 'a1',
            eventId: 'text-1',
            contentAppend: 'lo',
            status: 'completed',
        });
        expect(patched?.traceEvents?.[0]).to.deep.equal({
            type: 'assistant_text',
            id: 'text-1',
            content: 'Hello',
            status: 'completed',
        });
    });
});

describe('toAgentMessageWirePayload', () => {
    it('omits segments when traceEvents are present', () => {
        const payload = toAgentMessageWirePayload({
            id: 'a1',
            role: 'agent',
            content: 'Done',
            createdAt: 1,
            segments: [{ type: 'text', content: 'Done' }],
            traceEvents: [{ type: 'assistant_text', id: 'text-0', content: 'Done', status: 'completed' }],
        });
        expect(payload.segments).to.equal(undefined);
        expect(payload.traceEvents).to.have.length(1);
    });

    it('toAgentMessageWireSnapshot prefers traceEvents for delta baselines', () => {
        const snapshot = toAgentMessageWireSnapshot({
            id: 'a1',
            role: 'agent',
            content: 'Done',
            createdAt: 1,
            segments: [{ type: 'text', content: 'Done' }],
            traceEvents: [{ type: 'assistant_text', id: 'text-0', content: 'Done', status: 'streaming' }],
        });
        expect(snapshot.segments).to.equal(undefined);
        expect(snapshot.traceEvents).to.have.length(1);
    });
});

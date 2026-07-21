// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    buildConversationTranscriptFingerprint,
    canPatchToolSegmentGrowth,
    canStreamPatchAgentAppendTextSegment,
    canStreamPatchAgentAppendThinkingSegment,
    canStreamPatchAgentAppendToolSegment,
    canStreamPatchAgentSegmentsInPlace,
    canStreamPatchAgentSegmentsInPlaceWithAppend,
    canStreamPatchAgentTextContentOnly,
    canStreamPatchAgentToolsOnly,
    canStreamPatchStdoutAgentContentOnly,
    isStreamingTranscriptTailUnchanged,
    mergeConversationTranscriptFingerprint,
    resolveStreamingTranscriptPatchDecision,
    resolveStreamingTranscriptPatchKind,
    shouldForceTranscriptRenderOnStatusSettle,
    transcriptFingerprintChanged,
} from './qaap-transcript-incremental-update';

function conv(partial: Partial<QaapAgentConversationDTO> & Pick<QaapAgentConversationDTO, 'messages'>): QaapAgentConversationDTO {
    return {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 't',
        status: 'streaming',
        createdAt: 1,
        updatedAt: 1,
        ...partial,
    };
}

describe('qaap-transcript-incremental-update', () => {

    it('buildConversationTranscriptFingerprint tolerates missing segment text fields', () => {
        const snapshot = conv({
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments: [
                    { type: 'text', content: undefined as unknown as string },
                    { type: 'tool', toolUseId: 't1', name: 'Read', args: undefined as unknown as string, finished: false },
                ],
            }],
        });
        expect(() => buildConversationTranscriptFingerprint(snapshot)).to.not.throw();
    });

    it('buildConversationTranscriptFingerprint includes every segment, not only the last', () => {
        const base = conv({
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments: [
                    { type: 'tool', toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok' },
                    { type: 'tool', toolUseId: 't2', name: 'Bash', args: '{}', finished: false },
                ],
            }],
        });
        const updated = conv({
            updatedAt: 2,
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments: [
                    { type: 'tool', toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok-longer' },
                    { type: 'tool', toolUseId: 't2', name: 'Bash', args: '{}', finished: false },
                ],
            }],
        });
        expect(buildConversationTranscriptFingerprint(base)).to.not.equal(
            buildConversationTranscriptFingerprint(updated),
        );
    });

    it('resolveStreamingTranscriptPatchKind returns last-agent when segments grow in place', () => {
        const prev = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Hel' }],
                },
            ],
        });
        const next = conv({
            updatedAt: 3,
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Hello' }],
                },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('last-agent');
    });

    it('resolveStreamingTranscriptPatchKind returns append-agent when the agent row first appears', () => {
        const prev = conv({
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        const next = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'thinking', content: 'plan' }],
                },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('append-agent');
    });

    it('resolveStreamingTranscriptPatchKind returns activity-only while waiting for the agent', () => {
        const prev = conv({
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        const next = conv({
            updatedAt: 2,
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('activity-only');
    });

    it('resolveStreamingTranscriptPatchKind returns none when idle', () => {
        const prev = conv({ status: 'streaming', messages: [] });
        const next = conv({ status: 'idle', messages: [] });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('none');
    });

    it('resolveStreamingTranscriptPatchKind returns append-agent for codex stdout agents with segments', () => {
        const prev = conv({
            id: 'c1',
            agentId: 'codex',
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        const next = conv({
            id: 'c1',
            agentId: 'codex',
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: 'Done.',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Done.' }],
                },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('append-agent');
    });

    it('shouldForceTranscriptRenderOnStatusSettle forces render when a turn settles', () => {
        const prev = conv({
            status: 'streaming',
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments: [{ type: 'text', content: 'done' }],
            }],
        });
        const next = conv({ status: 'idle', messages: prev.messages });
        expect(shouldForceTranscriptRenderOnStatusSettle(prev, next, true)).to.equal(true);
        expect(shouldForceTranscriptRenderOnStatusSettle(prev, next, false)).to.equal(false);
        expect(shouldForceTranscriptRenderOnStatusSettle(prev, conv({ status: 'streaming', messages: prev.messages }), true))
            .to.equal(false);
    });

    it('transcriptFingerprintChanged detects segment updates with the same updatedAt', () => {
        const prev = conv({
            id: 'c1',
            updatedAt: 5,
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments: [{ type: 'text', content: 'a' }],
            }],
        });
        const next = conv({
            id: 'c1',
            updatedAt: 5,
            messages: [{
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 1,
                segments: [{ type: 'text', content: 'ab' }],
            }],
        });
        expect(transcriptFingerprintChanged(prev, next)).to.equal(true);
    });

    it('resolveStreamingTranscriptPatchKind returns none when structured segments are unchanged', () => {
        const messages = [
            { id: 'u1', role: 'user' as const, content: 'hi', createdAt: 1 },
            {
                id: 'a1',
                role: 'agent' as const,
                content: 'Hello',
                createdAt: 2,
                segments: [{ type: 'text' as const, content: 'Hello' }],
            },
        ];
        const prev = conv({ updatedAt: 2, messages });
        const next = conv({ updatedAt: 3, messages });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('none');
    });

    it('isStreamingTranscriptTailUnchanged ignores metadata-only SSE ticks', () => {
        const messages = [
            { id: 'u1', role: 'user' as const, content: 'hi', createdAt: 1 },
            {
                id: 'a1',
                role: 'agent' as const,
                content: 'Hello',
                createdAt: 2,
                segments: [{ type: 'text' as const, content: 'Hello' }],
            },
        ];
        const prev = conv({ updatedAt: 2, messages });
        const next = conv({ updatedAt: 99, messages });
        expect(isStreamingTranscriptTailUnchanged(prev, next)).to.equal(true);
    });

    it('canStreamPatchAgentTextContentOnly allows growing text when tools are unchanged', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok' },
                { type: 'text' as const, content: 'Hel' },
            ],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok' },
                { type: 'text' as const, content: 'Hello' },
            ],
        };
        expect(canStreamPatchAgentTextContentOnly(prevMsg, nextMsg)).to.equal(true);
    });

    it('canStreamPatchAgentTextContentOnly rejects new tool segments', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [{ type: 'text' as const, content: 'Hi' }],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'text' as const, content: 'Hi' },
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false },
            ],
        };
        expect(canStreamPatchAgentTextContentOnly(prevMsg, nextMsg)).to.equal(false);
    });

    it('canStreamPatchStdoutAgentContentOnly allows stdout growth without segments', () => {
        const prevMsg = { id: 'a1', role: 'agent' as const, content: 'Hel', createdAt: 1 };
        const nextMsg = { id: 'a1', role: 'agent' as const, content: 'Hello', createdAt: 1 };
        expect(canStreamPatchStdoutAgentContentOnly(prevMsg, nextMsg)).to.equal(true);
    });

    it('canStreamPatchAgentToolsOnly allows streaming tool result growth', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{"cmd":"npm test"}', finished: false, result: 'line1' },
            ],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{"cmd":"npm test"}', finished: false, result: 'line1\nline2' },
            ],
        };
        expect(canStreamPatchAgentToolsOnly(prevMsg, nextMsg)).to.equal(true);
        expect(canStreamPatchAgentTextContentOnly(prevMsg, nextMsg)).to.equal(false);
    });

    it('canStreamPatchAgentToolsOnly allows tool finish without text changes', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: false, result: 'ok' },
                { type: 'text' as const, content: 'Done' },
            ],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok' },
                { type: 'text' as const, content: 'Done' },
            ],
        };
        expect(canStreamPatchAgentToolsOnly(prevMsg, nextMsg)).to.equal(true);
    });

    it('canStreamPatchAgentAppendToolSegment allows a new trailing tool', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [{ type: 'text' as const, content: 'Planning' }],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'text' as const, content: 'Planning' },
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false },
            ],
        };
        expect(canStreamPatchAgentAppendToolSegment(prevMsg, nextMsg)).to.equal(true);
    });

    it('canStreamPatchAgentAppendTextSegment allows a new trailing text after tools', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok' },
                { type: 'tool' as const, toolUseId: 't2', name: 'Bash', args: '{}', finished: true, result: 'done' },
            ],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                ...prevMsg.segments,
                { type: 'text' as const, content: 'Here is the answer' },
            ],
        };
        expect(canStreamPatchAgentAppendTextSegment(prevMsg, nextMsg)).to.equal(true);
        expect(canStreamPatchAgentAppendToolSegment(prevMsg, nextMsg)).to.equal(false);
    });

    it('canPatchToolSegmentGrowth rejects tool id changes', () => {
        const prev = { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false, result: 'a' };
        const next = { type: 'tool' as const, toolUseId: 't2', name: 'Bash', args: '{}', finished: false, result: 'ab' };
        expect(canPatchToolSegmentGrowth(prev, next)).to.equal(false);
    });

    it('canPatchToolSegmentGrowth allows mid-stream args rewrites for the same tool', () => {
        const prev = {
            type: 'tool' as const,
            toolUseId: 't1',
            name: 'Bash',
            args: '{"command":"npm run"}',
            finished: false,
        };
        const next = {
            type: 'tool' as const,
            toolUseId: 't1',
            name: 'Bash',
            args: '{"command":"npm run test"}',
            finished: false,
        };
        expect(canPatchToolSegmentGrowth(prev, next)).to.equal(true);
        expect(canStreamPatchAgentSegmentsInPlace(
            { id: 'a1', role: 'agent', content: '', createdAt: 1, segments: [prev] },
            { id: 'a1', role: 'agent', content: '', createdAt: 1, segments: [next] },
        )).to.equal(true);
    });

    it('canStreamPatchAgentSegmentsInPlace allows thinking rewrites', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [{ type: 'thinking' as const, content: 'Plan A then B' }],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [{ type: 'thinking' as const, content: 'Plan B only' }],
        };
        expect(canStreamPatchAgentSegmentsInPlace(prevMsg, nextMsg)).to.equal(true);
    });

    it('canStreamPatchAgentAppendThinkingSegment detects a new thinking tail', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [{ type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: true, result: 'ok' }],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                ...prevMsg.segments,
                { type: 'thinking' as const, content: 'Now synthesize' },
            ],
        };
        expect(canStreamPatchAgentAppendThinkingSegment(prevMsg, nextMsg)).to.equal(true);
        expect(canStreamPatchAgentAppendTextSegment(prevMsg, nextMsg)).to.equal(false);
    });

    it('canStreamPatchAgentSegmentsInPlace allows text and tool growth in one tick', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false, result: 'a' },
                { type: 'text' as const, content: 'Hel' },
            ],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false, result: 'ab' },
                { type: 'text' as const, content: 'Hello' },
            ],
        };
        expect(canStreamPatchAgentSegmentsInPlace(prevMsg, nextMsg)).to.equal(true);
        expect(canStreamPatchAgentTextContentOnly(prevMsg, nextMsg)).to.equal(false);
        expect(canStreamPatchAgentToolsOnly(prevMsg, nextMsg)).to.equal(false);
    });

    it('mergeConversationTranscriptFingerprint matches full fingerprint when only the tail grows', () => {
        const prev = conv({
            updatedAt: 2,
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Hel' }],
                },
            ],
        });
        const next = conv({
            updatedAt: 3,
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Hello' }],
                },
            ],
        });
        expect(mergeConversationTranscriptFingerprint(prev, next)).to.equal(
            buildConversationTranscriptFingerprint(next),
        );
        expect(mergeConversationTranscriptFingerprint(prev, next)).to.not.equal(
            buildConversationTranscriptFingerprint(prev),
        );
    });

    it('resolveStreamingTranscriptPatchKind returns append-agent for the empty placeholder tick', () => {
        // The full rebuild paints the empty placeholder row too, so appending it
        // keeps parity — previously this tick forced a whole-list render_full on
        // every new agent turn.
        const prev = conv({
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        const next = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                { id: 'a1', role: 'agent', content: '', createdAt: 2 },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('append-agent');
    });

    it('resolveStreamingTranscriptPatchKind returns append-user for a queued user message', () => {
        const prev = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Working on it' }],
                },
            ],
        });
        const next = conv({
            messages: [
                ...prev.messages,
                { id: 'u2', role: 'user', content: 'also do this', createdAt: 3 },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('append-user');
    });

    it('resolveStreamingTranscriptPatchKind appends multiple trailing rows in one coalesced tick', () => {
        const prev = conv({
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        const next = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'hi', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'done' }],
                },
                {
                    id: 'a2',
                    role: 'agent',
                    content: '',
                    createdAt: 3,
                    segments: [{ type: 'thinking', content: 'next' }],
                },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('append-agent');
    });

    it('resolveStreamingTranscriptPatchKind returns none when prior messages diverge on append', () => {
        const prev = conv({
            messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }],
        });
        const next = conv({
            messages: [
                { id: 'uX', role: 'user', content: 'hi', createdAt: 1 },
                { id: 'a1', role: 'agent', content: '', createdAt: 2, segments: [{ type: 'text', content: 'x' }] },
            ],
        });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('none');
    });

    it('canPatchToolSegmentGrowth allows non-monotonic result rewrites (placeholder → final)', () => {
        const prev = {
            type: 'tool' as const,
            toolUseId: 't1',
            name: 'Bash',
            args: '{}',
            finished: false,
            result: 'Processing screenshot…',
        };
        const next = {
            type: 'tool' as const,
            toolUseId: 't1',
            name: 'Bash',
            args: '{}',
            finished: true,
            result: '<img src="evidence.png">',
        };
        expect(canPatchToolSegmentGrowth(prev, next)).to.equal(true);
    });

    it('canPatchToolSegmentGrowth still rejects a finished → unfinished regression', () => {
        const prev = { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: true, result: 'ok' };
        const next = { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false, result: 'ok' };
        expect(canPatchToolSegmentGrowth(prev, next)).to.equal(false);
    });

    it('canStreamPatchAgentSegmentsInPlace allows corrective text rewrites, not only prefix growth', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [{ type: 'text' as const, content: 'Hello wrold' }],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [{ type: 'text' as const, content: 'Hello world' }],
        };
        expect(canStreamPatchAgentSegmentsInPlace(prevMsg, nextMsg)).to.equal(true);
    });

    it('canStreamPatchStdoutAgentContentOnly allows corrective rewrites', () => {
        const prevMsg = { id: 'a1', role: 'agent' as const, content: 'Hello wrold', createdAt: 1 };
        const nextMsg = { id: 'a1', role: 'agent' as const, content: 'Hello world', createdAt: 1 };
        expect(canStreamPatchStdoutAgentContentOnly(prevMsg, nextMsg)).to.equal(true);
    });

    it('same-length tool result rewrites are detected as changes (no silent freeze)', () => {
        const messagesOf = (result: string) => [
            { id: 'u1', role: 'user' as const, content: 'hi', createdAt: 1 },
            {
                id: 'a1',
                role: 'agent' as const,
                content: '',
                createdAt: 2,
                segments: [{ type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false, result }],
            },
        ];
        const prev = conv({ messages: messagesOf('status: RUNNING') });
        const next = conv({ messages: messagesOf('status: STOPPED') });
        expect(resolveStreamingTranscriptPatchKind(prev, next)).to.equal('last-agent');
        expect(isStreamingTranscriptTailUnchanged(prev, next)).to.equal(false);
        expect(buildConversationTranscriptFingerprint(prev)).to.not.equal(
            buildConversationTranscriptFingerprint(next),
        );
    });

    it('canStreamPatchAgentSegmentsInPlaceWithAppend patches a grown prefix plus an appended tail', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: false, result: 'a' },
            ],
        };
        const nextMsg = {
            ...prevMsg,
            segments: [
                { type: 'tool' as const, toolUseId: 't1', name: 'Bash', args: '{}', finished: true, result: 'ab' },
                { type: 'text' as const, content: 'Now the answer' },
            ],
        };
        expect(canStreamPatchAgentSegmentsInPlaceWithAppend(prevMsg, nextMsg)).to.equal(true);
        // Plain append predicates reject it (prior segment changed) — the
        // combined predicate is what keeps this off the row-replace path.
        expect(canStreamPatchAgentAppendTextSegment(prevMsg, nextMsg)).to.equal(false);
    });

    it('canStreamPatchAgentSegmentsInPlaceWithAppend rejects an unchanged prefix or larger deltas', () => {
        const prevMsg = {
            id: 'a1',
            role: 'agent' as const,
            content: '',
            createdAt: 1,
            segments: [{ type: 'text' as const, content: 'same' }],
        };
        const unchangedPrefix = {
            ...prevMsg,
            segments: [
                { type: 'text' as const, content: 'same' },
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: false },
            ],
        };
        expect(canStreamPatchAgentSegmentsInPlaceWithAppend(prevMsg, unchangedPrefix)).to.equal(false);
        const doubleAppend = {
            ...prevMsg,
            segments: [
                { type: 'text' as const, content: 'same+more' },
                { type: 'tool' as const, toolUseId: 't1', name: 'Read', args: '{}', finished: false },
                { type: 'text' as const, content: 'tail' },
            ],
        };
        expect(canStreamPatchAgentSegmentsInPlaceWithAppend(prevMsg, doubleAppend)).to.equal(false);
    });

    it('resolveStreamingTranscriptPatchDecision attributes every none to its guard', () => {
        const streamingTail = [
            { id: 'u1', role: 'user' as const, content: 'hi', createdAt: 1 },
            {
                id: 'a1',
                role: 'agent' as const,
                content: '',
                createdAt: 2,
                segments: [{ type: 'text' as const, content: 'Hello' }],
            },
        ];
        // Settled snapshot → not-streaming.
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ messages: streamingTail }),
            conv({ status: 'idle', messages: streamingTail }),
        ).noneReason).to.equal('not-streaming');
        // No prev / different conversation → conversation-switched.
        expect(resolveStreamingTranscriptPatchDecision(
            undefined,
            conv({ messages: streamingTail }),
        ).noneReason).to.equal('conversation-switched');
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ id: 'other', messages: streamingTail }),
            conv({ messages: streamingTail }),
        ).noneReason).to.equal('conversation-switched');
        // Historical prefix diverged → prior-diverged.
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ messages: [{ id: 'uX', role: 'user', content: 'hi', createdAt: 1 }, streamingTail[1]] }),
            conv({ messages: streamingTail }),
        ).noneReason).to.equal('prior-diverged');
        // Structured tail without renderable segments → tail-empty.
        const emptyTail = [
            { id: 'u1', role: 'user' as const, content: 'hi', createdAt: 1 },
            { id: 'a1', role: 'agent' as const, content: '', createdAt: 2 },
        ];
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ messages: emptyTail }),
            conv({ messages: emptyTail }),
        ).noneReason).to.equal('tail-empty');
        // Message list shrank → count-shrunk.
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ messages: streamingTail }),
            conv({ messages: [streamingTail[0]] }),
        ).noneReason).to.equal('count-shrunk');
        // Unchanged structured tail → tail-unchanged.
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ messages: streamingTail }),
            conv({ updatedAt: 9, messages: streamingTail }),
        ).noneReason).to.equal('tail-unchanged');
        // Patch kinds carry no reason.
        expect(resolveStreamingTranscriptPatchDecision(
            conv({ messages: [streamingTail[0]] }),
            conv({ messages: streamingTail }),
        )).to.deep.equal({ kind: 'append-agent' });
    });

    it('mergeConversationTranscriptFingerprint cache hit still matches the full build', () => {
        const messagesWithTail = (tail: string) => [
            { id: 'u1', role: 'user' as const, content: 'hi', createdAt: 1 },
            {
                id: 'a1',
                role: 'agent' as const,
                content: '',
                createdAt: 2,
                segments: [{ type: 'text' as const, content: tail }],
            },
        ];
        const first = conv({ id: 'c-cache', messages: messagesWithTail('He') });
        const second = conv({ id: 'c-cache', messages: messagesWithTail('Hell') });
        const third = conv({ id: 'c-cache', messages: messagesWithTail('Hello') });
        // First merge primes the historical-prefix cache; the second exercises
        // the cache-hit path (same count, same historical ids).
        mergeConversationTranscriptFingerprint(first, second);
        expect(mergeConversationTranscriptFingerprint(second, third)).to.equal(
            buildConversationTranscriptFingerprint(third),
        );
    });
});

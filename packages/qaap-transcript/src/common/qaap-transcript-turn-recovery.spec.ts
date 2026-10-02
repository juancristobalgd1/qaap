// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { markTranscriptConversationRetryOptimistic, resolveTranscriptDiscardCheckpointId, resolveTranscriptTurnRetryAttempt } from './qaap-transcript-turn-recovery';
import { resolveTranscriptStreamingActivityFromSegments, resolveTranscriptVerifyingActivity } from './qaap-transcript-streaming-activity';
import { resolveTranscriptStreamHealth, TRANSCRIPT_STREAM_FIRST_OUTPUT_TIMEOUT_MS } from './qaap-transcript-stream-health';

function conversation(overrides: Partial<QaapAgentConversationDTO> = {}): QaapAgentConversationDTO {
    return {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 'T',
        status: 'idle',
        createdAt: 0,
        updatedAt: 0,
        messages: [
            { id: 'u1', role: 'user', content: 'first', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'done', createdAt: 2, runUserMessageId: 'u1' },
            { id: 'u2', role: 'user', content: 'fix it', createdAt: 3, retryAttempt: 3 },
            { id: 'a2', role: 'agent', content: 'partial', createdAt: 4, runUserMessageId: 'u2' },
        ],
        checkpoints: [{ id: 'ck-pre', messageId: 'u2', label: 'Before: fix it', commit: 'abc', ref: 'r', capturedAt: 3, kind: 'pre-turn' }],
        discardCheckpointId: 'ck-pre',
        ...overrides,
    };
}

describe('qaap-transcript-turn-recovery', () => {

    it('offers "Discard changes" only on the stopped run that owns the published snapshot', () => {
        expect(resolveTranscriptDiscardCheckpointId(conversation(), 'a2')).to.equal('ck-pre');
        expect(resolveTranscriptDiscardCheckpointId(conversation(), 'a1')).to.equal(undefined);
        expect(resolveTranscriptDiscardCheckpointId(conversation({ status: 'streaming' }), 'a2')).to.equal(undefined);
        expect(resolveTranscriptDiscardCheckpointId(conversation({ discardCheckpointId: undefined }), 'a2')).to.equal(undefined);
        expect(resolveTranscriptDiscardCheckpointId(conversation({ checkpoints: [] }), 'a2')).to.equal(undefined);
    });

    it('reads the retry attempt off the run user turn, hiding the original attempt', () => {
        expect(resolveTranscriptTurnRetryAttempt(conversation(), 'a2')).to.equal(3);
        expect(resolveTranscriptTurnRetryAttempt(conversation(), 'a1')).to.equal(undefined);
    });

    it('resets the timer and increments the attempt in the optimistic retry row', () => {
        const retried = markTranscriptConversationRetryOptimistic(conversation(), 99);
        expect(retried.status).to.equal('streaming');
        expect(retried.messages[2]).to.deep.include({ id: 'u2', createdAt: 99, retryAttempt: 4 });
    });
});

describe('qaap-transcript verifying activity', () => {

    it('labels automatic verification and the fix attempt', () => {
        expect(resolveTranscriptVerifyingActivity(undefined)).to.equal(undefined);
        const running = resolveTranscriptVerifyingActivity({ kind: 'verifying', status: 'running', attempt: 0, maxAttempts: 2, startedAt: 0 });
        expect(running?.kind).to.equal('verifying');
        expect(running?.title).to.equal('Automatic verification in progress');
        const fixing = resolveTranscriptVerifyingActivity({ kind: 'verifying', status: 'fixing', attempt: 1, maxAttempts: 2, startedAt: 0 });
        expect(fixing?.title).to.equal('Automatic verification in progress (fix attempt 1/2)');
    });

    it('wins over the stall/timeout copy while verifying', () => {
        const activity = resolveTranscriptStreamingActivityFromSegments([], {
            timedOut: true,
            turnPhase: { kind: 'verifying', status: 'running', attempt: 0, maxAttempts: 2, startedAt: 0 },
        });
        expect(activity.kind).to.equal('verifying');
    });

    it('keeps the stall/timeout watchdog quiet while verifying', () => {
        const input = {
            streaming: true,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: 0,
            segments: [],
            now: TRANSCRIPT_STREAM_FIRST_OUTPUT_TIMEOUT_MS * 2,
        };
        expect(resolveTranscriptStreamHealth(input).timedOut).to.equal(true);
        const verifying = resolveTranscriptStreamHealth({ ...input, verifying: true });
        expect(verifying.timedOut).to.equal(false);
        expect(verifying.stalled).to.equal(false);
    });
});

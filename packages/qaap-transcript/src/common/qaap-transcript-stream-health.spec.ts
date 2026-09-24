// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptStreamHealth,
    TRANSCRIPT_SSE_STALE_MS,
    TRANSCRIPT_STREAM_ACTIVE_TOOL_TIMEOUT_MS,
} from './qaap-transcript-stream-health';
import { TRANSCRIPT_STREAM_STALL_MS, TRANSCRIPT_STREAM_TIMEOUT_MS } from './qaap-transcript-stream-status';

describe('qaap-transcript-stream-health', () => {

    it('returns idle health when not streaming', () => {
        const health = resolveTranscriptStreamHealth({
            streaming: false,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: 0,
            segments: [{ type: 'thinking', content: 'plan' }],
            now: 100_000,
        });
        expect(health.stalled).to.equal(false);
        expect(health.timedOut).to.equal(false);
        expect(health.timeoutCause).to.equal(undefined);
    });

    it('stalls after the grace window without timing out', () => {
        const now = TRANSCRIPT_STREAM_STALL_MS + 5_000;
        const health = resolveTranscriptStreamHealth({
            streaming: true,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: 0,
            segments: [],
            now,
        });
        expect(health.stalled).to.equal(true);
        expect(health.timedOut).to.equal(false);
    });

    it('times out on semantic idle after the default budget', () => {
        const now = TRANSCRIPT_STREAM_TIMEOUT_MS + 1_000;
        const health = resolveTranscriptStreamHealth({
            streaming: true,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: now,
            segments: [{ type: 'thinking', content: 'plan' }],
            now,
        });
        expect(health.timedOut).to.equal(true);
        expect(health.timeoutCause).to.equal('semantic_idle');
    });

    it('extends the timeout budget while a tool is still running', () => {
        const now = TRANSCRIPT_STREAM_TIMEOUT_MS + 5_000;
        const withinToolBudget = resolveTranscriptStreamHealth({
            streaming: true,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: now,
            segments: [{ type: 'tool', finished: false }],
            now,
        });
        expect(withinToolBudget.timedOut).to.equal(false);
        expect(withinToolBudget.hasActiveTool).to.equal(true);

        const afterToolBudget = resolveTranscriptStreamHealth({
            streaming: true,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: TRANSCRIPT_STREAM_ACTIVE_TOOL_TIMEOUT_MS + 1_000,
            segments: [{ type: 'tool', finished: false }],
            now: TRANSCRIPT_STREAM_ACTIVE_TOOL_TIMEOUT_MS + 1_000,
        });
        expect(afterToolBudget.timedOut).to.equal(true);
        expect(afterToolBudget.timeoutCause).to.equal('active_tool');
    });

    it('prefers sse_disconnected when transport is stale at timeout', () => {
        const now = TRANSCRIPT_STREAM_TIMEOUT_MS + 1_000;
        const health = resolveTranscriptStreamHealth({
            streaming: true,
            lastProgressAtMs: 0,
            lastTransportEventAtMs: now - TRANSCRIPT_SSE_STALE_MS - 1,
            segments: [{ type: 'thinking', content: 'plan' }],
            now,
        });
        expect(health.timedOut).to.equal(true);
        expect(health.sseStale).to.equal(true);
        expect(health.timeoutCause).to.equal('sse_disconnected');
    });
});

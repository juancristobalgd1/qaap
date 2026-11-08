// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatEventLoopStallLog,
    formatSlowPersistWriteLog,
    formatTaskStartLog,
    resolveAdaptiveStreamingPersistDelayMs,
    STREAMING_PERSIST_MAX_DELAY_MS,
    STREAMING_PERSIST_MIN_DELAY_MS,
} from './qaap-agent-conversation-persist-policy';
import { measureEventLoopStallMs } from './qaap-loop-stall-monitor';

describe('qaap-agent-conversation-persist-policy', () => {

    describe('resolveAdaptiveStreamingPersistDelayMs', () => {

        it('uses the historical minimum before any write has been measured', () => {
            expect(resolveAdaptiveStreamingPersistDelayMs(undefined)).to.equal(STREAMING_PERSIST_MIN_DELAY_MS);
        });

        it('treats a bogus measurement as no measurement', () => {
            expect(resolveAdaptiveStreamingPersistDelayMs(Number.NaN)).to.equal(STREAMING_PERSIST_MIN_DELAY_MS);
            expect(resolveAdaptiveStreamingPersistDelayMs(-5)).to.equal(STREAMING_PERSIST_MIN_DELAY_MS);
        });

        it('keeps the minimum for fast writes', () => {
            expect(resolveAdaptiveStreamingPersistDelayMs(0)).to.equal(STREAMING_PERSIST_MIN_DELAY_MS);
            expect(resolveAdaptiveStreamingPersistDelayMs(10)).to.equal(STREAMING_PERSIST_MIN_DELAY_MS);
        });

        it('grows with the measured write duration (20x)', () => {
            expect(resolveAdaptiveStreamingPersistDelayMs(50)).to.equal(1000);
            expect(resolveAdaptiveStreamingPersistDelayMs(1000)).to.equal(20_000);
        });

        it('is capped at the maximum for long writes', () => {
            expect(resolveAdaptiveStreamingPersistDelayMs(1500)).to.equal(STREAMING_PERSIST_MAX_DELAY_MS);
            expect(resolveAdaptiveStreamingPersistDelayMs(60_000)).to.equal(STREAMING_PERSIST_MAX_DELAY_MS);
        });

        it('never leaves the [minimum, maximum] range', () => {
            for (const duration of [0, 1, 25, 49, 50, 51, 999, 1000, 1499, 1500, 9_999, 1e9]) {
                const delay = resolveAdaptiveStreamingPersistDelayMs(duration);
                expect(delay).to.be.at.least(STREAMING_PERSIST_MIN_DELAY_MS);
                expect(delay).to.be.at.most(STREAMING_PERSIST_MAX_DELAY_MS);
            }
        });

        it('is non-decreasing in the write duration', () => {
            let previous = resolveAdaptiveStreamingPersistDelayMs(0);
            for (const duration of [10, 30, 60, 200, 800, 1200, 2000, 5000]) {
                const delay = resolveAdaptiveStreamingPersistDelayMs(duration);
                expect(delay).to.be.at.least(previous);
                previous = delay;
            }
        });

        it('falls back when the writes speed up again', () => {
            expect(resolveAdaptiveStreamingPersistDelayMs(2000)).to.equal(STREAMING_PERSIST_MAX_DELAY_MS);
            expect(resolveAdaptiveStreamingPersistDelayMs(15)).to.equal(STREAMING_PERSIST_MIN_DELAY_MS);
        });
    });

    describe('log formatters carry only numbers, ids and namespace names', () => {

        it('formats a slow write without any record content', () => {
            const line = formatSlowPersistWriteLog({
                namespace: 'conversations', entries: 2, chars: 452_000_000, stringifyMs: 533.4, totalMs: 2608.9,
            });
            expect(line).to.equal('[qaap-persist] namespace=conversations entries=2 chars=452000000 stringifyMs=533 totalMs=2609');
        });

        it('formats an event-loop stall with numbers only', () => {
            expect(formatEventLoopStallLog(1_700_000_000_000, 2613.7)).to.equal('[qaap-loop] stallMs=2614 startEpochMs=1700000000000');
        });

        it('formats a task start with origin and ids, never the prompt', () => {
            const secretPrompt = 'SECRET PROMPT TEXT with a path /home/user/private';
            const withRequest = formatTaskStartLog('create', 'task-1', 'client-9');
            const drained = formatTaskStartLog('drain', 'task-2');
            expect(withRequest).to.equal('[qaap-task-start] origin=create taskId=task-1 clientRequestId=client-9');
            expect(drained).to.equal('[qaap-task-start] origin=drain taskId=task-2');
            expect(withRequest + drained).to.not.include(secretPrompt);
            expect(withRequest + drained).to.not.include('/home/user');
        });
    });

    describe('measureEventLoopStallMs', () => {

        it('is zero when the probe fires on time', () => {
            expect(measureEventLoopStallMs(1000, 1200, 200)).to.equal(0);
        });

        it('reports how much later than the tick the probe fired', () => {
            expect(measureEventLoopStallMs(1000, 4000, 200)).to.equal(2800);
        });

        it('is never negative', () => {
            expect(measureEventLoopStallMs(1000, 1050, 200)).to.equal(0);
        });
    });
});

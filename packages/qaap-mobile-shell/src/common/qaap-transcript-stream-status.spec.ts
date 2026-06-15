// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatTranscriptStreamElapsed,
    formatTranscriptStreamTokens,
    formatTranscriptThoughtDuration,
    isTranscriptAgentThinkingPhase,
    isTranscriptStreamStalled,
    resolveTranscriptTraceDisplayPhase,
    resolveTranscriptTurnStartMs,
    resolveTranscriptTurnStreamChars,
    shouldExpandTranscriptInlineTimeline,
    shouldShowTranscriptInlineTimeline,
} from './qaap-transcript-stream-status';

describe('qaap-transcript-stream-status', () => {

    it('formats elapsed time across ranges', () => {
        expect(formatTranscriptStreamElapsed(0)).to.equal('0s');
        expect(formatTranscriptStreamElapsed(12_400)).to.equal('12s');
        expect(formatTranscriptStreamElapsed(83_000)).to.equal('1m 23s');
        expect(formatTranscriptStreamElapsed(3_720_000)).to.equal('1h 2m');
        expect(formatTranscriptStreamElapsed(-5)).to.equal('0s');
    });

    it('formats approximate token counts', () => {
        expect(formatTranscriptStreamTokens(0)).to.equal(undefined);
        expect(formatTranscriptStreamTokens(3_480)).to.equal('~870 tokens');
        expect(formatTranscriptStreamTokens(16_800)).to.equal('~4.2k tokens');
        expect(formatTranscriptStreamTokens(48_000)).to.equal('~12k tokens');
    });

    it('resolves the turn start from the last user message', () => {
        expect(resolveTranscriptTurnStartMs([
            { role: 'user', createdAt: 100 },
            { role: 'agent', createdAt: 200 },
            { role: 'user', createdAt: 300 },
            { role: 'agent', createdAt: 400 },
        ])).to.equal(300);
        expect(resolveTranscriptTurnStartMs([])).to.equal(undefined);
    });

    it('counts streamed chars from the in-flight agent message', () => {
        expect(resolveTranscriptTurnStreamChars([
            { role: 'user', createdAt: 1, content: 'hi' },
            {
                role: 'agent', createdAt: 2, segments: [
                    { type: 'thinking', content: '12345' },
                    { type: 'tool', content: 'ignored-tool-output' },
                    { type: 'text', content: '1234567890' },
                ],
            },
        ])).to.equal(15);
        expect(resolveTranscriptTurnStreamChars([
            { role: 'agent', createdAt: 2, content: 'abc' },
        ])).to.equal(3);
        expect(resolveTranscriptTurnStreamChars([{ role: 'user', content: 'hi' }])).to.equal(0);
    });

    it('detects the live thinking phase before tools or answer text', () => {
        expect(isTranscriptAgentThinkingPhase([], true)).to.equal(true);
        expect(isTranscriptAgentThinkingPhase([{ type: 'thinking', content: 'plan' }], true)).to.equal(true);
        expect(isTranscriptAgentThinkingPhase([{ type: 'tool' }], true)).to.equal(false);
        expect(isTranscriptAgentThinkingPhase([{ type: 'text', content: 'hi' }], true)).to.equal(false);
        expect(isTranscriptAgentThinkingPhase([{ type: 'thinking', content: 'plan' }], false)).to.equal(false);
    });

    it('formats short thought durations in seconds', () => {
        expect(formatTranscriptThoughtDuration(400)).to.equal('1s');
        expect(formatTranscriptThoughtDuration(2_400)).to.equal('2s');
        expect(formatTranscriptThoughtDuration(90_000)).to.equal('1m 30s');
    });

    it('detects stream stalls after the Cursor-style grace window', () => {
        const now = 20_000;
        expect(isTranscriptStreamStalled(0, true, now)).to.equal(true);
        expect(isTranscriptStreamStalled(4_000, true, now)).to.equal(true);
        expect(isTranscriptStreamStalled(6_000, true, now)).to.equal(false);
        expect(isTranscriptStreamStalled(6_000, false, now)).to.equal(false);
        expect(isTranscriptStreamStalled(undefined, true, now)).to.equal(false);
    });

    it('resolves trace display phases for progressive disclosure', () => {
        expect(resolveTranscriptTraceDisplayPhase([], true)).to.equal('thinking');
        expect(resolveTranscriptTraceDisplayPhase([{ type: 'thinking', content: 'plan' }], true)).to.equal('thinking');
        expect(shouldShowTranscriptInlineTimeline([{ type: 'thinking', content: 'plan' }], true)).to.equal(false);
        expect(resolveTranscriptTraceDisplayPhase([{ type: 'tool' }], true)).to.equal('acting');
        expect(shouldExpandTranscriptInlineTimeline([{ type: 'tool' }], true)).to.equal(true);
        expect(resolveTranscriptTraceDisplayPhase([
            { type: 'tool' },
            { type: 'text', content: 'done' },
        ], true)).to.equal('writing');
        expect(shouldExpandTranscriptInlineTimeline([
            { type: 'tool' },
            { type: 'text', content: 'done' },
        ], true)).to.equal(false);
        expect(resolveTranscriptTraceDisplayPhase([{ type: 'tool' }], false)).to.equal('settled');
    });
});

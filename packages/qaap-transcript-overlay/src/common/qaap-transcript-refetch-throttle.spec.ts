// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTranscriptRefetchThrottle } from './qaap-transcript-refetch-throttle';

describe('QaapTranscriptRefetchThrottle', () => {
    const clock = (): { now: () => number; advance: (ms: number) => void } => {
        let current = 1_000;
        return {
            now: () => current,
            advance: (ms: number) => { current += ms; },
        };
    };

    it('allows the first refetch for a conversation immediately', () => {
        const time = clock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, time.now);
        expect(throttle.delayMs('conv-1')).to.equal(0);
    });

    it('coalesces a burst into one request per window and reports the remaining delay', () => {
        const time = clock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, time.now);
        let issued = 0;
        // Ten flushes inside one window: only the first is issued now, the rest wait for the trailing run.
        for (let flush = 0; flush < 10; flush++) {
            if (throttle.delayMs('conv-1') === 0) {
                throttle.markIssued('conv-1');
                issued += 1;
            }
            time.advance(100);
        }
        expect(issued).to.equal(1);
        // Issued at t=1000; the burst ends at t=2000, so 1000ms of the window remain.
        expect(throttle.delayMs('conv-1')).to.equal(1_000);
    });

    it('keeps conversations independent', () => {
        const time = clock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, time.now);
        throttle.markIssued('conv-1');
        expect(throttle.delayMs('conv-1')).to.equal(2_000);
        expect(throttle.delayMs('conv-2')).to.equal(0);
    });

    it('allows the next refetch once the window has elapsed', () => {
        const time = clock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, time.now);
        throttle.markIssued('conv-1');
        time.advance(1_999);
        expect(throttle.delayMs('conv-1')).to.equal(1);
        time.advance(1);
        expect(throttle.delayMs('conv-1')).to.equal(0);
    });

    it('detects a real state change only against the state recorded at the last refetch', () => {
        const throttle = new QaapTranscriptRefetchThrottle(2_000, () => 0);
        expect(throttle.hasStateChanged('conv-1', 'idle|10')).to.equal(true);
        throttle.markIssued('conv-1', 'idle|10');
        expect(throttle.hasStateChanged('conv-1', 'idle|10')).to.equal(false);
        expect(throttle.hasStateChanged('conv-1', 'idle|11')).to.equal(true);
    });
});

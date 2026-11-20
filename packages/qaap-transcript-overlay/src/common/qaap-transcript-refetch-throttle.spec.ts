// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTranscriptRefetchThrottle, type QaapTranscriptRefetchTimers } from './qaap-transcript-refetch-throttle';

/** Fake clock plus timers: `advance` moves time and fires due timers in order. */
const fakeClock = (): { now: () => number; timers: QaapTranscriptRefetchTimers; advance: (ms: number) => void } => {
    let current = 1_000;
    let nextHandle = 1;
    const pending = new Map<number, { at: number; run: () => void }>();
    const timers: QaapTranscriptRefetchTimers = {
        set: (run, delayMs) => {
            const handle = nextHandle++;
            pending.set(handle, { at: current + delayMs, run });
            return handle;
        },
        clear: handle => { pending.delete(handle as number); },
    };
    const advance = (ms: number): void => {
        const target = current + ms;
        for (;;) {
            const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) {
                break;
            }
            current = due[1].at;
            pending.delete(due[0]);
            due[1].run();
        }
        current = target;
    };
    return { now: () => current, timers, advance };
};

describe('QaapTranscriptRefetchThrottle', () => {
    it('allows the first refetch for a conversation immediately', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        expect(throttle.delayMs('conv-1')).to.equal(0);
    });

    it('reports the remaining window after a refetch was issued', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        throttle.markIssued('conv-1');
        clock.advance(1_999);
        expect(throttle.delayMs('conv-1')).to.equal(1);
        clock.advance(1);
        expect(throttle.delayMs('conv-1')).to.equal(0);
    });

    it('keeps conversations independent', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        throttle.markIssued('conv-1');
        expect(throttle.delayMs('conv-1')).to.equal(2_000);
        expect(throttle.delayMs('conv-2')).to.equal(0);
    });

    it('detects a real state change only against the state recorded at the last refetch', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        expect(throttle.hasStateChanged('conv-1', 'idle|10')).to.equal(true);
        throttle.markIssued('conv-1', 'idle|10');
        expect(throttle.hasStateChanged('conv-1', 'idle|10')).to.equal(false);
        expect(throttle.hasStateChanged('conv-1', 'idle|11')).to.equal(true);
    });

    it('fires one trailing refetch when the state changed inside the window', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        throttle.markIssued('conv-1', 'streaming|10');
        clock.advance(500);
        let fetches = 0;
        throttle.scheduleTrailing('conv-1', throttle.delayMs('conv-1'), 'idle|11', () => { fetches += 1; });
        expect(fetches).to.equal(0);
        clock.advance(1_499);
        expect(fetches).to.equal(0);
        clock.advance(1);
        expect(fetches).to.equal(1);
        expect(throttle.hasTrailing('conv-1')).to.equal(false);
        expect(throttle.hasStateChanged('conv-1', 'idle|11')).to.equal(false);
    });

    it('coalesces two changes inside the window into exactly one trailing refetch', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        throttle.markIssued('conv-1', 'streaming|10');
        let fetches = 0;
        throttle.scheduleTrailing('conv-1', throttle.delayMs('conv-1'), 'idle|11', () => { fetches += 1; });
        clock.advance(300);
        throttle.scheduleTrailing('conv-1', throttle.delayMs('conv-1'), 'idle|12', () => { fetches += 1; });
        clock.advance(5_000);
        expect(fetches).to.equal(1);
        expect(throttle.hasStateChanged('conv-1', 'idle|12')).to.equal(false);
    });

    it('issues no refetch when nothing changed', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        throttle.markIssued('conv-1', 'idle|10');
        let fetches = 0;
        // An unchanged state is never scheduled: the caller checks hasStateChanged first.
        if (throttle.hasStateChanged('conv-1', 'idle|10')) {
            throttle.scheduleTrailing('conv-1', throttle.delayMs('conv-1'), 'idle|10', () => { fetches += 1; });
        }
        clock.advance(5_000);
        expect(fetches).to.equal(0);
        expect(throttle.hasTrailing('conv-1')).to.equal(false);
    });

    it('cancelAll drops pending trailing refetches', () => {
        const clock = fakeClock();
        const throttle = new QaapTranscriptRefetchThrottle(2_000, clock.now, clock.timers);
        throttle.markIssued('conv-1', 'streaming|10');
        let fetches = 0;
        throttle.scheduleTrailing('conv-1', throttle.delayMs('conv-1'), 'idle|11', () => { fetches += 1; });
        throttle.cancelAll();
        clock.advance(5_000);
        expect(fetches).to.equal(0);
    });
});

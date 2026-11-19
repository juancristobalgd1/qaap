// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_PREVIEW_TURN_REFRESH_CLOCK_SLACK_MS,
    QaapPreviewTurnRefreshScheduler,
    type QaapPreviewTurnRefreshSummary,
} from './qaap-preview-turn-refresh-scheduler';

describe('QaapPreviewTurnRefreshScheduler', () => {
    let now: number;
    let timers: Map<number, () => void>;
    let nextTimer: number;
    let runs: { cwd: string; since: number }[];
    let outcome: void | 'defer';

    const scheduler = (): QaapPreviewTurnRefreshScheduler => new QaapPreviewTurnRefreshScheduler({
        debounceMs: 100,
        now: () => now,
        setTimer: callback => {
            const id = nextTimer++;
            timers.set(id, callback);
            return id;
        },
        clearTimer: handle => { timers.delete(handle as number); },
        run: async (cwd, since) => {
            runs.push({ cwd, since });
            return outcome;
        },
    });
    const flush = async (): Promise<void> => {
        const pending = [...timers.entries()];
        timers.clear();
        for (const [, callback] of pending) {
            callback();
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    };
    const row = (id: string, status: string, cwd = '/ws/todo'): QaapPreviewTurnRefreshSummary => ({ id, status, cwd });

    beforeEach(() => {
        now = 1_000_000;
        timers = new Map();
        nextTimer = 1;
        runs = [];
        outcome = undefined;
    });

    it('refreshes once after a turn settles, covering changes since the turn started', async () => {
        const subject = scheduler();
        subject.observe([row('c1', 'idle')]);
        subject.observe([row('c1', 'streaming')]);
        now += 30_000;
        subject.observe([row('c1', 'idle')]);
        expect(runs).to.deep.equal([]);
        await flush();
        expect(runs).to.deep.equal([{ cwd: '/ws/todo', since: 1_000_000 - QAAP_PREVIEW_TURN_REFRESH_CLOCK_SLACK_MS }]);
        await flush();
        expect(runs).to.have.length(1);
    });

    it('collapses chained turns into one refresh from the first turn start', async () => {
        const subject = scheduler();
        subject.observe([row('c1', 'streaming')]);
        subject.observe([row('c1', 'idle')]);
        now += 500;
        // The queued follow-up starts before the debounce fires: no refresh in between.
        subject.observe([row('c1', 'streaming')]);
        await flush();
        expect(runs).to.deep.equal([]);
        now += 20_000;
        subject.observe([row('c1', 'idle')]);
        await flush();
        expect(runs).to.deep.equal([{ cwd: '/ws/todo', since: 1_000_000 - QAAP_PREVIEW_TURN_REFRESH_CLOCK_SLACK_MS }]);
    });

    it('waits while another conversation of the same project is still running', async () => {
        const subject = scheduler();
        subject.observe([row('c1', 'streaming'), row('c2', 'streaming')]);
        subject.observe([row('c1', 'idle'), row('c2', 'streaming')]);
        await flush();
        expect(runs).to.deep.equal([]);
        subject.observe([row('c1', 'idle'), row('c2', 'idle')]);
        await flush();
        expect(runs).to.have.length(1);
    });

    it('never refreshes for a conversation first seen idle, and retries a deferred refresh', async () => {
        const subject = scheduler();
        subject.observe([row('c1', 'idle')]);
        await flush();
        expect(runs).to.deep.equal([]);

        outcome = 'defer';
        subject.observe([row('c1', 'streaming')]);
        subject.observe([row('c1', 'idle')]);
        await flush();
        expect(runs).to.have.length(1);
        outcome = undefined;
        await flush();
        expect(runs).to.have.length(2);
        await flush();
        expect(runs).to.have.length(2);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { billableAgentDurationMs } from './qaap-billing-agent-runtime';
import type { QaapAgentTask } from './qaap-agent-task';

function task(overrides: Partial<QaapAgentTask> = {}): QaapAgentTask {
    return {
        id: 't1',
        title: 'work',
        command: 'qaiq --print hi',
        cwd: '/tmp/repo',
        state: 'completed',
        createdAt: 1_000,
        finishedAt: 4 * 60_000,
        latencyMarks: { spawn_start: 2_000, spawn_end: 3_000 },
        ...overrides,
    };
}

describe('billableAgentDurationMs', () => {
    it('bills spawn_end → finishedAt, not queue time', () => {
        expect(billableAgentDurationMs(task())).to.equal(4 * 60_000 - 3_000);
    });

    it('does not bill cancelled or unspawned tasks', () => {
        expect(billableAgentDurationMs(task({ state: 'cancelled' }))).to.equal(0);
        expect(billableAgentDurationMs(task({ latencyMarks: undefined, finishedAt: 9_000 }))).to.equal(0);
        expect(billableAgentDurationMs(task({ state: 'running', finishedAt: undefined }))).to.equal(0);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapAgentTaskReview } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/**
 * Exposes the internal review pass and counts how far it gets. `isTaskStillRunning` is stubbed
 * true so the guard under test is `externalReview`, not task lifecycle.
 */
class TestableRunner extends QaapAgentTaskRunner {
    reachedAgentResolution = 0;

    runReview(task: QaapAgentTask): Promise<QaapAgentTaskReview | undefined> {
        return this.reviewSuccessfulAgentTask(task, undefined);
    }

    protected override isTaskStillRunning(): boolean {
        return true;
    }

    /** First step past the externalReview guard; counting it proves whether the guard fired. */
    protected override resolveTaskAgentId(task: QaapAgentTask): string {
        this.reachedAgentResolution++;
        return super.resolveTaskAgentId(task);
    }
}

function runner(): TestableRunner {
    const instance = Object.create(TestableRunner.prototype) as TestableRunner;
    Object.assign(instance, { reachedAgentResolution: 0, tasks: new Map(), detectedAgents: new Map() });
    return instance;
}

const baseTask: QaapAgentTask = {
    id: 't1',
    title: 'edit files',
    command: 'qaiq --prompt "do work"',
    cwd: '/repo',
    state: 'running',
    createdAt: 0,
    agentId: 'qaiq',
};

describe('reviewSuccessfulAgentTask externalReview guard', () => {
    const previous = process.env.QAAP_AGENT_REVIEW;
    afterEach(() => {
        if (previous === undefined) {
            delete process.env.QAAP_AGENT_REVIEW;
        } else {
            process.env.QAAP_AGENT_REVIEW = previous;
        }
    });

    it('skips the internal review when an orchestrator owns it', async () => {
        process.env.QAAP_AGENT_REVIEW = 'all';
        const instance = runner();
        const result = await instance.runReview({ ...baseTask, externalReview: true });
        expect(result).to.equal(undefined);
        // Bailed before resolving a reviewer agent, so no second reviewer was ever spawned.
        expect(instance.reachedAgentResolution).to.equal(0);
    });

    it('still runs the internal review for an ordinary task', async () => {
        process.env.QAAP_AGENT_REVIEW = 'all';
        const instance = runner();
        await instance.runReview(baseTask).catch(() => undefined);
        // Got past the guard: an ordinary turn keeps the runner's own review.
        expect(instance.reachedAgentResolution).to.equal(1);
    });

    it('honours QAAP_AGENT_REVIEW=off regardless of the flag', async () => {
        process.env.QAAP_AGENT_REVIEW = 'off';
        const instance = runner();
        expect(await instance.runReview({ ...baseTask, externalReview: true })).to.equal(undefined);
        expect(await instance.runReview(baseTask)).to.equal(undefined);
        expect(instance.reachedAgentResolution).to.equal(0);
    });
});

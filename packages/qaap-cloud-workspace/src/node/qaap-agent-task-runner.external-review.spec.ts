// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask, QaapAgentTaskReview } from '../common/qaap-agent-task';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
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

/** Harness for reviewer candidate selection: routing + health real, agent catalog stubbed. */
class RoutingRunner extends QaapAgentTaskRunner {
    installed: string[] = ['codex', 'claude', 'qaiq'];
    constructor() {
        super();
        Object.assign(this, {
            tasks: new Map(),
            detectedAgents: new Map(),
            workflowRouting: new QaapWorkflowRoutingPolicy(),
            agentHealth: new QaapAgentHealthTracker(),
        });
    }
    override listAgents(): { id: string; label: string; available: boolean }[] {
        return this.installed.map(id => ({ id, label: id, available: true }));
    }
    protected override resolveTaskAgentId(): string {
        return 'qaiq';
    }
    candidates(task: QaapAgentTask): string[] {
        return this.resolveReviewerCandidates(task);
    }
    health(): QaapAgentHealthTracker {
        return (this as unknown as { agentHealth: QaapAgentHealthTracker }).agentHealth;
    }
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

    it('prefers an independent reviewer over the agent that wrote the change', () => {
        const instance = new RoutingRunner();
        // Task agent is qaiq; default judge routing puts the strong reasoners ahead of it, so the
        // review is performed by someone other than the writer whenever one is installed.
        expect(instance.candidates(baseTask)).to.deep.equal(['claude', 'codex', 'qaiq']);
    });

    it('skips a reviewer whose CLI is cooling down', () => {
        const instance = new RoutingRunner();
        instance.health().noteFailure('codex');
        expect(instance.candidates(baseTask)[0]).to.equal('claude');
        expect(instance.candidates(baseTask)).to.not.include('codex');
    });

    it('falls back to the task agent when no routed backend is installed', () => {
        const instance = new RoutingRunner();
        instance.installed = [];
        expect(instance.candidates(baseTask)).to.deep.equal(['qaiq']);
    });

    it('reviews with the own agent alone when routing is not injected (bare harness)', () => {
        const instance = new RoutingRunner();
        Object.assign(instance, { workflowRouting: undefined });
        expect(instance.candidates(baseTask)).to.deep.equal(['qaiq']);
    });

    it('honours QAAP_AGENT_REVIEW=off regardless of the flag', async () => {
        process.env.QAAP_AGENT_REVIEW = 'off';
        const instance = runner();
        expect(await instance.runReview({ ...baseTask, externalReview: true })).to.equal(undefined);
        expect(await instance.runReview(baseTask)).to.equal(undefined);
        expect(instance.reachedAgentResolution).to.equal(0);
    });
});

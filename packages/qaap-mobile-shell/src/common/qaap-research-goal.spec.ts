// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    DEFAULT_RESEARCH_INFRA_FAILURE_LIMIT,
    DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
    DEFAULT_RESEARCH_STAGNATION_ROUNDS,
    normalizeResearchGoal,
} from './qaap-research-goal';

describe('qaap-research-goal', () => {

    const baseMetric = { name: 'loss', direction: 'min' as const, metricCommand: 'echo 0.5' };

    it('requires an id, cwd, description and at least one metric', () => {
        expect(() => normalizeResearchGoal({ cwd: '/tmp', description: 'd', metrics: [baseMetric] }))
            .to.throw(/id/);
        expect(() => normalizeResearchGoal({ id: 'g1', description: 'd', metrics: [baseMetric] }))
            .to.throw(/cwd/);
        expect(() => normalizeResearchGoal({ id: 'g1', cwd: '/tmp', metrics: [baseMetric] }))
            .to.throw(/description/);
        expect(() => normalizeResearchGoal({ id: 'g1', cwd: '/tmp', description: 'd', metrics: [] }))
            .to.throw(/metric/);
        expect(() => normalizeResearchGoal({ id: 'g1', cwd: '/tmp', description: 'd' }))
            .to.throw(/metric/);
    });

    it('defaults the first metric to primary when none is marked', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd',
            metrics: [baseMetric, { name: 'acc', direction: 'max', metricCommand: 'echo 0.9' }],
        });
        expect(goal.metrics[0].primary).to.be.true;
        expect(goal.metrics[1].primary).to.be.false;
    });

    it('keeps the caller-marked primary metric', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd',
            metrics: [baseMetric, { name: 'acc', direction: 'max', metricCommand: 'echo 0.9', primary: true }],
        });
        expect(goal.metrics[0].primary).to.be.false;
        expect(goal.metrics[1].primary).to.be.true;
    });

    it('throws when more than one metric is marked primary', () => {
        expect(() => normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd',
            metrics: [
                { ...baseMetric, primary: true },
                { name: 'acc', direction: 'max', metricCommand: 'echo 0.9', primary: true },
            ],
        })).to.throw(/exactly one primary/);
    });

    it('applies generous / small defaults for timeouts, stagnation and infra limits', () => {
        const goal = normalizeResearchGoal({ id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric] });
        expect(goal.runTimeoutMs).to.equal(DEFAULT_RESEARCH_RUN_TIMEOUT_MS);
        expect(goal.stagnationRounds).to.equal(DEFAULT_RESEARCH_STAGNATION_ROUNDS);
        expect(goal.infraFailureLimit).to.equal(DEFAULT_RESEARCH_INFRA_FAILURE_LIMIT);
        expect(goal.metrics[0].minImprovement).to.equal(0);
        expect(goal.status).to.equal('running');
        expect(goal.createdAt).to.be.a('number');
    });

    it('preserves caller-supplied overrides instead of defaults', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            runTimeoutMs: 1000, stagnationRounds: 5, infraFailureLimit: 2,
            maxRounds: 10, deadlineAt: 123, createdAt: 42, status: 'completed',
        });
        expect(goal.runTimeoutMs).to.equal(1000);
        expect(goal.stagnationRounds).to.equal(5);
        expect(goal.infraFailureLimit).to.equal(2);
        expect(goal.maxRounds).to.equal(10);
        expect(goal.deadlineAt).to.equal(123);
        expect(goal.createdAt).to.equal(42);
        expect(goal.status).to.equal('completed');
    });

    it('passes through an explicit agentModel unchanged', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-5' },
        });
        expect(goal.agentModel).to.deep.equal({ provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-5' });
    });

    it('leaves agentModel undefined when the caller omits it', () => {
        const goal = normalizeResearchGoal({ id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric] });
        expect(goal.agentModel).to.equal(undefined);
    });

    it('rejects an agentModel with an empty provider or modelId', () => {
        expect(() => normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            agentModel: { provider: '', modelId: 'claude-sonnet-4-5' },
        })).to.throw(/agentModel/);
        expect(() => normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            agentModel: { provider: 'anthropic', modelId: '' },
        })).to.throw(/agentModel/);
    });

    it('keeps runCommand separate from metricCommand — never merges them', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd',
            runCommand: 'python train.py',
            metrics: [{ ...baseMetric, metricCommand: 'python eval.py' }],
        });
        expect(goal.runCommand).to.equal('python train.py');
        expect(goal.metrics[0].metricCommand).to.equal('python eval.py');
        expect(goal.runCommand).to.not.equal(goal.metrics[0].metricCommand);
    });
});

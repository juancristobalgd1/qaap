// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    DEFAULT_RESEARCH_INFRA_FAILURE_LIMIT,
    DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
    DEFAULT_RESEARCH_STAGNATION_ROUNDS,
    filterResearchGoalsByQuery,
    formatResearchGoalActiveDuration,
    normalizeResearchGoal,
    researchGoalCwdBasename,
    resolveResearchGoalActiveElapsedMs,
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
        expect(goal.maxRounds).to.equal(20);
        expect(goal.metrics[0].minImprovement).to.equal(0);
        expect(goal.status).to.equal('running');
        expect(goal.createdAt).to.be.a('number');
        expect(goal.startedAt).to.equal(goal.createdAt);
    });

    it('sets startedAt when a running goal is normalized without an explicit value', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            createdAt: 1000,
        });
        expect(goal.startedAt).to.equal(1000);
    });

    it('omits startedAt for non-running goals unless the caller supplies it', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            status: 'completed', createdAt: 1000,
        });
        expect(goal.startedAt).to.equal(undefined);
    });

    it('resolveResearchGoalActiveElapsedMs uses startedAt and finishedAt for stopped goals', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            startedAt: 1000, finishedAt: 175_000, status: 'completed', createdAt: 500,
        });
        expect(resolveResearchGoalActiveElapsedMs(goal)).to.equal(174_000);
        expect(formatResearchGoalActiveDuration(goal)).to.equal('2m 54s');
    });

    it('resolveResearchGoalActiveElapsedMs falls back to createdAt for legacy running goals', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            createdAt: 1000,
        });
        expect(resolveResearchGoalActiveElapsedMs(goal, 175_000)).to.equal(174_000);
    });

    it('preserves caller-supplied overrides instead of defaults', () => {
        const goal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric],
            runTimeoutMs: 120_000, stagnationRounds: 5, infraFailureLimit: 2,
            maxRounds: 10, deadlineAt: 123, createdAt: 42, status: 'completed',
        });
        expect(goal.runTimeoutMs).to.equal(120_000);
        expect(goal.stagnationRounds).to.equal(5);
        expect(goal.infraFailureLimit).to.equal(2);
        expect(goal.maxRounds).to.equal(10);
        expect(goal.deadlineAt).to.equal(123);
        expect(goal.createdAt).to.equal(42);
        expect(goal.status).to.equal('completed');
    });

    it('rejects out-of-range timeouts, rounds and metric counts', () => {
        expect(() => normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric], runTimeoutMs: 1000,
        })).to.throw(/runTimeoutMs/);
        expect(() => normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd', metrics: [baseMetric], maxRounds: 0,
        })).to.throw(/maxRounds/);
        expect(() => normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd',
            metrics: Array.from({ length: 6 }, (_, i) => ({
                name: `m${i}`, direction: 'min' as const, metricCommand: 'echo 1',
            })),
        })).to.throw(/at most 5 metrics/);
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

    it('researchGoalCwdBasename returns the last path segment', () => {
        expect(researchGoalCwdBasename('/tmp/my-repo')).to.equal('my-repo');
        expect(researchGoalCwdBasename('C:\\work\\qaap')).to.equal('qaap');
        expect(researchGoalCwdBasename('single')).to.equal('single');
    });

    it('filterResearchGoalsByQuery matches description and cwd', () => {
        const goals = [
            normalizeResearchGoal({ id: 'g1', cwd: '/tmp/alpha', description: 'Tune learning rate', metrics: [baseMetric] }),
            normalizeResearchGoal({ id: 'g2', cwd: '/tmp/beta', description: 'Reduce drift', metrics: [baseMetric] }),
        ];
        expect(filterResearchGoalsByQuery(goals, 'drift')).to.have.lengthOf(1);
        expect(filterResearchGoalsByQuery(goals, 'beta')).to.have.lengthOf(1);
    });
});

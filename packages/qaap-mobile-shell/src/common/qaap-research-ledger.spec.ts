// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizeResearchGoal, type ResearchGoal, type ResearchMetricSpec } from './qaap-research-goal';
import {
    bestPrimaryValue,
    configFingerprint,
    evaluateVerdict,
    parseExperimentProposal,
    parseMetricFromStdout,
    renderLedgerForPrompt,
    resolveTerminationReason,
    summarizeResearchGoalLedger,
    type ResearchExperimentRecord,
} from './qaap-research-ledger';

function record(overrides: Partial<ResearchExperimentRecord> & { round: number }): ResearchExperimentRecord {
    return {
        id: `exp-${overrides.round}`,
        goalId: 'g1',
        startedAt: 0,
        hypothesis: 'h',
        declaredConfig: {},
        declaredConfigFingerprint: 'fp',
        realChangeFingerprint: 'rfp',
        phase: 'done',
        metrics: [],
        ...overrides,
    };
}

describe('qaap-research-ledger', () => {

    describe('parseExperimentProposal', () => {
        it('parses a well-formed [QAAP experiment] block', () => {
            const stdout = [
                'Some reasoning text before the marker.',
                '[QAAP experiment]',
                '```json',
                '{"symptom": "loss plateaued", "hypothesis": "lr too low", "lever": "learning_rate", "config": {"learning_rate": 0.01}}',
                '```',
            ].join('\n');
            const proposal = parseExperimentProposal(stdout);
            expect(proposal).to.deep.equal({
                symptom: 'loss plateaued',
                hypothesis: 'lr too low',
                lever: 'learning_rate',
                config: { learning_rate: 0.01 },
            });
        });

        it('returns undefined when there is no marker', () => {
            expect(parseExperimentProposal('just some text, no directive here')).to.be.undefined;
        });

        it('returns undefined for malformed JSON without throwing', () => {
            const stdout = '[QAAP experiment]\n```json\n{not valid json\n```';
            expect(() => parseExperimentProposal(stdout)).to.not.throw();
            expect(parseExperimentProposal(stdout)).to.be.undefined;
        });

        it('returns undefined when hypothesis is missing', () => {
            const stdout = '[QAAP experiment]\n```json\n{"config": {}}\n```';
            expect(parseExperimentProposal(stdout)).to.be.undefined;
        });

        it('defaults config to {} when the agent omits it', () => {
            const stdout = '[QAAP experiment]\n```json\n{"hypothesis": "h"}\n```';
            expect(parseExperimentProposal(stdout)).to.deep.equal({ symptom: undefined, hypothesis: 'h', lever: undefined, config: {} });
        });

        it('is case-insensitive on the marker and tolerant of surrounding whitespace', () => {
            const stdout = '[qaap  EXPERIMENT]\n```json\n{"hypothesis": "h", "config": {"x": 1}}\n```\ntrailer';
            expect(parseExperimentProposal(stdout)).to.deep.equal({ symptom: undefined, hypothesis: 'h', lever: undefined, config: { x: 1 } });
        });
    });

    describe('parseMetricFromStdout', () => {
        const regexSpec: ResearchMetricSpec = { name: 'loss', direction: 'min', metricCommand: 'x', metricRegex: 'loss=([\\d.]+)' };
        const jsonPathSpec: ResearchMetricSpec = { name: 'acc', direction: 'max', metricCommand: 'x', metricJsonPath: 'result.metrics[0].value' };
        const plainSpec: ResearchMetricSpec = { name: 'loss', direction: 'min', metricCommand: 'x' };

        it('parses the LAST float in stdout by default, ignoring progress lines', () => {
            const stdout = 'epoch 1: loss 0.9\nepoch 2: loss 0.5\nepoch 3: loss 0.31\nfinal loss: 0.219';
            expect(parseMetricFromStdout(stdout, plainSpec)).to.equal(0.219);
        });

        it('uses the metricRegex capture group when provided', () => {
            const stdout = 'noise 0.1 more noise\nloss=0.42 extra=1\n';
            expect(parseMetricFromStdout(stdout, regexSpec)).to.equal(0.42);
        });

        it('uses metricJsonPath when provided, taking priority over regex/last-float', () => {
            const stdout = JSON.stringify({ result: { metrics: [{ value: 0.87 }] } });
            expect(parseMetricFromStdout(stdout, jsonPathSpec)).to.equal(0.87);
        });

        it('returns undefined when nothing numeric can be found', () => {
            expect(parseMetricFromStdout('no numbers here at all', plainSpec)).to.be.undefined;
        });

        it('returns undefined when metricRegex does not match', () => {
            expect(parseMetricFromStdout('irrelevant output', regexSpec)).to.be.undefined;
        });

        it('returns undefined when metricJsonPath stdout is not valid JSON', () => {
            expect(parseMetricFromStdout('not json', jsonPathSpec)).to.be.undefined;
        });

        it('returns undefined when metricJsonPath resolves to a missing path', () => {
            expect(parseMetricFromStdout(JSON.stringify({ result: {} }), jsonPathSpec)).to.be.undefined;
        });
    });

    describe('evaluateVerdict', () => {
        const maxSpec: ResearchMetricSpec = { name: 'acc', direction: 'max', metricCommand: 'x' };
        const minSpec: ResearchMetricSpec = { name: 'loss', direction: 'min', metricCommand: 'x' };
        const minSpecWithThreshold: ResearchMetricSpec = { name: 'loss', direction: 'min', metricCommand: 'x', minImprovement: 0.05 };

        it('treats the first-ever measurement as improved (establishes the baseline)', () => {
            expect(evaluateVerdict(0.5, undefined, minSpec)).to.deep.equal({ verdict: 'improved', delta: 0 });
        });

        it('is "improved" when a higher value beats best for a max metric', () => {
            const { verdict, delta } = evaluateVerdict(0.9, 0.8, maxSpec);
            expect(verdict).to.equal('improved');
            expect(delta).to.be.closeTo(0.1, 1e-9);
        });

        it('is "regressed" when a lower value is worse for a max metric', () => {
            const { verdict } = evaluateVerdict(0.7, 0.8, maxSpec);
            expect(verdict).to.equal('regressed');
        });

        it('is "improved" when a lower value beats best for a min metric', () => {
            const { verdict, delta } = evaluateVerdict(0.3, 0.5, minSpec);
            expect(verdict).to.equal('improved');
            expect(delta).to.be.closeTo(0.2, 1e-9);
        });

        it('is "regressed" when a higher value is worse for a min metric', () => {
            const { verdict } = evaluateVerdict(0.6, 0.5, minSpec);
            expect(verdict).to.equal('regressed');
        });

        it('is "neutral" when the value ties best exactly (minImprovement 0)', () => {
            const { verdict, delta } = evaluateVerdict(0.5, 0.5, minSpec);
            expect(verdict).to.equal('neutral');
            expect(delta).to.equal(0);
        });

        it('respects minImprovement: small gains inside the threshold are neutral, not improved', () => {
            expect(evaluateVerdict(0.48, 0.5, minSpecWithThreshold).verdict).to.equal('neutral');
            expect(evaluateVerdict(0.4, 0.5, minSpecWithThreshold).verdict).to.equal('improved');
        });

        it('respects minImprovement on the regression side too', () => {
            expect(evaluateVerdict(0.52, 0.5, minSpecWithThreshold).verdict).to.equal('neutral');
            expect(evaluateVerdict(0.6, 0.5, minSpecWithThreshold).verdict).to.equal('regressed');
        });
    });

    describe('configFingerprint', () => {
        it('is deterministic for the same config', () => {
            const config = { lr: 0.01, batch: 32 };
            expect(configFingerprint(config)).to.equal(configFingerprint({ lr: 0.01, batch: 32 }));
        });

        it('is insensitive to key order', () => {
            expect(configFingerprint({ a: 1, b: 2 })).to.equal(configFingerprint({ b: 2, a: 1 }));
        });

        it('is insensitive to nested key order', () => {
            const left = { outer: { x: 1, y: 2 }, list: [1, 2, 3] };
            const right = { outer: { y: 2, x: 1 }, list: [1, 2, 3] };
            expect(configFingerprint(left)).to.equal(configFingerprint(right));
        });

        it('differs for different configs', () => {
            expect(configFingerprint({ lr: 0.01 })).to.not.equal(configFingerprint({ lr: 0.02 }));
        });

        it('differs when array order changes (order-sensitive, unlike object keys)', () => {
            expect(configFingerprint({ list: [1, 2] })).to.not.equal(configFingerprint({ list: [2, 1] }));
        });

        it('is stable across repeated calls (pure function, no process-dependent state)', () => {
            const config = { a: { b: { c: [1, 2, { d: 'x' }] } } };
            const first = configFingerprint(config);
            const second = configFingerprint(config);
            expect(first).to.equal(second);
        });
    });

    describe('renderLedgerForPrompt', () => {
        it('renders a message when there are no experiments yet', () => {
            expect(renderLedgerForPrompt([])).to.equal('No experiments recorded yet.');
        });

        it('renders one row per record with round, hypothesis, lever, metrics and verdict', () => {
            const table = renderLedgerForPrompt([
                record({ round: 1, hypothesis: 'try higher lr', lever: 'lr', metrics: [{ name: 'loss', value: 0.4, direction: 'min' }], verdict: 'improved' }),
            ]);
            expect(table).to.contain('| 1 | try higher lr | lr | loss=0.4 | improved |');
        });

        it('truncates to the most recent maxRows and notes how many were omitted', () => {
            const records = [1, 2, 3, 4].map(round => record({ round }));
            const table = renderLedgerForPrompt(records, { maxRows: 2 });
            expect(table).to.contain('2 earlier rounds omitted');
            expect(table).to.contain('| 3 |');
            expect(table).to.contain('| 4 |');
            expect(table).to.not.contain('| 1 |');
        });
    });

    describe('resolveTerminationReason', () => {
        const goal: ResearchGoal = normalizeResearchGoal({
            id: 'g1', cwd: '/tmp', description: 'd',
            metrics: [{ name: 'loss', direction: 'min', metricCommand: 'x', target: 0.1, primary: true }],
            maxRounds: 5, stagnationRounds: 3, infraFailureLimit: 3,
        });

        it('continues (undefined) with an empty ledger and nothing exhausted', () => {
            expect(resolveTerminationReason(goal, [], 0)).to.be.undefined;
        });

        it('reaches target once the primary metric crosses it in the right direction', () => {
            const records = [record({ round: 1, metrics: [{ name: 'loss', value: 0.05, direction: 'min' }], verdict: 'improved' })];
            expect(resolveTerminationReason(goal, records, 0)).to.equal('reached-target');
        });

        it('does not reach target when the metric has not crossed it yet', () => {
            const records = [record({ round: 1, metrics: [{ name: 'loss', value: 0.5, direction: 'min' }], verdict: 'improved' })];
            expect(resolveTerminationReason(goal, records, 0)).to.be.undefined;
        });

        it('exhausts budget once maxRounds is reached', () => {
            const records = [1, 2, 3, 4, 5].map(round =>
                record({ round, metrics: [{ name: 'loss', value: 1, direction: 'min' }], verdict: 'neutral' }));
            // 5 rounds all neutral would also stagnate (>=3), so isolate budget by using a short stagnation-free goal.
            const budgetGoal: ResearchGoal = { ...goal, maxRounds: 5, stagnationRounds: 100, infraFailureLimit: 100 };
            expect(resolveTerminationReason(budgetGoal, records, 0)).to.equal('budget-exhausted');
        });

        it('exhausts budget once the deadline passes, even under maxRounds', () => {
            const deadlineGoal: ResearchGoal = { ...goal, maxRounds: 100, deadlineAt: 1000, stagnationRounds: 100, infraFailureLimit: 100 };
            const records = [record({ round: 1, metrics: [{ name: 'loss', value: 1, direction: 'min' }], verdict: 'neutral' })];
            expect(resolveTerminationReason(deadlineGoal, records, 1000)).to.equal('budget-exhausted');
            expect(resolveTerminationReason(deadlineGoal, records, 999)).to.be.undefined;
        });

        it('flags infra-broken after infraFailureLimit consecutive failed rounds', () => {
            const infraGoal: ResearchGoal = { ...goal, maxRounds: 100, stagnationRounds: 100, infraFailureLimit: 2 };
            const records = [
                record({ round: 1, verdict: 'improved', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 2, verdict: 'failed' }),
                record({ round: 3, verdict: 'failed' }),
            ];
            expect(resolveTerminationReason(infraGoal, records, 0)).to.equal('infra-broken');
        });

        it('flags stagnated after stagnationRounds consecutive non-improving rounds', () => {
            const stagnationGoal: ResearchGoal = { ...goal, maxRounds: 100, stagnationRounds: 3, infraFailureLimit: 100 };
            const records = [
                record({ round: 1, verdict: 'improved', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 2, verdict: 'neutral', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 3, verdict: 'regressed', metrics: [{ name: 'loss', value: 0.6, direction: 'min' }] }),
                record({ round: 4, verdict: 'neutral', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
            ];
            expect(resolveTerminationReason(stagnationGoal, records, 0)).to.equal('stagnated');
        });

        it('BUG 2: a "noop" verdict counts toward stagnation — an inert agent must not exhaust the whole budget', () => {
            const stagnationGoal: ResearchGoal = { ...goal, maxRounds: 100, stagnationRounds: 3, infraFailureLimit: 100 };
            const records = [
                record({ round: 1, verdict: 'improved', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 2, verdict: 'noop' }),
                record({ round: 3, verdict: 'noop' }),
                record({ round: 4, verdict: 'noop' }),
            ];
            expect(resolveTerminationReason(stagnationGoal, records, 0)).to.equal('stagnated');
        });

        it('CRITICAL: does not collapse failed and regressed — infra failures never count toward stagnation', () => {
            // 3 consecutive infra failures (e.g. CUDA OOM) must read as infra-broken, not as
            // "3 bad hypotheses in a row". With a high stagnationRounds, only the infra counter can trip.
            const goalHighStagnation: ResearchGoal = { ...goal, maxRounds: 100, stagnationRounds: 100, infraFailureLimit: 3 };
            const records = [
                record({ round: 1, verdict: 'improved', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 2, verdict: 'failed' }),
                record({ round: 3, verdict: 'failed' }),
                record({ round: 4, verdict: 'failed' }),
            ];
            expect(resolveTerminationReason(goalHighStagnation, records, 0)).to.equal('infra-broken');
        });

        it('CRITICAL: does not collapse failed and regressed — an infra failure never counts as a regression either', () => {
            // With a high infraFailureLimit, only 1 failed round should never trip infra-broken, and
            // it must not be misread as contributing to a regression-based stagnation streak.
            const goalHighInfra: ResearchGoal = { ...goal, maxRounds: 100, stagnationRounds: 2, infraFailureLimit: 100 };
            const records = [
                record({ round: 1, verdict: 'improved', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 2, verdict: 'regressed', metrics: [{ name: 'loss', value: 0.6, direction: 'min' }] }),
                record({ round: 3, verdict: 'failed' }),
            ];
            // The lone failed round is skipped for stagnation purposes: only 1 real non-improving
            // round (round 2) has been observed so far, below the stagnationRounds threshold of 2.
            expect(resolveTerminationReason(goalHighInfra, records, 0)).to.be.undefined;
        });

        it('an infra failure resets neither extends the infra streak across an improved round', () => {
            const infraGoal: ResearchGoal = { ...goal, maxRounds: 100, stagnationRounds: 100, infraFailureLimit: 2 };
            const records = [
                record({ round: 1, verdict: 'failed' }),
                record({ round: 2, verdict: 'improved', metrics: [{ name: 'loss', value: 0.5, direction: 'min' }] }),
                record({ round: 3, verdict: 'failed' }),
            ];
            // Only 1 trailing failure (round 3) since round 2 broke the streak.
            expect(resolveTerminationReason(infraGoal, records, 0)).to.be.undefined;
        });

        it('reports cancelled immediately when the goal status is cancelled, regardless of records', () => {
            const cancelledGoal: ResearchGoal = { ...goal, status: 'cancelled' };
            expect(resolveTerminationReason(cancelledGoal, [], 0)).to.equal('cancelled');
        });
    });

    describe('summarizeResearchGoalLedger', () => {
        it('ignores preflight and counts experiment rounds with the last hypothesis', () => {
            const records = [
                record({ round: 0, preflight: true, hypothesis: '(preflight)' }),
                record({ round: 1, hypothesis: 'Try LR 0.01' }),
                record({ round: 2, hypothesis: 'Try LR 0.005', verdict: 'improved' }),
            ];
            expect(summarizeResearchGoalLedger(records)).to.deep.equal({
                experimentRoundCount: 2,
                lastHypothesis: 'Try LR 0.005',
                lastVerdict: 'improved',
            });
        });
    });

    describe('bestPrimaryValue', () => {
        it('returns the best value for a max primary metric', () => {
            const primary: ResearchMetricSpec = { name: 'acc', direction: 'max', metricCommand: 'echo 1' };
            const records = [
                record({ round: 1, metrics: [{ name: 'acc', value: 0.7, direction: 'max' }] }),
                record({ round: 2, metrics: [{ name: 'acc', value: 0.9, direction: 'max' }] }),
            ];
            expect(bestPrimaryValue(records, primary)).to.equal(0.9);
        });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizeResearchGoal } from './qaap-research-goal';
import { QAAP_EXPERIMENT_MARKER, type ResearchExperimentRecord } from './qaap-research-ledger';
import { buildResearchRoundPrompt } from './qaap-research-prompt';

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

describe('qaap-research-prompt', () => {

    const goal = normalizeResearchGoal({
        id: 'g1', cwd: '/tmp', description: 'Minimize eval loss on the held-out set.',
        metrics: [{ name: 'loss', direction: 'min', metricCommand: 'python eval.py', target: 0.1, primary: true }],
        maxRounds: 10,
    });

    it('includes the goal description, primary metric direction, target and rounds remaining', () => {
        const prompt = buildResearchRoundPrompt(goal, []);
        expect(prompt).to.contain('Minimize eval loss on the held-out set.');
        expect(prompt).to.contain('loss');
        expect(prompt).to.contain('lower is better');
        expect(prompt).to.contain('Target: 0.1');
        expect(prompt).to.contain('10 of 10');
    });

    it('reports the best-so-far value and the round it happened in', () => {
        const records = [
            record({ round: 1, metrics: [{ name: 'loss', value: 0.5, direction: 'min' }], verdict: 'improved' }),
            record({ round: 2, metrics: [{ name: 'loss', value: 0.3, direction: 'min' }], verdict: 'improved' }),
            record({ round: 3, metrics: [{ name: 'loss', value: 0.4, direction: 'min' }], verdict: 'regressed' }),
        ];
        const prompt = buildResearchRoundPrompt(goal, records);
        expect(prompt).to.contain('Best so far: 0.3 (round 2)');
        expect(prompt).to.contain('Rounds remaining: 7 of 10');
    });

    it('renders the ledger table', () => {
        const records = [record({ round: 1, hypothesis: 'lower dropout', lever: 'dropout', metrics: [{ name: 'loss', value: 0.4, direction: 'min' }], verdict: 'improved' })];
        const prompt = buildResearchRoundPrompt(goal, records);
        expect(prompt).to.contain('| 1 | lower dropout | dropout | loss=0.4 | improved |');
    });

    it('lists tried configs with regressions first', () => {
        const records = [
            record({ round: 1, lever: 'lr', hypothesis: 'raise lr', declaredConfigFingerprint: 'fp1', verdict: 'neutral' }),
            record({ round: 2, lever: 'batch', hypothesis: 'shrink batch', declaredConfigFingerprint: 'fp2', verdict: 'regressed' }),
            record({ round: 3, lever: 'dropout', hypothesis: 'raise dropout', declaredConfigFingerprint: 'fp3', verdict: 'improved' }),
        ];
        const prompt = buildResearchRoundPrompt(goal, records);
        const regressedIndex = prompt.indexOf('fp2');
        const neutralIndex = prompt.indexOf('fp1');
        const improvedIndex = prompt.indexOf('fp3');
        expect(regressedIndex).to.be.greaterThan(-1);
        expect(regressedIndex).to.be.lessThan(neutralIndex);
        expect(regressedIndex).to.be.lessThan(improvedIndex);
    });

    it('includes the diagnostic framing instructing symptom / cause / single lever', () => {
        const prompt = buildResearchRoundPrompt(goal, []);
        expect(prompt).to.match(/SYMPTOM/);
        expect(prompt).to.match(/CAUSE/);
        expect(prompt).to.match(/single lever|SINGLE lever/i);
        expect(prompt).to.contain('Exactly one lever');
    });

    it('includes the constraints: no touching metric/eval, no editing the ledger, no launching training itself', () => {
        const prompt = buildResearchRoundPrompt(goal, []);
        expect(prompt).to.match(/metric command/i);
        expect(prompt).to.match(/evaluation set/i);
        expect(prompt).to.match(/ledger/i);
        expect(prompt).to.match(/do not launch/i);
        expect(prompt).to.match(/30 second/i);
    });

    it('includes the [QAAP experiment] output-format directive with the expected JSON keys', () => {
        const prompt = buildResearchRoundPrompt(goal, []);
        expect(prompt).to.contain(QAAP_EXPERIMENT_MARKER);
        expect(prompt).to.contain('```json');
        expect(prompt).to.contain('"hypothesis"');
        expect(prompt).to.contain('"lever"');
        expect(prompt).to.contain('"config"');
        expect(prompt).to.contain('"symptom"');
    });

    it('shows "unbounded" rounds remaining when maxRounds is not set', () => {
        const unboundedGoal = normalizeResearchGoal({
            id: 'g2', cwd: '/tmp', description: 'd',
            metrics: [{ name: 'loss', direction: 'min', metricCommand: 'x' }],
        });
        const prompt = buildResearchRoundPrompt(unboundedGoal, []);
        expect(prompt).to.contain('Rounds remaining: unbounded');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    goalLoopSummaryFields,
    isGoalLoopSummaryActive,
    resolveGoalLoopChipView,
    resolveGoalLoopPillLabel,
} from './qaap-agent-goal-loop-labels';

describe('qaap-agent-goal-loop-labels', () => {
    it('shows nothing without a goal loop', () => {
        expect(resolveGoalLoopChipView(undefined)).to.equal(undefined);
        expect(resolveGoalLoopChipView({})).to.equal(undefined);
        expect(resolveGoalLoopPillLabel({})).to.equal(undefined);
        expect(isGoalLoopSummaryActive({})).to.equal(false);
    });

    it('labels the running phases with the iteration', () => {
        const executing = { goalLoopPhase: 'executing' as const, goalLoopIteration: 2, goalLoopMaxIterations: 8 };
        expect(resolveGoalLoopChipView(executing)).to.include({ label: 'Executing 2/8', tone: 'running' });
        expect(resolveGoalLoopChipView({ ...executing, goalLoopPhase: 'verifying' })?.label).to.equal('Verifying 2/8');
        expect(resolveGoalLoopChipView({ ...executing, goalLoopPhase: 'evaluating' })?.label).to.equal('Evaluating 2/8');
        expect(resolveGoalLoopPillLabel({ ...executing, goalLoopPhase: 'verifying' })).to.equal('Iteration 2/8 · Verifying');
        expect(isGoalLoopSummaryActive(executing)).to.equal(true);
    });

    it('clamps odd iteration counts', () => {
        expect(resolveGoalLoopPillLabel({ goalLoopPhase: 'executing', goalLoopIteration: 12, goalLoopMaxIterations: 8 }))
            .to.equal('Iteration 8/8 · Executing');
        expect(resolveGoalLoopPillLabel({ goalLoopPhase: 'executing' })).to.equal('Iteration 1/1 · Executing');
    });

    it('labels terminal phases, with the stop reason as tooltip', () => {
        expect(resolveGoalLoopChipView({ goalLoopPhase: 'completed' })).to.include({ label: 'Goal done', tone: 'ok' });
        expect(resolveGoalLoopChipView({ goalLoopPhase: 'blocked', goalLoopStopReason: 'Out of time.' }))
            .to.include({ label: 'Goal blocked', tone: 'fail', title: 'Out of time.' });
        expect(resolveGoalLoopChipView({ goalLoopPhase: 'cancelled', goalLoopStopReason: 'Stopped by the user.' }))
            .to.include({ label: 'Goal cancelled', tone: 'cancelled', title: 'Stopped by the user.' });
        expect(resolveGoalLoopPillLabel({ goalLoopPhase: 'completed' })).to.equal(undefined);
    });

    it('derives summary fields from a full state', () => {
        expect(goalLoopSummaryFields({
            phase: 'blocked', goal: 'g', startedAt: 0, updatedAt: 0, iteration: 3, anchorUserMessageId: 'u',
            budget: { maxIterations: 8, maxDurationMs: 1, maxEvaluatorCalls: 8, maxAgentRuntimeMs: 1 },
            usage: { evaluatorCalls: 1, agentRuntimeMs: 1 }, stopReason: 'x',
        })).to.deep.equal({ goalLoopPhase: 'blocked', goalLoopIteration: 3, goalLoopMaxIterations: 8, goalLoopStopReason: 'x' });
        expect(goalLoopSummaryFields(undefined).goalLoopPhase).to.equal(undefined);
    });
});

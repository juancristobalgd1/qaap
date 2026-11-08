// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    isGoalLoopPhaseActive,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentGoalLoopStateDTO,
} from './qaap-agent-conversation-client';

/** The goal-loop fields of a conversation summary (what the chip and pill read). */
export type QaapGoalLoopSummaryFields = Pick<
    QaapAgentConversationSummaryDTO,
    'goalLoopPhase' | 'goalLoopIteration' | 'goalLoopMaxIterations' | 'goalLoopStopReason'
>;

/** Summary fields derived from a full goal-loop state (mirrors the backend summary mapping). */
export function goalLoopSummaryFields(goalLoop: QaapAgentGoalLoopStateDTO | undefined): QaapGoalLoopSummaryFields {
    if (!goalLoop) {
        return {
            goalLoopPhase: undefined,
            goalLoopIteration: undefined,
            goalLoopMaxIterations: undefined,
            goalLoopStopReason: undefined,
        };
    }
    return {
        goalLoopPhase: goalLoop.phase,
        goalLoopIteration: goalLoop.iteration,
        goalLoopMaxIterations: goalLoop.budget.maxIterations,
        goalLoopStopReason: goalLoop.stopReason,
    };
}

export function isGoalLoopSummaryActive(summary: QaapGoalLoopSummaryFields | undefined): boolean {
    return isGoalLoopPhaseActive(summary?.goalLoopPhase);
}

function phaseLabel(phase: 'executing' | 'verifying' | 'evaluating'): string {
    switch (phase) {
        case 'verifying':
            return nls.localize('theia/qaap/goalLoop/phaseVerifying', 'Verifying');
        case 'evaluating':
            return nls.localize('theia/qaap/goalLoop/phaseEvaluating', 'Evaluating');
        default:
            return nls.localize('theia/qaap/goalLoop/phaseExecuting', 'Executing');
    }
}

function progress(summary: QaapGoalLoopSummaryFields): { current: string; total: string } {
    const total = Math.max(1, summary.goalLoopMaxIterations ?? 1);
    const current = Math.min(total, Math.max(1, summary.goalLoopIteration ?? 1));
    return { current: String(current), total: String(total) };
}

/** Composer pill while a loop runs: "Iteration 2/8 · Verifying". `undefined` when no loop is active. */
export function resolveGoalLoopPillLabel(summary: QaapGoalLoopSummaryFields | undefined): string | undefined {
    const phase = summary?.goalLoopPhase;
    if (!summary || (phase !== 'executing' && phase !== 'verifying' && phase !== 'evaluating')) {
        return undefined;
    }
    const { current, total } = progress(summary);
    return nls.localize('theia/qaap/goalLoop/pill', 'Iteration {0}/{1} · {2}', current, total, phaseLabel(phase));
}

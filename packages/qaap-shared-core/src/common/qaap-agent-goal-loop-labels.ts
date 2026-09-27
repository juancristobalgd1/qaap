// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    isGoalLoopPhaseActive,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentGoalLoopPhaseDTO,
    type QaapAgentGoalLoopStateDTO,
} from './qaap-agent-conversation-client';

/** The goal-loop fields of a conversation summary (what the chip and pill read). */
export type QaapGoalLoopSummaryFields = Pick<
    QaapAgentConversationSummaryDTO,
    'goalLoopPhase' | 'goalLoopIteration' | 'goalLoopMaxIterations' | 'goalLoopStopReason'
>;

/** Visual tone of the transcript header chip; maps to `theia-mod-*` classes. */
export type QaapGoalLoopChipTone = 'running' | 'ok' | 'fail' | 'cancelled';

export interface QaapGoalLoopChipView {
    readonly label: string;
    readonly tone: QaapGoalLoopChipTone;
    /** Tooltip; the stop reason for `blocked` / `cancelled`. */
    readonly title: string;
    readonly phase: QaapAgentGoalLoopPhaseDTO;
}

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

/** Transcript header chip: "Executing 2/8", "Goal done", "Goal blocked", "Goal cancelled". */
export function resolveGoalLoopChipView(summary: QaapGoalLoopSummaryFields | undefined): QaapGoalLoopChipView | undefined {
    const phase = summary?.goalLoopPhase;
    if (!summary || !phase) {
        return undefined;
    }
    const reason = summary.goalLoopStopReason?.trim();
    if (phase === 'completed') {
        const doneLabel = nls.localize('theia/qaap/goalLoop/chipDone', 'Goal done');
        return { label: doneLabel, tone: 'ok', title: reason || doneLabel, phase };
    }
    if (phase === 'blocked') {
        const blockedLabel = nls.localize('theia/qaap/goalLoop/chipBlocked', 'Goal blocked');
        return { label: blockedLabel, tone: 'fail', title: reason || blockedLabel, phase };
    }
    if (phase === 'cancelled') {
        const cancelledLabel = nls.localize('theia/qaap/goalLoop/chipCancelled', 'Goal cancelled');
        return { label: cancelledLabel, tone: 'cancelled', title: reason || cancelledLabel, phase };
    }
    const { current, total } = progress(summary);
    const label = nls.localize('theia/qaap/goalLoop/chipRunning', '{0} {1}/{2}', phaseLabel(phase), current, total);
    return {
        label,
        tone: 'running',
        title: nls.localize('theia/qaap/goalLoop/chipRunningTitle', 'Until done: iteration {0} of {1}', current, total),
        phase,
    };
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

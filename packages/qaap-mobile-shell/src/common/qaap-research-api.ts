// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * REST contract for the auto-researcher v1 (no frontend yet — driven with curl). Kept separate
 * from {@link ./qaap-research-goal} and {@link ./qaap-research-ledger} (already tested, pure data
 * model) so this file can evolve with the endpoint shape without touching them.
 */

import type { ResearchGoal, ResearchMetricSpec } from './qaap-research-goal';
import type { ResearchExperimentRecord } from './qaap-research-ledger';

export const QAAP_RESEARCH_API_PATH = '/services/qaap-research/goals';

export interface QaapCreateResearchGoalBody {
    readonly cwd: string;
    readonly description: string;
    readonly agentId?: string;
    /** The long-running work (can take hours). Omit for goals that only measure. */
    readonly runCommand?: string;
    readonly runTimeoutMs?: number;
    readonly metrics: readonly ResearchMetricSpec[];
    readonly maxRounds?: number;
    readonly deadlineAt?: number;
    readonly stagnationRounds?: number;
    readonly infraFailureLimit?: number;
}

export interface QaapResearchGoalListResponse {
    readonly goals: readonly ResearchGoal[];
}

export interface QaapResearchGoalDetailResponse {
    readonly goal: ResearchGoal;
    /** The full experiment ledger for this goal, oldest round first. */
    readonly records: readonly ResearchExperimentRecord[];
}

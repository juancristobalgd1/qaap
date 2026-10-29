// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapCostSource } from './qaap-harness-capabilities';

/** One usage record for a turn, emitted by a harness usage parser. */
export interface QaapUsageEvent {
    readonly taskId: string;
    readonly turnId: string;
    readonly agentId: string;
    readonly model?: string;
    readonly provider?: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    /** Reasoning tokens that the harness reports separately from output. */
    readonly reasoningTokens?: number;
    readonly costUsd?: number;
    readonly costSource: QaapCostSource;
    /** `subscription`: the cost is a notional API-equivalent, not spend. */
    readonly billing: 'api' | 'subscription' | 'unknown';
    /** True when the harness reports running totals; the last value per turn wins instead of a sum. */
    readonly cumulative: boolean;
}

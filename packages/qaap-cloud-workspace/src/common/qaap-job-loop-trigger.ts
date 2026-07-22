// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** HTTP base path for durable job-loop trigger definitions. */
export const QAAP_JOB_LOOP_TRIGGER_API_PATH = '/qaap/api/job-loop-triggers';

export type QaapJobLoopTriggerType = 'interval' | 'cron' | 'webhook';
export type QaapJobLoopTriggerLastRunState = 'running' | 'completed' | 'failed';

export interface QaapJobLoopTrigger {
    readonly id: string;
    readonly ownerLogin: string;
    readonly templateId: string;
    readonly title: string;
    readonly type: QaapJobLoopTriggerType;
    readonly enabled: boolean;
    readonly intervalMinutes?: number;
    readonly cronExpression?: string;
    readonly timezone?: string;
    readonly oneShot?: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly lastRunAt?: number;
    readonly lastLoopId?: string;
    readonly lastRunState?: QaapJobLoopTriggerLastRunState;
}

export interface QaapCreateJobLoopTriggerBody {
    readonly templateId: string;
    readonly title: string;
    readonly type: QaapJobLoopTriggerType;
    readonly enabled?: boolean;
    readonly intervalMinutes?: number;
    readonly cronExpression?: string;
    readonly timezone?: string;
    readonly oneShot?: boolean;
}

export interface QaapUpdateJobLoopTriggerBody extends Partial<QaapCreateJobLoopTriggerBody> { }

export interface QaapCreateJobLoopTriggerResponse {
    readonly trigger: QaapJobLoopTrigger;
    /** Returned exactly once when a webhook trigger is created. */
    readonly webhookSecret?: string;
}

export function normalizeJobLoopTriggerInterval(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return 5;
    }
    return Math.max(5, Math.min(10_080, Math.floor(value!)));
}

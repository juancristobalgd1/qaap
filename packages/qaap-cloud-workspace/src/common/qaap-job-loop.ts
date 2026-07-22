// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapCreateJobGraphNode, QaapJob, QaapJobGraph } from './qaap-job';

/** HTTP base path for durable, bounded loops over job graphs. */
export const QAAP_JOB_LOOP_API_PATH = '/qaap/api/job-loops';

export const QAAP_JOB_LOOP_CONDITION_OPERATORS = [
    'equals',
    'not_equals',
    'greater_than',
    'greater_or_equal',
    'less_than',
    'less_or_equal',
    'truthy',
    'falsy',
] as const;

export type QaapJobLoopConditionOperator = typeof QAAP_JOB_LOOP_CONDITION_OPERATORS[number];
export type QaapJobLoopConditionSource = 'result' | 'job';

/** A deterministic predicate evaluated against one node after every successful graph round. */
export interface QaapJobLoopCondition {
    readonly nodeKey: string;
    readonly source?: QaapJobLoopConditionSource;
    /** RFC 6901 JSON Pointer. Empty selects the complete result or job. */
    readonly pointer?: string;
    readonly operator: QaapJobLoopConditionOperator;
    /** Required by comparison operators and omitted by truthy/falsy. */
    readonly expected?: unknown;
}

/** Copy one structured value from the previous round into a function job's existing input field. */
export interface QaapJobLoopInputBinding {
    readonly from: {
        readonly nodeKey: string;
        readonly source?: QaapJobLoopConditionSource;
        readonly pointer?: string;
    };
    /** Existing RFC 6901 target in `request.input`; empty replaces the complete input. */
    readonly targetPointer: string;
}

export interface QaapCreateJobLoopGraphNode extends QaapCreateJobGraphNode {
    /** Applied from round 2 onward. Only valid for function jobs. */
    readonly bindings?: readonly QaapJobLoopInputBinding[];
}

export interface QaapCreateJobLoopRequest {
    readonly title?: string;
    readonly graph: {
        readonly nodes: readonly QaapCreateJobLoopGraphNode[];
    };
    readonly until: QaapJobLoopCondition;
    readonly maxIterations?: number;
    readonly maxDurationMs?: number;
    /** Unique within one owner. An identical replay returns the existing loop. */
    readonly idempotencyKey?: string;
}

export type QaapJobLoopState =
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'budget_exhausted';

export type QaapJobLoopTerminationReason =
    | 'goal_reached'
    | 'max_iterations'
    | 'max_duration'
    | 'job_budget'
    | 'graph_failed'
    | 'graph_missing'
    | 'graph_creation_failed'
    | 'binding_missing'
    | 'cancelled';

export interface QaapJobLoopRound {
    /** One-based round number. */
    readonly iteration: number;
    readonly graphId: string;
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly conditionMatched?: boolean;
}

/** Durable public state of one bounded graph loop. */
export interface QaapJobLoop {
    readonly id: string;
    readonly title: string;
    readonly state: QaapJobLoopState;
    readonly ownerLogin?: string;
    readonly createdAt: number;
    readonly startedAt: number;
    readonly finishedAt?: number;
    /** Number of graph rounds that have been scheduled. */
    readonly iteration: number;
    readonly maxIterations: number;
    readonly maxDurationMs: number;
    readonly maxJobs: number;
    readonly jobsScheduled: number;
    readonly until: QaapJobLoopCondition;
    readonly rounds: readonly QaapJobLoopRound[];
    readonly currentGraphId?: string;
    readonly terminationReason?: QaapJobLoopTerminationReason;
    readonly idempotencyKey?: string;
}

export interface QaapCreateJobLoopResult {
    readonly loop: QaapJobLoop;
    readonly created: boolean;
}

export interface QaapJobLoopListResponse {
    readonly loops: readonly QaapJobLoop[];
}

export type QaapJobLoopEventType = 'created' | 'changed' | 'round_started' | 'round_finished';

/** Bounded durable event used for SSE reconnection without exposing graph inputs or logs. */
export interface QaapJobLoopEvent {
    readonly sequence: number;
    readonly type: QaapJobLoopEventType;
    readonly at: number;
    readonly loopId: string;
    readonly ownerLogin?: string;
    readonly state: QaapJobLoopState;
    readonly iteration: number;
    readonly currentGraphId?: string;
    readonly terminationReason?: QaapJobLoopTerminationReason;
}

export interface QaapJobLoopMetrics {
    readonly generatedAt: number;
    readonly total: number;
    readonly active: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly budgetExhausted: number;
    readonly roundsScheduled: number;
    readonly jobsScheduled: number;
}

export interface QaapJobLoopRoundDetail {
    readonly loopId: string;
    readonly round: QaapJobLoopRound;
    readonly graph?: QaapJobGraph;
    readonly jobs: Readonly<Record<string, QaapJob>>;
}

export interface QaapJobLoopStreamSnapshot {
    readonly sequence: number;
    readonly loops: readonly QaapJobLoop[];
    readonly metrics: QaapJobLoopMetrics;
}

export function isQaapJobLoopFinished(state: QaapJobLoopState): boolean {
    return state !== 'running';
}

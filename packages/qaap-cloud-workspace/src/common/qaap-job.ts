// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** HTTP base path for jobs that run independently from coding agents. */
export const QAAP_JOB_API_PATH = '/qaap/api/jobs';

export const QAAP_JOB_RESOURCE_CLASSES = [
    'cpu',
    'io',
    'network',
    'workspace',
    'deployment',
] as const;

/** Resource lane used by the scheduler to apply independent concurrency budgets. */
export type QaapJobResourceClass = typeof QAAP_JOB_RESOURCE_CLASSES[number];

/** Read jobs may share a workspace; write jobs hold an exclusive workspace lease. */
export type QaapJobWorkspaceAccess = 'read' | 'write';

export type QaapJobKind = 'command' | 'function';

/** Bounded retry loop. `maxAttempts` includes the first execution. */
export interface QaapJobRetryPolicy {
    readonly maxAttempts: number;
    readonly initialBackoffMs?: number;
    readonly multiplier?: number;
    readonly maxBackoffMs?: number;
}

export type QaapJobState =
    /** One or more dependency jobs have not succeeded yet. */
    | 'waiting'
    /** Dependencies are satisfied, but a scheduler quota or workspace lease is busy. */
    | 'queued'
    /** The isolated child process is active. */
    | 'running'
    /** A failed attempt is waiting for its durable backoff deadline. */
    | 'retry_wait'
    /** The command exited with code zero. */
    | 'succeeded'
    /** The command failed to start or exited non-zero. */
    | 'failed'
    /** Cancelled explicitly by its owner. */
    | 'cancelled'
    /** Stopped after its configured execution deadline. */
    | 'timed_out'
    /** The backend restarted while the process was active. */
    | 'interrupted'
    /** At least one dependency ended without succeeding. */
    | 'dependency_failed';

/** Durable description and current state of a generic Qaap job. */
export interface QaapJob {
    readonly id: string;
    readonly kind: QaapJobKind;
    readonly title: string;
    readonly command?: string;
    readonly functionId?: string;
    readonly input?: unknown;
    readonly cwd: string;
    readonly resourceClass: QaapJobResourceClass;
    readonly workspaceAccess: QaapJobWorkspaceAccess;
    readonly state: QaapJobState;
    readonly dependsOn: readonly string[];
    readonly timeoutMs: number;
    readonly retryPolicy?: QaapJobRetryPolicy;
    /** Number of attempts that have started. */
    readonly attempt: number;
    readonly nextAttemptAt?: number;
    readonly createdAt: number;
    readonly startedAt?: number;
    readonly finishedAt?: number;
    readonly exitCode?: number;
    readonly ownerLogin?: string;
    readonly idempotencyKey?: string;
}

/** A job plus its bounded stdout/stderr transcript. */
export interface QaapJobDetail extends QaapJob {
    readonly log: string;
    readonly result?: unknown;
}

export interface QaapCreateJobBaseRequest {
    readonly title?: string;
    readonly cwd: string;
    readonly resourceClass?: QaapJobResourceClass;
    readonly workspaceAccess?: QaapJobWorkspaceAccess;
    readonly dependsOn?: readonly string[];
    readonly timeoutMs?: number;
    readonly retryPolicy?: QaapJobRetryPolicy;
    /** Unique within one owner. Reusing it with the same request returns the original job. */
    readonly idempotencyKey?: string;
}

export interface QaapCreateCommandJobRequest extends QaapCreateJobBaseRequest {
    readonly kind?: 'command';
    readonly command: string;
}

export interface QaapCreateFunctionJobRequest extends QaapCreateJobBaseRequest {
    readonly kind: 'function';
    readonly functionId: string;
    readonly input?: unknown;
}

export type QaapCreateJobRequest = QaapCreateCommandJobRequest | QaapCreateFunctionJobRequest;

export interface QaapCreateJobResult {
    readonly job: QaapJob;
    /** False when an idempotent replay returned an existing job. */
    readonly created: boolean;
}

export interface QaapJobListResponse {
    readonly jobs: readonly QaapJob[];
}

/** Public metadata for a backend function registered with the job runtime. */
export interface QaapJobFunctionDescriptor {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly resourceClass: QaapJobResourceClass;
    readonly workspaceAccess: QaapJobWorkspaceAccess;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export interface QaapJobFunctionListResponse {
    readonly functions: readonly QaapJobFunctionDescriptor[];
}

export interface QaapCreateJobGraphNode {
    /** Unique local name used by other nodes in `dependsOn`. */
    readonly key: string;
    readonly request: QaapCreateJobRequest;
    /** Local node keys, not persisted job ids. */
    readonly dependsOn?: readonly string[];
}

export interface QaapCreateJobGraphRequest {
    readonly nodes: readonly QaapCreateJobGraphNode[];
    readonly idempotencyKey?: string;
}

export interface QaapJobGraph {
    readonly id: string;
    readonly createdAt: number;
    readonly ownerLogin?: string;
    readonly idempotencyKey?: string;
    readonly jobsByKey: Readonly<Record<string, string>>;
}

export interface QaapCreateJobGraphResult {
    readonly graph: QaapJobGraph;
    readonly jobs: Readonly<Record<string, QaapJob>>;
    readonly created: boolean;
}

export interface QaapJobGraphDetail {
    readonly graph: QaapJobGraph;
    readonly jobs: Readonly<Record<string, QaapJob>>;
}

export interface QaapJobGraphListResponse {
    readonly graphs: readonly QaapJobGraph[];
}

export type QaapJobEvent =
    | { readonly type: 'created' | 'changed'; readonly job: QaapJob }
    | { readonly type: 'output'; readonly job: QaapJob; readonly chunk: string };

export function isQaapJobResourceClass(value: unknown): value is QaapJobResourceClass {
    return typeof value === 'string' && (QAAP_JOB_RESOURCE_CLASSES as readonly string[]).includes(value);
}

export function isQaapJobFinished(state: QaapJobState): boolean {
    return state !== 'waiting' && state !== 'queued' && state !== 'running' && state !== 'retry_wait';
}

export function didQaapJobSucceed(state: QaapJobState): boolean {
    return state === 'succeeded';
}

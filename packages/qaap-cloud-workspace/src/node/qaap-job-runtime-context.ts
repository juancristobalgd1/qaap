// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `QaapJobRuntime` and the `*Extracted` free functions in the
// `qaap-job-runtime-{render2,streaming2,timeline2}.ts` cluster. Each extracted function receives
// `this` (the runtime) typed as `QaapJobRuntimeContext` instead of `any`. Only members actually
// referenced through `ctx.` across that cluster are listed here — see `qaap-job-runtime.ts`, which
// `implements` this interface, for the real implementation of each member.
//
// `import type` throughout to avoid a runtime import cycle with the extracted modules.

import type { Emitter } from '@theia/core';
import type { ChildProcess } from 'child_process';
import type {
    QaapJob,
    QaapJobEvent,
    QaapJobGraph,
    QaapJobResourceClass,
    QaapJobRetryPolicy,
    QaapJobState,
    QaapJobWorkspaceAccess,
    QaapCreateJobRequest,
} from '../common/qaap-job';
import type { QaapJobFunctionRegistry } from './qaap-job-function-registry';
import type { QaapTenantSpawnService } from './qaap-tenant-spawn-service';

/** A validated {@link QaapCreateJobRequest}, as stored next to its job. */
export interface NormalizedJobRequest {
    readonly kind: 'command' | 'function';
    readonly title: string;
    readonly command?: string;
    readonly functionId?: string;
    readonly input?: unknown;
    readonly cwd: string;
    readonly resourceClass: QaapJobResourceClass;
    readonly workspaceAccess: QaapJobWorkspaceAccess;
    readonly dependsOn: readonly string[];
    readonly timeoutMs: number;
    readonly retryPolicy?: Required<QaapJobRetryPolicy>;
    readonly idempotencyKey?: string;
}

/** On-disk job index (current version). */
export interface PersistedJobIndex {
    readonly version: 2;
    readonly jobs: readonly QaapJob[];
    readonly requests: Readonly<Record<string, NormalizedJobRequest>>;
    readonly logs: Readonly<Record<string, string>>;
    readonly results: Readonly<Record<string, unknown>>;
    readonly graphs: readonly PersistedJobGraph[];
}

/** On-disk job index written before graphs and function results existed. */
export interface LegacyPersistedJobIndex extends Omit<PersistedJobIndex, 'version' | 'results' | 'graphs'> {
    readonly version: 1;
}

/** A graph plus the fingerprint used to detect idempotency-key reuse for a different graph. */
export interface PersistedJobGraph {
    readonly graph: QaapJobGraph;
    readonly fingerprint: string;
}

/** Terminal job states accepted by {@link QaapJobRuntimeContext.finishJob}. */
export type QaapJobTerminalState = Exclude<QaapJobState, 'waiting' | 'queued' | 'running' | 'retry_wait'>;

/**
 * Members of {@link QaapJobRuntime} that the `*Extracted` helper functions access via `ctx.`.
 */
export interface QaapJobRuntimeContext {

    // ─── Injected services ──────────────────────────────────────────────────
    readonly tenantSpawn: QaapTenantSpawnService;
    readonly functionRegistry: QaapJobFunctionRegistry;

    // ─── State ──────────────────────────────────────────────────────────────
    readonly jobs: Map<string, QaapJob>;
    readonly requests: Map<string, NormalizedJobRequest>;
    readonly logs: Map<string, string>;
    readonly results: Map<string, unknown>;
    readonly processes: Map<string, ChildProcess>;
    readonly abortControllers: Map<string, AbortController>;
    readonly timeoutTimers: Map<string, NodeJS.Timeout>;
    readonly terminationTimers: Map<string, NodeJS.Timeout>;
    readonly retryTimers: Map<string, NodeJS.Timeout>;
    readonly idempotencyIndex: Map<string, string>;
    readonly graphs: Map<string, PersistedJobGraph>;
    readonly graphIdempotencyIndex: Map<string, string>;
    readonly onDidChangeJobEmitter: Emitter<QaapJobEvent>;
    persistChain: Promise<void>;
    draining: boolean;
    stopping: boolean;
    pruneStartTimer: NodeJS.Timeout | undefined;
    pruneIntervalTimer: NodeJS.Timeout | undefined;

    // ─── Requests / graph construction ──────────────────────────────────────
    normalizeOwner(ownerLogin: string | undefined): string | undefined;
    normalizeRequest(request: QaapCreateJobRequest): NormalizedJobRequest;
    assertDependencies(dependencyIds: readonly string[], ownerLogin?: string): void;
    buildJob(id: string, request: NormalizedJobRequest, ownerLogin: string | undefined, createdAt: number): QaapJob;
    insertJob(job: QaapJob, request: NormalizedJobRequest): void;
    assertAcyclicGraph(dependenciesByKey: ReadonlyMap<string, readonly string[]>): void;
    jobsForGraph(graph: QaapJobGraph): Record<string, QaapJob>;
    requestFingerprint(request: NormalizedJobRequest): string;
    normalizeIdempotencyKey(value: string | undefined): string | undefined;
    normalizeRetryPolicy(value: QaapJobRetryPolicy | undefined): Required<QaapJobRetryPolicy> | undefined;
    assertJsonSize(value: unknown, maxChars: number, label: string): void;
    stableJson(value: unknown): string;
    ownerIdempotencyKey(ownerLogin: string | undefined, key: string): string;
    isDirectory(candidate: string): boolean;

    // ─── Scheduling / execution ─────────────────────────────────────────────
    drainQueue(): void;
    canStart(candidate: QaapJob): boolean;
    hasEarlierQueuedWriter(candidate: QaapJob): boolean;
    runJob(job: QaapJob): void;
    runCommandJob(job: QaapJob): void;
    runFunctionJob(job: QaapJob): void;
    startAttemptTimeout(job: QaapJob, onTimeout: () => void): void;
    handleProcessClose(id: string, child: ChildProcess, code: number | null): void;
    handleAttemptFailure(id: string, finalState: 'failed' | 'timed_out', exitCode?: number): void;
    scheduleRetryWake(job: QaapJob): void;
    appendOutput(id: string, chunk: string): void;
    clearActiveAttempt(id: string): void;
    finishJob(id: string, state: QaapJobTerminalState, exitCode?: number): QaapJob | undefined;
    replaceJob(id: string, patch: Partial<QaapJob>): QaapJob;
    terminateProcessTree(id: string, child: ChildProcess): void;
    reapProcessGroupAfterExit(child: ChildProcess): void;
    buildChildEnv(job: QaapJob): NodeJS.ProcessEnv;
    resolveFunctionWorkspacePath(cwd: string, relativePath: string): Promise<string>;

    // ─── Persistence / retention / limits ───────────────────────────────────
    restorePersistedIndex(stored: unknown): void;
    persist(): Promise<void>;
    storeDirectory(): string;
    indexPath(): string;
    maxConcurrentJobs(): number;
    maxConcurrentJobsPerUser(): number;
    resourceLimit(resourceClass: QaapJobResourceClass): number;
    maxTimeoutMs(): number;
    maxLogChars(): number;
    retentionDays(): number;
    maxJobsPerUser(): number;
    pruneIntervalMs(): number;
    pruneRetainedJobs(nowMs?: number): { prunedJobs: number; prunedGraphs: number };
    scheduleRetentionPrune(): void;
    clearRetentionPruneTimers(): void;
    jobAgeMs(job: QaapJob): number;
    collectProtectedJobIds(): Set<string>;
    removeJobRecord(id: string): void;
    removeGraphRecord(id: string): void;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import {
    QaapCreateJobGraphRequest,
    QaapCreateJobGraphResult,
    QaapCreateJobRequest,
    QaapCreateJobResult,
    QaapJob,
    QaapJobDetail,
    QaapJobEvent,
    QaapJobFunctionDescriptor,
    QaapJobGraph,
    QaapJobResourceClass,
    QaapJobRetryPolicy,
} from '../common/qaap-job';
import { QaapJobFunctionRegistry } from './qaap-job-function-registry';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import type { NormalizedJobRequest, PersistedJobGraph, QaapJobRuntimeContext, QaapJobTerminalState } from './qaap-job-runtime-context';
import { assertDependenciesExtracted, buildJobExtracted, cancelExtracted, createExtracted, createGraphExtracted, initExtracted, insertJobExtracted, listExtracted, listGraphsExtracted, normalizeRequestExtracted, pruneRetainedJobsExtracted, shutdownExtracted } from './qaap-job-runtime-render2';
import { appendOutputExtracted, assertAcyclicGraphExtracted, canStartExtracted, clearActiveAttemptExtracted, drainQueueExtracted, finishJobExtracted, handleAttemptFailureExtracted, handleProcessCloseExtracted, hasEarlierQueuedWriterExtracted, jobsForGraphExtracted, reapProcessGroupAfterExitExtracted, replaceJobExtracted, runCommandJobExtracted, runFunctionJobExtracted, runJobExtracted, scheduleRetryWakeExtracted, startAttemptTimeoutExtracted, terminateProcessTreeExtracted } from './qaap-job-runtime-streaming2';
import { assertJsonSizeExtracted, buildChildEnvExtracted, clearRetentionPruneTimersExtracted, collectProtectedJobIdsExtracted, envIntOrExtracted, isDirectoryExtracted, normalizeIdempotencyKeyExtracted, normalizeRetryPolicyExtracted, persistExtracted, removeGraphRecordExtracted, removeJobRecordExtracted, resolveFunctionWorkspacePathExtracted, restorePersistedIndexExtracted, scheduleRetentionPruneExtracted, stableJsonExtracted } from './qaap-job-runtime-timeline2';

export const STORE_MODE = 0o700;
export const INDEX_MODE = 0o600;
export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MAX_LOG_CHARS = 512 * 1024;
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_MAX_CONCURRENT_PER_USER = 4;
const DEFAULT_JOB_RETENTION_DAYS = 30;
const DEFAULT_JOB_MAX_PER_USER = 500;
const DEFAULT_JOB_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const JOB_PRUNE_START_DELAY_MS = 5 * 60 * 1000;
export const MAX_FUNCTION_INPUT_CHARS = 64 * 1024;
export const MAX_FUNCTION_RESULT_CHARS = 256 * 1024;
export const MAX_GRAPH_NODES = 128;
export const MAX_RETRY_ATTEMPTS = 10;
const DEFAULT_RESOURCE_LIMITS: Readonly<Record<QaapJobResourceClass, number>> = {
    cpu: 2,
    io: 8,
    network: 4,
    workspace: 4,
    deployment: 1,
};
const RESOURCE_LIMIT_ENV: Readonly<Record<QaapJobResourceClass, string>> = {
    cpu: 'QAAP_JOB_LIMIT_CPU',
    io: 'QAAP_JOB_LIMIT_IO',
    network: 'QAAP_JOB_LIMIT_NETWORK',
    workspace: 'QAAP_JOB_LIMIT_WORKSPACE',
    deployment: 'QAAP_JOB_LIMIT_DEPLOYMENT',
};

export class QaapJobRequestError extends Error { }
export class QaapJobConflictError extends Error { }

/**
 * Durable, agent-independent command scheduler.
 *
 * Jobs form a directed acyclic graph by referring only to jobs that already exist. The runtime
 * combines graph readiness with global, per-owner and per-resource quotas, plus a per-workspace
 * reader/writer lease. Child processes always use QaapTenantSpawnService, so generic work receives
 * the same fail-closed uid isolation as agents, terminals, previews and deploys.
 */
@injectable()
export class QaapJobRuntime implements QaapJobRuntimeContext {

    @inject(QaapTenantSpawnService)
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly tenantSpawn: QaapTenantSpawnService;

    @inject(QaapJobFunctionRegistry)
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly functionRegistry: QaapJobFunctionRegistry;

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly jobs = new Map<string, QaapJob>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly requests = new Map<string, NormalizedJobRequest>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly logs = new Map<string, string>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly results = new Map<string, unknown>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly processes = new Map<string, ChildProcess>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly abortControllers = new Map<string, AbortController>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly timeoutTimers = new Map<string, NodeJS.Timeout>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly terminationTimers = new Map<string, NodeJS.Timeout>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly retryTimers = new Map<string, NodeJS.Timeout>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly idempotencyIndex = new Map<string, string>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly graphs = new Map<string, PersistedJobGraph>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly graphIdempotencyIndex = new Map<string, string>();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public persistChain: Promise<void> = Promise.resolve();
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public draining = false;
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public stopping = false;
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public pruneStartTimer: NodeJS.Timeout | undefined;
    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public pruneIntervalTimer: NodeJS.Timeout | undefined;

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public readonly onDidChangeJobEmitter = new Emitter<QaapJobEvent>();
    readonly onDidChangeJob: Event<QaapJobEvent> = this.onDidChangeJobEmitter.event;

    @postConstruct()
    protected init(): void {
        initExtracted(this);
    }

    create(request: QaapCreateJobRequest, ownerLogin?: string): QaapCreateJobResult {
        return createExtracted(this, request, ownerLogin);
    }

    createGraph(request: QaapCreateJobGraphRequest, ownerLogin?: string): QaapCreateJobGraphResult {
        return createGraphExtracted(this, request, ownerLogin);
    }

    listFunctions(): QaapJobFunctionDescriptor[] {
        return this.functionRegistry.list();
    }

    listGraphs(ownerLogin?: string): QaapJobGraph[] {
        return listGraphsExtracted(this, ownerLogin);
    }

    /** Return a graph only when it belongs to the requested owner; omitted owner is backend-internal. */
    getGraph(id: string, ownerLogin?: string): { graph: QaapJobGraph; jobs: Readonly<Record<string, QaapJob>> } | undefined {
        const persisted = this.graphs.get(id);
        if (persisted && ownerLogin !== undefined && persisted.graph.ownerLogin !== this.normalizeOwner(ownerLogin)) {
            return undefined;
        }
        return persisted ? { graph: persisted.graph, jobs: this.jobsForGraph(persisted.graph) } : undefined;
    }

    list(ownerLogin?: string): QaapJob[] {
        return listExtracted(this, ownerLogin);
    }

    /** Return a job and its log only when it belongs to the requested owner; omitted owner is internal. */
    get(id: string, ownerLogin?: string): QaapJobDetail | undefined {
        const job = this.jobs.get(id);
        if (job && ownerLogin !== undefined && job.ownerLogin !== this.normalizeOwner(ownerLogin)) {
            return undefined;
        }
        return job ? { ...job, log: this.logs.get(id) ?? '', result: this.results.get(id) } : undefined;
    }

    cancel(id: string, ownerLogin?: string): QaapJob | undefined {
        return cancelExtracted(this, id, ownerLogin);
    }

    async shutdown(): Promise<void> {
        return shutdownExtracted(this);
    }

    pruneRetainedJobs(nowMs = Date.now()): { prunedJobs: number; prunedGraphs: number } {
        return pruneRetainedJobsExtracted(this, nowMs);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public normalizeRequest(request: QaapCreateJobRequest): NormalizedJobRequest {
        return normalizeRequestExtracted(this, request);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public assertDependencies(dependencyIds: readonly string[], ownerLogin?: string): void {
        assertDependenciesExtracted(this, dependencyIds, ownerLogin);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public buildJob(id: string, request: NormalizedJobRequest, ownerLogin: string | undefined, createdAt: number): QaapJob {
        return buildJobExtracted(this, id, request, ownerLogin, createdAt);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public insertJob(job: QaapJob, request: NormalizedJobRequest): void {
        insertJobExtracted(this, job, request);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public assertAcyclicGraph(dependenciesByKey: ReadonlyMap<string, readonly string[]>): void {
        assertAcyclicGraphExtracted(this, dependenciesByKey);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public jobsForGraph(graph: QaapJobGraph): Record<string, QaapJob> {
        return jobsForGraphExtracted(this, graph);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public drainQueue(): void {
        drainQueueExtracted(this);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public canStart(candidate: QaapJob): boolean {
        return canStartExtracted(this, candidate);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public hasEarlierQueuedWriter(candidate: QaapJob): boolean {
        return hasEarlierQueuedWriterExtracted(this, candidate);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public runJob(job: QaapJob): void {
        runJobExtracted(this, job);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public runCommandJob(job: QaapJob): void {
        runCommandJobExtracted(this, job);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public runFunctionJob(job: QaapJob): void {
        runFunctionJobExtracted(this, job);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public startAttemptTimeout(job: QaapJob, onTimeout: () => void): void {
        startAttemptTimeoutExtracted(this, job, onTimeout);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public handleProcessClose(id: string, child: ChildProcess, code: number | null): void {
        handleProcessCloseExtracted(this, id, child, code);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public handleAttemptFailure(id: string, finalState: 'failed' | 'timed_out', exitCode?: number): void {
        handleAttemptFailureExtracted(this, id, finalState, exitCode);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public scheduleRetryWake(job: QaapJob): void {
        scheduleRetryWakeExtracted(this, job);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public appendOutput(id: string, chunk: string): void {
        appendOutputExtracted(this, id, chunk);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public clearActiveAttempt(id: string): void {
        clearActiveAttemptExtracted(this, id);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public finishJob(id: string, state: QaapJobTerminalState, exitCode?: number,): QaapJob | undefined {
        return finishJobExtracted(this, id, state, exitCode);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public replaceJob(id: string, patch: Partial<QaapJob>): QaapJob {
        return replaceJobExtracted(this, id, patch);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public terminateProcessTree(id: string, child: ChildProcess): void {
        terminateProcessTreeExtracted(this, id, child);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public reapProcessGroupAfterExit(child: ChildProcess): void {
        reapProcessGroupAfterExitExtracted(this, child);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public buildChildEnv(job: QaapJob): NodeJS.ProcessEnv {
        return buildChildEnvExtracted(this, job);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public async resolveFunctionWorkspacePath(cwd: string, relativePath: string): Promise<string> {
        return resolveFunctionWorkspacePathExtracted(this, cwd, relativePath);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public restorePersistedIndex(stored: unknown): void {
        restorePersistedIndexExtracted(this, stored);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public persist(): Promise<void> {
        return persistExtracted(this);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public requestFingerprint(request: NormalizedJobRequest): string {
        return this.stableJson({ ...request, dependsOn: [...request.dependsOn].sort() });
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public normalizeIdempotencyKey(value: string | undefined): string | undefined {
        return normalizeIdempotencyKeyExtracted(this, value);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public normalizeRetryPolicy(value: QaapJobRetryPolicy | undefined): Required<QaapJobRetryPolicy> | undefined {
        return normalizeRetryPolicyExtracted(this, value);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public assertJsonSize(value: unknown, maxChars: number, label: string): void {
        assertJsonSizeExtracted(this, value, maxChars, label);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public stableJson(value: unknown): string {
        return stableJsonExtracted(this, value);
    }

    /**
     * Canonical owner key, matching how `create`/`list` store and filter owners. `get`, `getGraph`
     * and `cancel` called this before it existed, so any owner-scoped lookup of an existing job threw.
     * @internal Used by the extracted qaap-job-runtime-* modules.
     */
    public normalizeOwner(ownerLogin: string | undefined): string | undefined {
        return ownerLogin?.trim() || undefined;
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public ownerIdempotencyKey(ownerLogin: string | undefined, key: string): string {
        return `${ownerLogin ?? ''}\0${key}`;
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public isDirectory(candidate: string): boolean {
        return isDirectoryExtracted(this, candidate);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public storeDirectory(): string {
        return path.join(os.homedir(), '.qaap', 'jobs');
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public indexPath(): string {
        return path.join(this.storeDirectory(), 'index.json');
    }

    protected positiveEnv(name: string, fallback: number): number {
        const parsed = Number.parseInt(process.env[name]?.trim() ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public maxConcurrentJobs(): number {
        return this.positiveEnv('QAAP_JOB_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public maxConcurrentJobsPerUser(): number {
        return this.positiveEnv('QAAP_JOB_MAX_CONCURRENT_PER_USER', DEFAULT_MAX_CONCURRENT_PER_USER);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public resourceLimit(resourceClass: QaapJobResourceClass): number {
        return this.positiveEnv(RESOURCE_LIMIT_ENV[resourceClass], DEFAULT_RESOURCE_LIMITS[resourceClass]);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public maxTimeoutMs(): number {
        return this.positiveEnv('QAAP_JOB_MAX_TIMEOUT_MS', DEFAULT_MAX_TIMEOUT_MS);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public maxLogChars(): number {
        return this.positiveEnv('QAAP_JOB_MAX_LOG_CHARS', DEFAULT_MAX_LOG_CHARS);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public retentionDays(): number {
        return this.envIntOr('QAAP_JOB_RETENTION_DAYS', DEFAULT_JOB_RETENTION_DAYS);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public maxJobsPerUser(): number {
        return this.envIntOr('QAAP_JOB_MAX_PER_USER', DEFAULT_JOB_MAX_PER_USER);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public pruneIntervalMs(): number {
        return this.positiveEnv('QAAP_JOB_PRUNE_INTERVAL_MS', DEFAULT_JOB_PRUNE_INTERVAL_MS);
    }

    protected envIntOr(name: string, fallback: number): number {
        return envIntOrExtracted(this, name, fallback);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public scheduleRetentionPrune(): void {
        scheduleRetentionPruneExtracted(this);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public clearRetentionPruneTimers(): void {
        clearRetentionPruneTimersExtracted(this);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public jobAgeMs(job: QaapJob): number {
        return job.finishedAt ?? job.createdAt;
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public collectProtectedJobIds(): Set<string> {
        return collectProtectedJobIdsExtracted(this);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public removeJobRecord(id: string): void {
        removeJobRecordExtracted(this, id);
    }

    /** @internal Used by the extracted qaap-job-runtime-* modules. */
    public removeGraphRecord(id: string): void {
        removeGraphRecordExtracted(this, id);
    }
}

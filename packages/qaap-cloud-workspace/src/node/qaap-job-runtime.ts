// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { Emitter, Event, nls } from '@theia/core';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    didQaapJobSucceed,
    isQaapJobFinished,
    isQaapJobResourceClass,
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
    QaapJobState,
    QaapJobWorkspaceAccess,
} from '../common/qaap-job';
import { QaapJobFunctionRegistry } from './qaap-job-function-registry';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { writeJsonAtomic } from './qaap-write-json-atomic';
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

interface NormalizedJobRequest {
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

interface PersistedJobIndex {
    readonly version: 2;
    readonly jobs: readonly QaapJob[];
    readonly requests: Readonly<Record<string, NormalizedJobRequest>>;
    readonly logs: Readonly<Record<string, string>>;
    readonly results: Readonly<Record<string, unknown>>;
    readonly graphs: readonly PersistedJobGraph[];
}

interface LegacyPersistedJobIndex extends Omit<PersistedJobIndex, 'version' | 'results' | 'graphs'> {
    readonly version: 1;
}

interface PersistedJobGraph {
    readonly graph: QaapJobGraph;
    readonly fingerprint: string;
}

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
export class QaapJobRuntime {

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    @inject(QaapJobFunctionRegistry)
    protected readonly functionRegistry: QaapJobFunctionRegistry;

    protected readonly jobs = new Map<string, QaapJob>();
    protected readonly requests = new Map<string, NormalizedJobRequest>();
    protected readonly logs = new Map<string, string>();
    protected readonly results = new Map<string, unknown>();
    protected readonly processes = new Map<string, ChildProcess>();
    protected readonly abortControllers = new Map<string, AbortController>();
    protected readonly timeoutTimers = new Map<string, NodeJS.Timeout>();
    protected readonly terminationTimers = new Map<string, NodeJS.Timeout>();
    protected readonly retryTimers = new Map<string, NodeJS.Timeout>();
    protected readonly idempotencyIndex = new Map<string, string>();
    protected readonly graphs = new Map<string, PersistedJobGraph>();
    protected readonly graphIdempotencyIndex = new Map<string, string>();
    protected persistChain: Promise<void> = Promise.resolve();
    protected draining = false;
    protected stopping = false;
    protected pruneStartTimer: NodeJS.Timeout | undefined;
    protected pruneIntervalTimer: NodeJS.Timeout | undefined;

    protected readonly onDidChangeJobEmitter = new Emitter<QaapJobEvent>();
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

    getGraph(id: string): { graph: QaapJobGraph; jobs: Readonly<Record<string, QaapJob>> } | undefined {
        const persisted = this.graphs.get(id);
        return persisted ? { graph: persisted.graph, jobs: this.jobsForGraph(persisted.graph) } : undefined;
    }

    list(ownerLogin?: string): QaapJob[] {
        return listExtracted(this, ownerLogin);
    }

    get(id: string): QaapJobDetail | undefined {
        const job = this.jobs.get(id);
        return job ? { ...job, log: this.logs.get(id) ?? '', result: this.results.get(id) } : undefined;
    }

    cancel(id: string): QaapJob | undefined {
        return cancelExtracted(this, id);
    }

    async shutdown(): Promise<void> {
        return shutdownExtracted(this);
    }

    pruneRetainedJobs(nowMs = Date.now()): { prunedJobs: number; prunedGraphs: number } {
        return pruneRetainedJobsExtracted(this, nowMs = Date.now());
    }

    protected normalizeRequest(request: QaapCreateJobRequest): NormalizedJobRequest {
        return normalizeRequestExtracted(this, request);
    }

    protected assertDependencies(dependencyIds: readonly string[], ownerLogin?: string): void {
        assertDependenciesExtracted(this, dependencyIds, ownerLogin);
    }

    protected buildJob(id: string, request: NormalizedJobRequest, ownerLogin: string | undefined, createdAt: number): QaapJob {
        return buildJobExtracted(this, id, request, ownerLogin, createdAt);
    }

    protected insertJob(job: QaapJob, request: NormalizedJobRequest): void {
        insertJobExtracted(this, job, request);
    }

    protected assertAcyclicGraph(dependenciesByKey: ReadonlyMap<string, readonly string[]>): void {
        assertAcyclicGraphExtracted(this, dependenciesByKey);
    }

    protected jobsForGraph(graph: QaapJobGraph): Record<string, QaapJob> {
        return jobsForGraphExtracted(this, graph);
    }

    protected drainQueue(): void {
        drainQueueExtracted(this);
    }

    protected canStart(candidate: QaapJob): boolean {
        return canStartExtracted(this, candidate);
    }

    protected hasEarlierQueuedWriter(candidate: QaapJob): boolean {
        return hasEarlierQueuedWriterExtracted(this, candidate);
    }

    protected runJob(job: QaapJob): void {
        runJobExtracted(this, job);
    }

    protected runCommandJob(job: QaapJob): void {
        runCommandJobExtracted(this, job);
    }

    protected runFunctionJob(job: QaapJob): void {
        runFunctionJobExtracted(this, job);
    }

    protected startAttemptTimeout(job: QaapJob, onTimeout: () => void): void {
        startAttemptTimeoutExtracted(this, job, onTimeout);
    }

    protected handleProcessClose(id: string, child: ChildProcess, code: number | null): void {
        handleProcessCloseExtracted(this, id, child, code);
    }

    protected handleAttemptFailure(id: string, finalState: 'failed' | 'timed_out', exitCode?: number): void {
        handleAttemptFailureExtracted(this, id, finalState, exitCode);
    }

    protected scheduleRetryWake(job: QaapJob): void {
        scheduleRetryWakeExtracted(this, job);
    }

    protected appendOutput(id: string, chunk: string): void {
        appendOutputExtracted(this, id, chunk);
    }

    protected clearActiveAttempt(id: string): void {
        clearActiveAttemptExtracted(this, id);
    }

    protected finishJob(id: string, state: Exclude<QaapJobState, 'waiting' | 'queued' | 'running' | 'retry_wait'>, exitCode?: number,): QaapJob | undefined {
        return finishJobExtracted(this, id, state, exitCode);
    }

    protected replaceJob(id: string, patch: Partial<QaapJob>): QaapJob {
        return replaceJobExtracted(this, id, patch);
    }

    protected terminateProcessTree(id: string, child: ChildProcess): void {
        terminateProcessTreeExtracted(this, id, child);
    }

    protected reapProcessGroupAfterExit(child: ChildProcess): void {
        reapProcessGroupAfterExitExtracted(this, child);
    }

    protected buildChildEnv(job: QaapJob): NodeJS.ProcessEnv {
        return buildChildEnvExtracted(this, job);
    }

    protected async resolveFunctionWorkspacePath(cwd: string, relativePath: string): Promise<string> {
        return resolveFunctionWorkspacePathExtracted(this, cwd, relativePath);
    }

    protected restorePersistedIndex(stored: unknown): void {
        restorePersistedIndexExtracted(this, stored);
    }

    protected persist(): Promise<void> {
        return persistExtracted(this);
    }

    protected requestFingerprint(request: NormalizedJobRequest): string {
        return this.stableJson({ ...request, dependsOn: [...request.dependsOn].sort() });
    }

    protected normalizeIdempotencyKey(value: string | undefined): string | undefined {
        return normalizeIdempotencyKeyExtracted(this, value);
    }

    protected normalizeRetryPolicy(value: QaapJobRetryPolicy | undefined): Required<QaapJobRetryPolicy> | undefined {
        return normalizeRetryPolicyExtracted(this, value);
    }

    protected assertJsonSize(value: unknown, maxChars: number, label: string): void {
        assertJsonSizeExtracted(this, value, maxChars, label);
    }

    protected stableJson(value: unknown): string {
        return stableJsonExtracted(this, value);
    }

    protected ownerIdempotencyKey(ownerLogin: string | undefined, key: string): string {
        return `${ownerLogin ?? ''}\0${key}`;
    }

    protected isDirectory(candidate: string): boolean {
        return isDirectoryExtracted(this, candidate);
    }

    protected storeDirectory(): string {
        return path.join(os.homedir(), '.qaap', 'jobs');
    }

    protected indexPath(): string {
        return path.join(this.storeDirectory(), 'index.json');
    }

    protected positiveEnv(name: string, fallback: number): number {
        const parsed = Number.parseInt(process.env[name]?.trim() ?? '', 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    protected maxConcurrentJobs(): number {
        return this.positiveEnv('QAAP_JOB_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT);
    }

    protected maxConcurrentJobsPerUser(): number {
        return this.positiveEnv('QAAP_JOB_MAX_CONCURRENT_PER_USER', DEFAULT_MAX_CONCURRENT_PER_USER);
    }

    protected resourceLimit(resourceClass: QaapJobResourceClass): number {
        return this.positiveEnv(RESOURCE_LIMIT_ENV[resourceClass], DEFAULT_RESOURCE_LIMITS[resourceClass]);
    }

    protected maxTimeoutMs(): number {
        return this.positiveEnv('QAAP_JOB_MAX_TIMEOUT_MS', DEFAULT_MAX_TIMEOUT_MS);
    }

    protected maxLogChars(): number {
        return this.positiveEnv('QAAP_JOB_MAX_LOG_CHARS', DEFAULT_MAX_LOG_CHARS);
    }

    protected retentionDays(): number {
        return this.envIntOr('QAAP_JOB_RETENTION_DAYS', DEFAULT_JOB_RETENTION_DAYS);
    }

    protected maxJobsPerUser(): number {
        return this.envIntOr('QAAP_JOB_MAX_PER_USER', DEFAULT_JOB_MAX_PER_USER);
    }

    protected pruneIntervalMs(): number {
        return this.positiveEnv('QAAP_JOB_PRUNE_INTERVAL_MS', DEFAULT_JOB_PRUNE_INTERVAL_MS);
    }

    protected envIntOr(name: string, fallback: number): number {
        return envIntOrExtracted(this, name, fallback);
    }

    protected scheduleRetentionPrune(): void {
        scheduleRetentionPruneExtracted(this);
    }

    protected clearRetentionPruneTimers(): void {
        clearRetentionPruneTimersExtracted(this);
    }

    protected jobAgeMs(job: QaapJob): number {
        return job.finishedAt ?? job.createdAt;
    }

    protected collectProtectedJobIds(): Set<string> {
        return collectProtectedJobIdsExtracted(this);
    }

    protected removeJobRecord(id: string): void {
        removeJobRecordExtracted(this, id);
    }

    protected removeGraphRecord(id: string): void {
        removeGraphRecordExtracted(this, id);
    }
}

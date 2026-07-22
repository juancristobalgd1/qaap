// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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

const STORE_MODE = 0o700;
const INDEX_MODE = 0o600;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MAX_LOG_CHARS = 512 * 1024;
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_MAX_CONCURRENT_PER_USER = 4;
const MAX_FUNCTION_INPUT_CHARS = 64 * 1024;
const MAX_FUNCTION_RESULT_CHARS = 256 * 1024;
const MAX_GRAPH_NODES = 128;
const MAX_RETRY_ATTEMPTS = 10;
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

    protected readonly onDidChangeJobEmitter = new Emitter<QaapJobEvent>();
    readonly onDidChangeJob: Event<QaapJobEvent> = this.onDidChangeJobEmitter.event;

    @postConstruct()
    protected init(): void {
        let stateIsWritable = true;
        try {
            fs.mkdirSync(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
            fs.chmodSync(this.storeDirectory(), STORE_MODE);
            const raw = fs.readFileSync(this.indexPath(), 'utf8');
            this.restorePersistedIndex(JSON.parse(raw));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                stateIsWritable = false;
                console.warn('[qaap-jobs] failed to restore job index:', error);
            }
        }
        this.drainQueue();
        // Do not replace an unreadable/corrupt index with an empty snapshot merely by starting.
        // A later explicit create/cancel still establishes new state and will persist normally.
        if (stateIsWritable) {
            void this.persist();
        }
    }

    create(request: QaapCreateJobRequest, ownerLogin?: string): QaapCreateJobResult {
        if (this.stopping) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/stopping', 'The job runtime is stopping.'));
        }
        const owner = ownerLogin?.trim() || undefined;
        const normalized = this.normalizeRequest(request);
        this.assertDependencies(normalized.dependsOn, owner);

        if (normalized.idempotencyKey) {
            const indexKey = this.ownerIdempotencyKey(owner, normalized.idempotencyKey);
            const existingId = this.idempotencyIndex.get(indexKey);
            const existing = existingId ? this.jobs.get(existingId) : undefined;
            if (existing) {
                const prior = this.requests.get(existing.id);
                if (!prior || this.requestFingerprint(prior) !== this.requestFingerprint(normalized)) {
                    throw new QaapJobConflictError(nls.localize(
                        'qaap/jobs/idempotencyConflict',
                        'This idempotency key was already used for a different job request.',
                    ));
                }
                return { job: existing, created: false };
            }
        }

        const job = this.buildJob(randomUUID(), normalized, owner, Date.now());
        this.insertJob(job, normalized);
        this.drainQueue();
        void this.persist();
        return { job: this.jobs.get(job.id) ?? job, created: true };
    }

    createGraph(request: QaapCreateJobGraphRequest, ownerLogin?: string): QaapCreateJobGraphResult {
        if (this.stopping) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/stopping', 'The job runtime is stopping.'));
        }
        const owner = ownerLogin?.trim() || undefined;
        if (!Array.isArray(request.nodes) || request.nodes.length === 0 || request.nodes.length > MAX_GRAPH_NODES) {
            throw new QaapJobRequestError(nls.localize(
                'qaap/jobs/invalidGraphSize',
                'A job graph must contain between 1 and {0} nodes.',
                String(MAX_GRAPH_NODES),
            ));
        }
        const graphKey = this.normalizeIdempotencyKey(request.idempotencyKey);
        const keys = new Set<string>();
        const normalizedByKey = new Map<string, NormalizedJobRequest>();
        const dependenciesByKey = new Map<string, string[]>();
        for (const node of request.nodes) {
            const key = typeof node.key === 'string' ? node.key.trim() : '';
            if (!/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(key) || keys.has(key)) {
                throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidGraphKey', 'Graph node keys must be unique and valid.'));
            }
            keys.add(key);
            if (node.request.idempotencyKey || (node.request.dependsOn?.length ?? 0) > 0) {
                throw new QaapJobRequestError(nls.localize(
                    'qaap/jobs/graphOwnsDependencies',
                    'Graph nodes must declare dependencies and idempotency at graph level.',
                ));
            }
            normalizedByKey.set(key, this.normalizeRequest({ ...node.request, dependsOn: [], idempotencyKey: undefined }));
            if (node.dependsOn !== undefined && !Array.isArray(node.dependsOn)) {
                throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidDependencies', 'Job dependencies must be an array.'));
            }
            const rawDependencies: readonly unknown[] = node.dependsOn ?? [];
            dependenciesByKey.set(key, [...new Set(rawDependencies.map(
                (value: unknown) => typeof value === 'string' ? value.trim() : '',
            ))]);
        }
        for (const [key, dependencies] of dependenciesByKey) {
            if (dependencies.some(dependency => !dependency || dependency === key || !keys.has(dependency))) {
                throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidGraphDependency', 'The graph contains an invalid dependency.'));
            }
        }
        this.assertAcyclicGraph(dependenciesByKey);
        const fingerprint = this.stableJson({
            nodes: request.nodes.map(node => ({
                key: node.key.trim(),
                request: normalizedByKey.get(node.key.trim()),
                dependsOn: [...(dependenciesByKey.get(node.key.trim()) ?? [])].sort(),
            })),
        });
        if (graphKey) {
            const existingId = this.graphIdempotencyIndex.get(this.ownerIdempotencyKey(owner, graphKey));
            const existing = existingId ? this.graphs.get(existingId) : undefined;
            if (existing) {
                if (existing.fingerprint !== fingerprint) {
                    throw new QaapJobConflictError(nls.localize(
                        'qaap/jobs/graphIdempotencyConflict',
                        'This graph idempotency key was already used for a different graph.',
                    ));
                }
                return { graph: existing.graph, jobs: this.jobsForGraph(existing.graph), created: false };
            }
        }

        const graphId = randomUUID();
        const jobIds = new Map<string, string>();
        for (const key of keys) {
            jobIds.set(key, randomUUID());
        }
        const createdAt = Date.now();
        const jobsByKey: Record<string, string> = {};
        for (const key of keys) {
            const base = normalizedByKey.get(key)!;
            const normalized: NormalizedJobRequest = {
                ...base,
                dependsOn: (dependenciesByKey.get(key) ?? []).map(dependency => jobIds.get(dependency)!),
            };
            const id = jobIds.get(key)!;
            const job = this.buildJob(id, normalized, owner, createdAt);
            this.insertJob(job, normalized);
            jobsByKey[key] = id;
        }
        const graph: QaapJobGraph = { id: graphId, createdAt, ownerLogin: owner, idempotencyKey: graphKey, jobsByKey };
        const persisted = { graph, fingerprint };
        this.graphs.set(graph.id, persisted);
        if (graphKey) {
            this.graphIdempotencyIndex.set(this.ownerIdempotencyKey(owner, graphKey), graph.id);
        }
        this.drainQueue();
        void this.persist();
        return { graph, jobs: this.jobsForGraph(graph), created: true };
    }

    listFunctions(): QaapJobFunctionDescriptor[] {
        return this.functionRegistry.list();
    }

    listGraphs(ownerLogin?: string): QaapJobGraph[] {
        const owner = ownerLogin?.trim() || undefined;
        return [...this.graphs.values()]
            .map(persisted => persisted.graph)
            .filter(graph => graph.ownerLogin === owner)
            .sort((left, right) => right.createdAt - left.createdAt);
    }

    getGraph(id: string): { graph: QaapJobGraph; jobs: Readonly<Record<string, QaapJob>> } | undefined {
        const persisted = this.graphs.get(id);
        return persisted ? { graph: persisted.graph, jobs: this.jobsForGraph(persisted.graph) } : undefined;
    }

    list(ownerLogin?: string): QaapJob[] {
        const owner = ownerLogin?.trim() || undefined;
        return [...this.jobs.values()]
            .filter(job => job.ownerLogin === owner)
            .sort((left, right) => right.createdAt - left.createdAt);
    }

    get(id: string): QaapJobDetail | undefined {
        const job = this.jobs.get(id);
        return job ? { ...job, log: this.logs.get(id) ?? '', result: this.results.get(id) } : undefined;
    }

    cancel(id: string): QaapJob | undefined {
        const job = this.jobs.get(id);
        if (!job || isQaapJobFinished(job.state)) {
            return job;
        }
        const child = this.processes.get(id);
        if (child) {
            this.terminateProcessTree(id, child);
        }
        this.abortControllers.get(id)?.abort(new Error('Cancelled'));
        const cancelled = this.finishJob(id, 'cancelled');
        this.drainQueue();
        return cancelled;
    }

    /** Gracefully stop active process groups and durably mark them interrupted. */
    async shutdown(): Promise<void> {
        this.stopping = true;
        for (const timer of this.retryTimers.values()) {
            clearTimeout(timer);
        }
        this.retryTimers.clear();
        for (const job of this.jobs.values()) {
            if (job.state === 'running') {
                const child = this.processes.get(job.id);
                if (child) {
                    this.terminateProcessTree(job.id, child);
                }
                this.abortControllers.get(job.id)?.abort(new Error('Interrupted'));
                this.finishJob(job.id, 'interrupted');
            }
        }
        await this.persist();
    }

    protected normalizeRequest(request: QaapCreateJobRequest): NormalizedJobRequest {
        const rawCwd = typeof request.cwd === 'string' ? request.cwd.trim() : '';
        const cwd = rawCwd ? path.resolve(rawCwd) : '';
        if (!cwd || !path.isAbsolute(cwd) || !this.isDirectory(cwd)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidCwd', 'The job working directory does not exist.'));
        }
        if (request.dependsOn !== undefined && !Array.isArray(request.dependsOn)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidDependencies', 'Job dependencies must be an array.'));
        }
        const dependsOn = [...new Set((request.dependsOn ?? []).map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean))];
        if (dependsOn.length > 128) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/tooManyDependencies', 'A job supports at most 128 dependencies.'));
        }
        const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > this.maxTimeoutMs()) {
            throw new QaapJobRequestError(nls.localize(
                'qaap/jobs/invalidTimeout',
                'The job timeout must be between 1 second and {0} milliseconds.',
                String(this.maxTimeoutMs()),
            ));
        }
        const idempotencyKey = this.normalizeIdempotencyKey(request.idempotencyKey);
        const retryPolicy = this.normalizeRetryPolicy(request.retryPolicy);
        const requestedTitle = request.title?.trim();
        if (request.kind === 'function') {
            const functionId = typeof request.functionId === 'string' ? request.functionId.trim() : '';
            const definition = this.functionRegistry.get(functionId);
            if (!definition) {
                throw new QaapJobRequestError(nls.localize('qaap/jobs/functionNotFound', 'Job function was not found.'));
            }
            if (
                (request.resourceClass !== undefined && request.resourceClass !== definition.descriptor.resourceClass)
                || (request.workspaceAccess !== undefined && request.workspaceAccess !== definition.descriptor.workspaceAccess)
            ) {
                throw new QaapJobRequestError(nls.localize(
                    'qaap/jobs/functionPolicyOverride',
                    'A function job cannot override its registered resource or workspace policy.',
                ));
            }
            let input: unknown;
            try {
                input = definition.normalizeInput(request.input);
                this.assertJsonSize(input, MAX_FUNCTION_INPUT_CHARS, 'Function input');
            } catch (error) {
                throw new QaapJobRequestError(error instanceof Error ? error.message : String(error));
            }
            return {
                kind: 'function',
                title: (requestedTitle || definition.descriptor.label).slice(0, 200),
                functionId,
                input,
                cwd,
                resourceClass: definition.descriptor.resourceClass,
                workspaceAccess: definition.descriptor.workspaceAccess,
                dependsOn,
                timeoutMs,
                retryPolicy,
                idempotencyKey,
            };
        }
        if (request.kind !== undefined && request.kind !== 'command') {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/unsupportedKind', 'Unsupported job kind.'));
        }
        const command = typeof request.command === 'string' ? request.command.trim() : '';
        if (!command || command.length > 128 * 1024) {
            throw new QaapJobRequestError(nls.localize(
                'qaap/jobs/invalidCommand',
                'A non-empty command of at most 128 KiB is required.',
            ));
        }
        const resourceClass = request.resourceClass ?? 'workspace';
        if (!isQaapJobResourceClass(resourceClass)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidResourceClass', 'Invalid job resource class.'));
        }
        const workspaceAccess = request.workspaceAccess ?? 'write';
        if (workspaceAccess !== 'read' && workspaceAccess !== 'write') {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidWorkspaceAccess', 'Invalid workspace access mode.'));
        }
        return {
            kind: 'command',
            title: (requestedTitle || command.split(/\r?\n/, 1)[0]
                || nls.localize('qaap/jobs/defaultTitle', 'Job')).slice(0, 200),
            command,
            cwd,
            resourceClass,
            workspaceAccess,
            dependsOn,
            timeoutMs,
            retryPolicy,
            idempotencyKey,
        };
    }

    protected assertDependencies(dependencyIds: readonly string[], ownerLogin?: string): void {
        for (const dependencyId of dependencyIds) {
            const dependency = this.jobs.get(dependencyId);
            if (!dependency) {
                throw new QaapJobRequestError(nls.localize(
                    'qaap/jobs/dependencyNotFound',
                    'Dependency job {0} was not found.',
                    dependencyId,
                ));
            }
            if (dependency.ownerLogin !== ownerLogin) {
                throw new QaapJobRequestError(nls.localize(
                    'qaap/jobs/dependencyOwnerMismatch',
                    'A job cannot depend on another user\'s job.',
                ));
            }
        }
    }

    protected buildJob(id: string, request: NormalizedJobRequest, ownerLogin: string | undefined, createdAt: number): QaapJob {
        return {
            id,
            kind: request.kind,
            title: request.title,
            command: request.command,
            functionId: request.functionId,
            input: request.input,
            cwd: request.cwd,
            resourceClass: request.resourceClass,
            workspaceAccess: request.workspaceAccess,
            state: request.dependsOn.length > 0 ? 'waiting' : 'queued',
            dependsOn: request.dependsOn,
            timeoutMs: request.timeoutMs,
            retryPolicy: request.retryPolicy,
            attempt: 0,
            createdAt,
            ownerLogin,
            idempotencyKey: request.idempotencyKey,
        };
    }

    protected insertJob(job: QaapJob, request: NormalizedJobRequest): void {
        this.jobs.set(job.id, job);
        this.requests.set(job.id, request);
        this.logs.set(job.id, '');
        if (job.idempotencyKey) {
            this.idempotencyIndex.set(this.ownerIdempotencyKey(job.ownerLogin, job.idempotencyKey), job.id);
        }
        this.onDidChangeJobEmitter.fire({ type: 'created', job });
    }

    protected assertAcyclicGraph(dependenciesByKey: ReadonlyMap<string, readonly string[]>): void {
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const visit = (key: string): void => {
            if (visiting.has(key)) {
                throw new QaapJobRequestError(nls.localize('qaap/jobs/graphCycle', 'The job graph contains a cycle.'));
            }
            if (visited.has(key)) {
                return;
            }
            visiting.add(key);
            for (const dependency of dependenciesByKey.get(key) ?? []) {
                visit(dependency);
            }
            visiting.delete(key);
            visited.add(key);
        };
        for (const key of dependenciesByKey.keys()) {
            visit(key);
        }
    }

    protected jobsForGraph(graph: QaapJobGraph): Record<string, QaapJob> {
        const result: Record<string, QaapJob> = {};
        for (const [key, id] of Object.entries(graph.jobsByKey)) {
            const job = this.jobs.get(id);
            if (job) {
                result[key] = job;
            }
        }
        return result;
    }

    protected drainQueue(): void {
        if (this.draining || this.stopping) {
            return;
        }
        this.draining = true;
        try {
            while (true) {
                for (const job of this.jobs.values()) {
                    if (job.state === 'retry_wait') {
                        if ((job.nextAttemptAt ?? 0) <= Date.now()) {
                            const queued = this.replaceJob(job.id, { state: 'queued', nextAttemptAt: undefined });
                            this.onDidChangeJobEmitter.fire({ type: 'changed', job: queued });
                        } else {
                            this.scheduleRetryWake(job);
                        }
                        continue;
                    }
                    if (job.state !== 'waiting' && job.state !== 'queued') {
                        continue;
                    }
                    const dependencyStates = job.dependsOn.map(id => this.jobs.get(id)?.state);
                    if (dependencyStates.some(state => state === undefined || (isQaapJobFinished(state) && !didQaapJobSucceed(state)))) {
                        this.finishJob(job.id, 'dependency_failed');
                        continue;
                    }
                    if (dependencyStates.some(state => state !== 'succeeded')) {
                        if (job.state !== 'waiting') {
                            const waiting = this.replaceJob(job.id, { state: 'waiting' });
                            this.onDidChangeJobEmitter.fire({ type: 'changed', job: waiting });
                        }
                        continue;
                    }
                    if (job.state !== 'queued') {
                        const queued = this.replaceJob(job.id, { state: 'queued' });
                        this.onDidChangeJobEmitter.fire({ type: 'changed', job: queued });
                    }
                }

                // Pick one job at a time and re-rank after every start. Owners with fewer active
                // jobs go first, preventing one deep queue from consuming every global slot.
                const runningByOwner = new Map<string, number>();
                for (const running of this.jobs.values()) {
                    if (running.state === 'running') {
                        const owner = running.ownerLogin ?? '';
                        runningByOwner.set(owner, (runningByOwner.get(owner) ?? 0) + 1);
                    }
                }
                const candidates = [...this.jobs.values()]
                    .filter(job => job.state === 'queued')
                    .sort((left, right) => {
                        const load = (runningByOwner.get(left.ownerLogin ?? '') ?? 0)
                            - (runningByOwner.get(right.ownerLogin ?? '') ?? 0);
                        return load || left.createdAt - right.createdAt;
                    });
                const candidate = candidates.find(job => this.canStart(job));
                if (!candidate) {
                    break;
                }
                const running = this.replaceJob(candidate.id, {
                    state: 'running',
                    startedAt: candidate.startedAt ?? Date.now(),
                    attempt: candidate.attempt + 1,
                    nextAttemptAt: undefined,
                    finishedAt: undefined,
                    exitCode: undefined,
                });
                this.appendOutput(running.id, nls.localize(
                    'qaap/jobs/attemptStartedLog',
                    '\n[qaap] Starting attempt {0} of {1}.\n',
                    String(running.attempt),
                    String(running.retryPolicy?.maxAttempts ?? 1),
                ));
                this.onDidChangeJobEmitter.fire({ type: 'changed', job: running });
                void this.persist();
                this.runJob(running);
            }
        } finally {
            this.draining = false;
        }
    }

    protected canStart(candidate: QaapJob): boolean {
        const running = [...this.jobs.values()].filter(job => job.state === 'running');
        if (running.length >= this.maxConcurrentJobs()) {
            return false;
        }
        if (running.filter(job => job.ownerLogin === candidate.ownerLogin).length >= this.maxConcurrentJobsPerUser()) {
            return false;
        }
        if (running.filter(job => job.resourceClass === candidate.resourceClass).length >= this.resourceLimit(candidate.resourceClass)) {
            return false;
        }
        const sameWorkspace = running.filter(job => path.resolve(job.cwd) === path.resolve(candidate.cwd));
        if (candidate.workspaceAccess === 'read' && this.hasEarlierQueuedWriter(candidate)) {
            return false;
        }
        return candidate.workspaceAccess === 'read'
            ? sameWorkspace.every(job => job.workspaceAccess === 'read')
            : sameWorkspace.length === 0;
    }

    /** Do not let a stream of later readers starve an earlier writer waiting for the same workspace. */
    protected hasEarlierQueuedWriter(candidate: QaapJob): boolean {
        for (const job of this.jobs.values()) {
            if (job.id === candidate.id) {
                return false;
            }
            if (
                job.state === 'queued'
                && job.workspaceAccess === 'write'
                && path.resolve(job.cwd) === path.resolve(candidate.cwd)
            ) {
                return true;
            }
        }
        return false;
    }

    protected runJob(job: QaapJob): void {
        if (job.kind === 'function') {
            this.runFunctionJob(job);
        } else {
            this.runCommandJob(job);
        }
    }

    protected runCommandJob(job: QaapJob): void {
        try {
            if (!job.command) {
                throw new Error('Command job has no command.');
            }
            const child = this.tenantSpawn.spawnPrepared(job.command, {
                cwd: job.cwd,
                env: this.buildChildEnv(job),
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: true,
            });
            this.processes.set(job.id, child);
            child.stdout?.on('data', chunk => this.appendOutput(job.id, String(chunk)));
            child.stderr?.on('data', chunk => this.appendOutput(job.id, String(chunk)));
            child.once('error', error => {
                this.appendOutput(job.id, `${error instanceof Error ? error.message : String(error)}\n`);
                this.handleAttemptFailure(job.id, 'failed');
            });
            child.once('close', code => {
                this.handleProcessClose(job.id, child, code);
            });
            this.startAttemptTimeout(job, () => {
                this.appendOutput(job.id, nls.localize('qaap/jobs/timedOutLog', '\nJob timed out.\n'));
                this.terminateProcessTree(job.id, child);
                this.handleAttemptFailure(job.id, 'timed_out');
            });
        } catch (error) {
            this.appendOutput(job.id, `${error instanceof Error ? error.message : String(error)}\n`);
            this.handleAttemptFailure(job.id, 'failed');
        }
    }

    protected runFunctionJob(job: QaapJob): void {
        const definition = job.functionId ? this.functionRegistry.get(job.functionId) : undefined;
        if (!definition) {
            this.appendOutput(job.id, `${nls.localize('qaap/jobs/functionNotFound', 'Job function was not found.')}\n`);
            this.handleAttemptFailure(job.id, 'failed');
            return;
        }
        const controller = new AbortController();
        this.abortControllers.set(job.id, controller);
        this.startAttemptTimeout(job, () => {
            this.appendOutput(job.id, nls.localize('qaap/jobs/timedOutLog', '\nJob timed out.\n'));
            controller.abort(new Error('Timed out'));
            this.handleAttemptFailure(job.id, 'timed_out');
        });
        void Promise.resolve()
            .then(() => definition.execute({
                jobId: job.id,
                cwd: job.cwd,
                ownerLogin: job.ownerLogin,
                signal: controller.signal,
                emitOutput: chunk => {
                    if (this.jobs.get(job.id)?.state === 'running') {
                        this.appendOutput(job.id, chunk);
                    }
                },
                resolveWorkspacePath: relativePath => this.resolveFunctionWorkspacePath(job.cwd, relativePath),
            }, job.input))
            .then(result => {
                if (this.jobs.get(job.id)?.state !== 'running') {
                    return;
                }
                this.assertJsonSize(result, MAX_FUNCTION_RESULT_CHARS, 'Function result');
                if (result !== undefined) {
                    this.results.set(job.id, result);
                }
                this.finishJob(job.id, 'succeeded');
                this.drainQueue();
            })
            .catch(error => {
                if (this.jobs.get(job.id)?.state !== 'running') {
                    return;
                }
                this.appendOutput(job.id, `${error instanceof Error ? error.message : String(error)}\n`);
                this.handleAttemptFailure(job.id, 'failed');
            });
    }

    protected startAttemptTimeout(job: QaapJob, onTimeout: () => void): void {
        const timer = setTimeout(() => {
            if (this.jobs.get(job.id)?.state === 'running') {
                onTimeout();
            }
        }, job.timeoutMs);
        timer.unref?.();
        this.timeoutTimers.set(job.id, timer);
    }

    protected handleProcessClose(id: string, child: ChildProcess, code: number | null): void {
        this.reapProcessGroupAfterExit(child);
        const terminationTimer = this.terminationTimers.get(id);
        if (terminationTimer) {
            clearTimeout(terminationTimer);
            this.terminationTimers.delete(id);
        }
        const current = this.jobs.get(id);
        if (current?.state !== 'running') {
            this.processes.delete(id);
            return;
        }
        if (code === 0) {
            this.finishJob(id, 'succeeded', 0);
            this.drainQueue();
        } else {
            this.handleAttemptFailure(id, 'failed', code ?? undefined);
        }
    }

    protected handleAttemptFailure(id: string, finalState: 'failed' | 'timed_out', exitCode?: number): void {
        const current = this.jobs.get(id);
        if (current?.state !== 'running') {
            return;
        }
        this.clearActiveAttempt(id);
        const policy = current.retryPolicy;
        if (policy && current.attempt < policy.maxAttempts) {
            const initialBackoffMs = policy.initialBackoffMs ?? 1_000;
            const multiplier = policy.multiplier ?? 2;
            const maxBackoffMs = policy.maxBackoffMs ?? 60_000;
            const delay = Math.min(
                maxBackoffMs,
                Math.round(initialBackoffMs * Math.pow(multiplier, Math.max(0, current.attempt - 1))),
            );
            const retrying = this.replaceJob(id, {
                state: 'retry_wait',
                nextAttemptAt: Date.now() + delay,
                exitCode,
            });
            this.appendOutput(id, nls.localize(
                'qaap/jobs/retryScheduledLog',
                '[qaap] Attempt {0} failed; retrying in {1} ms.\n',
                String(current.attempt),
                String(delay),
            ));
            this.onDidChangeJobEmitter.fire({ type: 'changed', job: retrying });
            this.scheduleRetryWake(retrying);
            void this.persist();
        } else {
            this.finishJob(id, finalState, exitCode);
        }
        this.drainQueue();
    }

    protected scheduleRetryWake(job: QaapJob): void {
        if (this.retryTimers.has(job.id) || job.state !== 'retry_wait') {
            return;
        }
        const delay = Math.max(0, (job.nextAttemptAt ?? Date.now()) - Date.now());
        const timer = setTimeout(() => {
            this.retryTimers.delete(job.id);
            if (this.jobs.get(job.id)?.state === 'retry_wait') {
                this.drainQueue();
                void this.persist();
            }
        }, delay);
        timer.unref?.();
        this.retryTimers.set(job.id, timer);
    }

    protected appendOutput(id: string, chunk: string): void {
        const job = this.jobs.get(id);
        if (!job || !chunk) {
            return;
        }
        const max = this.maxLogChars();
        const previous = this.logs.get(id) ?? '';
        const combined = previous + chunk;
        const log = combined.length <= max
            ? combined
            : `${nls.localize(
                'qaap/jobs/logTruncated',
                '[... {0} earlier characters truncated ...]',
                String(combined.length - max),
            )}\n${combined.slice(-max)}`;
        this.logs.set(id, log);
        this.onDidChangeJobEmitter.fire({ type: 'output', job, chunk });
    }

    protected clearActiveAttempt(id: string): void {
        const timeoutTimer = this.timeoutTimers.get(id);
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            this.timeoutTimers.delete(id);
        }
        this.processes.delete(id);
        this.abortControllers.delete(id);
    }

    protected finishJob(
        id: string,
        state: Exclude<QaapJobState, 'waiting' | 'queued' | 'running' | 'retry_wait'>,
        exitCode?: number,
    ): QaapJob | undefined {
        const current = this.jobs.get(id);
        if (!current || isQaapJobFinished(current.state)) {
            return current;
        }
        this.clearActiveAttempt(id);
        const retryTimer = this.retryTimers.get(id);
        if (retryTimer) {
            clearTimeout(retryTimer);
            this.retryTimers.delete(id);
        }
        const finished = this.replaceJob(id, {
            state,
            finishedAt: Date.now(),
            nextAttemptAt: undefined,
            ...(exitCode !== undefined ? { exitCode } : {}),
        });
        this.onDidChangeJobEmitter.fire({ type: 'changed', job: finished });
        void this.persist();
        return finished;
    }

    protected replaceJob(id: string, patch: Partial<QaapJob>): QaapJob {
        const current = this.jobs.get(id);
        if (!current) {
            throw new Error(`Unknown job: ${id}`);
        }
        const updated = { ...current, ...patch };
        this.jobs.set(id, updated);
        return updated;
    }

    protected terminateProcessTree(id: string, child: ChildProcess): void {
        const pid = child.pid;
        if (!pid || globalThis.process.platform === 'win32') {
            try {
                child.kill('SIGTERM');
            } catch { /* already gone */ }
            return;
        }
        try {
            globalThis.process.kill(-pid, 'SIGTERM');
        } catch {
            try {
                child.kill('SIGTERM');
            } catch { /* already gone */ }
        }
        const escalation = setTimeout(() => {
            try {
                globalThis.process.kill(-pid, 'SIGKILL');
            } catch { /* already gone */ }
        }, 5_000);
        escalation.unref?.();
        this.terminationTimers.set(id, escalation);
    }

    protected reapProcessGroupAfterExit(child: ChildProcess): void {
        if (!child.pid || globalThis.process.platform === 'win32') {
            return;
        }
        try {
            globalThis.process.kill(-child.pid, 'SIGKILL');
        } catch { /* no residual descendants */ }
    }

    protected buildChildEnv(job: QaapJob): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP']) {
            if (process.env[key] !== undefined) {
                env[key] = process.env[key];
            }
        }
        env.PWD = job.cwd;
        env.CI = process.env.CI ?? '1';
        env.QAAP_JOB_ID = job.id;
        env.QAAP_JOB_RESOURCE_CLASS = job.resourceClass;
        return this.tenantSpawn.resolveProcessEnv(job.cwd, env);
    }

    protected async resolveFunctionWorkspacePath(cwd: string, relativePath: string): Promise<string> {
        const relative = typeof relativePath === 'string' ? relativePath.trim() : '';
        if (!relative || path.isAbsolute(relative)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/functions/invalidWorkspacePath', 'Invalid function workspace path.'));
        }
        const lexicalTarget = path.resolve(cwd, relative);
        const lexicalRelative = path.relative(path.resolve(cwd), lexicalTarget);
        if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/functions/pathOutsideWorkspace', 'Function path is outside the workspace.'));
        }
        const [realWorkspace, realTarget] = await Promise.all([fsp.realpath(cwd), fsp.realpath(lexicalTarget)]);
        const realRelative = path.relative(realWorkspace, realTarget);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/functions/pathOutsideWorkspace', 'Function path is outside the workspace.'));
        }
        return realTarget;
    }

    protected restorePersistedIndex(stored: unknown): void {
        const index = stored as Partial<PersistedJobIndex | LegacyPersistedJobIndex> | undefined;
        if ((index?.version !== 1 && index?.version !== 2) || !Array.isArray(index.jobs) || !index.requests || typeof index.requests !== 'object') {
            throw new Error('Invalid persisted job index.');
        }
        for (const persisted of index.jobs) {
            if (!persisted?.id || !persisted.state) {
                continue;
            }
            const request = index.requests[persisted.id];
            const resumable = persisted.state === 'waiting' || persisted.state === 'queued' || persisted.state === 'retry_wait';
            const state = persisted.state === 'running' || (resumable && !request) ? 'interrupted' : persisted.state;
            const job: QaapJob = {
                ...persisted,
                state,
                attempt: persisted.attempt ?? (persisted.state === 'running' ? 1 : 0),
                ...(state === 'interrupted' ? { finishedAt: Date.now() } : {}),
            };
            this.jobs.set(job.id, job);
            this.logs.set(job.id, typeof index.logs?.[job.id] === 'string' ? index.logs[job.id] : '');
            if (index.version === 2 && index.results && Object.prototype.hasOwnProperty.call(index.results, job.id)) {
                this.results.set(job.id, index.results[job.id]);
            }
            if (request) {
                this.requests.set(job.id, request);
            }
            if (job.idempotencyKey) {
                this.idempotencyIndex.set(this.ownerIdempotencyKey(job.ownerLogin, job.idempotencyKey), job.id);
            }
            if (job.state === 'retry_wait') {
                this.scheduleRetryWake(job);
            }
        }
        if (index.version === 2 && Array.isArray(index.graphs)) {
            for (const persisted of index.graphs) {
                if (!persisted?.graph?.id || typeof persisted.fingerprint !== 'string') {
                    continue;
                }
                this.graphs.set(persisted.graph.id, persisted);
                if (persisted.graph.idempotencyKey) {
                    this.graphIdempotencyIndex.set(
                        this.ownerIdempotencyKey(persisted.graph.ownerLogin, persisted.graph.idempotencyKey),
                        persisted.graph.id,
                    );
                }
            }
        }
    }

    protected persist(): Promise<void> {
        const requests: Record<string, NormalizedJobRequest> = {};
        const logs: Record<string, string> = {};
        const results: Record<string, unknown> = {};
        for (const [id, request] of this.requests) {
            requests[id] = request;
        }
        for (const [id, log] of this.logs) {
            logs[id] = log;
        }
        for (const [id, result] of this.results) {
            results[id] = result;
        }
        const snapshot: PersistedJobIndex = {
            version: 2,
            jobs: [...this.jobs.values()],
            requests,
            logs,
            results,
            graphs: [...this.graphs.values()],
        };
        const previous = this.persistChain ?? Promise.resolve();
        this.persistChain = previous
            .catch(() => undefined)
            .then(async () => {
                await fsp.mkdir(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
                await fsp.chmod(this.storeDirectory(), STORE_MODE).catch(() => undefined);
                await writeJsonAtomic(this.indexPath(), snapshot, { mode: INDEX_MODE });
            })
            .catch(error => console.warn('[qaap-jobs] failed to persist job index:', error));
        return this.persistChain;
    }

    protected requestFingerprint(request: NormalizedJobRequest): string {
        return this.stableJson({ ...request, dependsOn: [...request.dependsOn].sort() });
    }

    protected normalizeIdempotencyKey(value: string | undefined): string | undefined {
        const key = value?.trim() || undefined;
        if (key && (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key))) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidIdempotencyKey', 'Invalid idempotency key.'));
        }
        return key;
    }

    protected normalizeRetryPolicy(value: QaapJobRetryPolicy | undefined): Required<QaapJobRetryPolicy> | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidRetryPolicy', 'Invalid retry policy.'));
        }
        const maxAttempts = value.maxAttempts;
        const initialBackoffMs = value.initialBackoffMs ?? 1_000;
        const multiplier = value.multiplier ?? 2;
        const maxBackoffMs = value.maxBackoffMs ?? 60_000;
        if (
            !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_RETRY_ATTEMPTS
            || !Number.isSafeInteger(initialBackoffMs) || initialBackoffMs < 0 || initialBackoffMs > 3_600_000
            || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10
            || !Number.isSafeInteger(maxBackoffMs) || maxBackoffMs < initialBackoffMs || maxBackoffMs > 3_600_000
        ) {
            throw new QaapJobRequestError(nls.localize(
                'qaap/jobs/invalidRetryPolicy',
                'Invalid retry policy.',
            ));
        }
        return { maxAttempts, initialBackoffMs, multiplier, maxBackoffMs };
    }

    protected assertJsonSize(value: unknown, maxChars: number, label: string): void {
        let serialized: string | undefined;
        try {
            serialized = JSON.stringify(value);
        } catch {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/jsonSerializable', '{0} must be JSON-serializable.', label));
        }
        if (value !== undefined && serialized === undefined) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/jsonSerializable', '{0} must be JSON-serializable.', label));
        }
        if ((serialized?.length ?? 0) > maxChars) {
            throw new QaapJobRequestError(nls.localize(
                'qaap/jobs/jsonTooLarge',
                '{0} exceeds the maximum size of {1} characters.',
                label,
                String(maxChars),
            ));
        }
    }

    protected stableJson(value: unknown): string {
        const normalize = (candidate: unknown): unknown => {
            if (Array.isArray(candidate)) {
                return candidate.map(normalize);
            }
            if (candidate && typeof candidate === 'object') {
                const result: Record<string, unknown> = {};
                for (const key of Object.keys(candidate as Record<string, unknown>).sort()) {
                    const nested = (candidate as Record<string, unknown>)[key];
                    if (nested !== undefined) {
                        result[key] = normalize(nested);
                    }
                }
                return result;
            }
            return candidate;
        };
        return JSON.stringify(normalize(value));
    }

    protected ownerIdempotencyKey(ownerLogin: string | undefined, key: string): string {
        return `${ownerLogin ?? ''}\0${key}`;
    }

    protected isDirectory(candidate: string): boolean {
        try {
            return fs.statSync(candidate).isDirectory();
        } catch {
            return false;
        }
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
}

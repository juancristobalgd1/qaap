// @ts-nocheck
// Extracted from qaap-job-runtime.ts

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
import { DEFAULT_TIMEOUT_MS, MAX_FUNCTION_INPUT_CHARS, MAX_GRAPH_NODES, STORE_MODE } from './qaap-job-runtime';
import { QaapJobConflictError } from './qaap-job-runtime';
import { QaapJobRequestError } from './qaap-job-runtime';

export function initExtracted(ctx: any): void {
        let stateIsWritable = true;
        try {
            fs.mkdirSync(ctx.storeDirectory(), { recursive: true, mode: STORE_MODE });
            fs.chmodSync(ctx.storeDirectory(), STORE_MODE);
            const raw = fs.readFileSync(ctx.indexPath(), 'utf8');
            ctx.restorePersistedIndex(JSON.parse(raw));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                stateIsWritable = false;
                console.warn('[qaap-jobs] failed to restore job index:', error);
            }
        }
        ctx.drainQueue();
        // Do not replace an unreadable/corrupt index with an empty snapshot merely by starting.
        // A later explicit create/cancel still establishes new state and will persist normally.
        if (stateIsWritable) {
            void ctx.persist();
        }
        ctx.scheduleRetentionPrune();
}

export function createExtracted(ctx: any, request: QaapCreateJobRequest, ownerLogin?: string): QaapCreateJobResult {
        if (ctx.stopping) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/stopping', 'The job runtime is stopping.'));
        }
        const owner = ownerLogin?.trim() || undefined;
        const normalized = ctx.normalizeRequest(request);
        ctx.assertDependencies(normalized.dependsOn, owner);

        if (normalized.idempotencyKey) {
            const indexKey = ctx.ownerIdempotencyKey(owner, normalized.idempotencyKey);
            const existingId = ctx.idempotencyIndex.get(indexKey);
            const existing = existingId ? ctx.jobs.get(existingId) : undefined;
            if (existing) {
                const prior = ctx.requests.get(existing.id);
                if (!prior || ctx.requestFingerprint(prior) !== ctx.requestFingerprint(normalized)) {
                    throw new QaapJobConflictError(nls.localize(
                        'qaap/jobs/idempotencyConflict',
                        'This idempotency key was already used for a different job request.',
                    ));
                }
                return { job: existing, created: false };
            }
        }

        const job = ctx.buildJob(randomUUID(), normalized, owner, Date.now());
        ctx.insertJob(job, normalized);
        ctx.drainQueue();
        void ctx.persist();
        return { job: ctx.jobs.get(job.id) ?? job, created: true };
}

export function createGraphExtracted(ctx: any, request: QaapCreateJobGraphRequest, ownerLogin?: string): QaapCreateJobGraphResult {
        if (ctx.stopping) {
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
        const graphKey = ctx.normalizeIdempotencyKey(request.idempotencyKey);
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
            normalizedByKey.set(key, ctx.normalizeRequest({ ...node.request, dependsOn: [], idempotencyKey: undefined }));
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
        ctx.assertAcyclicGraph(dependenciesByKey);
        const fingerprint = ctx.stableJson({
            nodes: request.nodes.map(node => ({
                key: node.key.trim(),
                request: normalizedByKey.get(node.key.trim()),
                dependsOn: [...(dependenciesByKey.get(node.key.trim()) ?? [])].sort(),
            })),
        });
        if (graphKey) {
            const existingId = ctx.graphIdempotencyIndex.get(ctx.ownerIdempotencyKey(owner, graphKey));
            const existing = existingId ? ctx.graphs.get(existingId) : undefined;
            if (existing) {
                if (existing.fingerprint !== fingerprint) {
                    throw new QaapJobConflictError(nls.localize(
                        'qaap/jobs/graphIdempotencyConflict',
                        'This graph idempotency key was already used for a different graph.',
                    ));
                }
                return { graph: existing.graph, jobs: ctx.jobsForGraph(existing.graph), created: false };
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
            const job = ctx.buildJob(id, normalized, owner, createdAt);
            ctx.insertJob(job, normalized);
            jobsByKey[key] = id;
        }
        const graph: QaapJobGraph = { id: graphId, createdAt, ownerLogin: owner, idempotencyKey: graphKey, jobsByKey };
        const persisted = { graph, fingerprint };
        ctx.graphs.set(graph.id, persisted);
        if (graphKey) {
            ctx.graphIdempotencyIndex.set(ctx.ownerIdempotencyKey(owner, graphKey), graph.id);
        }
        ctx.drainQueue();
        void ctx.persist();
        return { graph, jobs: ctx.jobsForGraph(graph), created: true };
}

export function listGraphsExtracted(ctx: any, ownerLogin?: string): QaapJobGraph[] {
        const owner = ownerLogin?.trim() || undefined;
        return [...ctx.graphs.values()]
            .map(persisted => persisted.graph)
            .filter(graph => graph.ownerLogin === owner)
            .sort((left, right) => right.createdAt - left.createdAt);
}

export function listExtracted(ctx: any, ownerLogin?: string): QaapJob[] {
        const owner = ownerLogin?.trim() || undefined;
        return [...ctx.jobs.values()]
            .filter(job => job.ownerLogin === owner)
            .sort((left, right) => right.createdAt - left.createdAt);
}

export function cancelExtracted(ctx: any, id: string): QaapJob | undefined {
        const job = ctx.jobs.get(id);
        if (!job || isQaapJobFinished(job.state)) {
            return job;
        }
        const child = ctx.processes.get(id);
        if (child) {
            ctx.terminateProcessTree(id, child);
        }
        ctx.abortControllers.get(id)?.abort(new Error('Cancelled'));
        const cancelled = ctx.finishJob(id, 'cancelled');
        ctx.drainQueue();
        return cancelled;
}

export async function shutdownExtracted(ctx: any): Promise<void> {
        ctx.stopping = true;
        ctx.clearRetentionPruneTimers();
        for (const timer of ctx.retryTimers.values()) {
            clearTimeout(timer);
        }
        ctx.retryTimers.clear();
        for (const job of ctx.jobs.values()) {
            if (job.state === 'running') {
                const child = ctx.processes.get(job.id);
                if (child) {
                    ctx.terminateProcessTree(job.id, child);
                }
                ctx.abortControllers.get(job.id)?.abort(new Error('Interrupted'));
                ctx.finishJob(job.id, 'interrupted');
            }
        }
        await ctx.persist();
}

export function pruneRetainedJobsExtracted(ctx: any, nowMs = Date.now()): { prunedJobs: number; prunedGraphs: number } {
        const retentionDays = ctx.retentionDays();
        const maxPerUser = ctx.maxJobsPerUser();
        if (retentionDays <= 0 && maxPerUser <= 0) {
            return { prunedJobs: 0, prunedGraphs: 0 };
        }
        const protectedIds = ctx.collectProtectedJobIds();
        const cutoffMs = retentionDays > 0 ? nowMs - (retentionDays * 24 * 60 * 60 * 1000) : undefined;
        const toDelete = new Set<string>();

        const byOwner = new Map<string, QaapJob[]>();
        for (const job of ctx.jobs.values()) {
            const key = job.ownerLogin?.trim() || '__none__';
            const bucket = byOwner.get(key);
            if (bucket) {
                bucket.push(job);
            } else {
                byOwner.set(key, [job]);
            }
        }

        for (const jobs of byOwner.values()) {
            const finished = jobs
                .filter(job => isQaapJobFinished(job.state) && !protectedIds.has(job.id))
                .sort((left, right) => ctx.jobAgeMs(right) - ctx.jobAgeMs(left));

            if (cutoffMs !== undefined) {
                for (const job of finished) {
                    if (ctx.jobAgeMs(job) < cutoffMs) {
                        toDelete.add(job.id);
                    }
                }
            }

            if (maxPerUser > 0 && jobs.length > maxPerUser) {
                const keepFinished = finished.filter(job => !toDelete.has(job.id));
                const activeCount = jobs.length - finished.length;
                const finishedBudget = Math.max(0, maxPerUser - activeCount);
                for (const job of keepFinished.slice(finishedBudget)) {
                    toDelete.add(job.id);
                }
            }
        }

        for (const id of toDelete) {
            ctx.removeJobRecord(id);
        }

        let prunedGraphs = 0;
        for (const [graphId, persisted] of [...ctx.graphs.entries()]) {
            const jobIds = Object.values(persisted.graph.jobsByKey);
            const allGone = jobIds.length === 0 || jobIds.every(id => !ctx.jobs.has(id));
            const allFinishedOrGone = jobIds.every(id => {
                const job = ctx.jobs.get(id);
                return !job || isQaapJobFinished(job.state);
            });
            const graphAge = persisted.graph.createdAt;
            const graphExpired = cutoffMs !== undefined && graphAge < cutoffMs;
            if (allGone || (allFinishedOrGone && graphExpired && jobIds.every(id => toDelete.has(id) || !ctx.jobs.has(id)))) {
                ctx.removeGraphRecord(graphId);
                prunedGraphs++;
            }
        }

        if (toDelete.size > 0 || prunedGraphs > 0) {
            console.info(`[qaap-jobs] pruned ${toDelete.size} job(s), ${prunedGraphs} graph(s)`);
            void ctx.persist();
        }
        return { prunedJobs: toDelete.size, prunedGraphs };
}

export function normalizeRequestExtracted(ctx: any, request: QaapCreateJobRequest): NormalizedJobRequest {
        const rawCwd = typeof request.cwd === 'string' ? request.cwd.trim() : '';
        const cwd = rawCwd ? path.resolve(rawCwd) : '';
        if (!cwd || !path.isAbsolute(cwd) || !ctx.isDirectory(cwd)) {
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
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > ctx.maxTimeoutMs()) {
            throw new QaapJobRequestError(nls.localize(
                'qaap/jobs/invalidTimeout',
                'The job timeout must be between 1 second and {0} milliseconds.',
                String(ctx.maxTimeoutMs()),
            ));
        }
        const idempotencyKey = ctx.normalizeIdempotencyKey(request.idempotencyKey);
        const retryPolicy = ctx.normalizeRetryPolicy(request.retryPolicy);
        const requestedTitle = request.title?.trim();
        if (request.kind === 'function') {
            const functionId = typeof request.functionId === 'string' ? request.functionId.trim() : '';
            const definition = ctx.functionRegistry.get(functionId);
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
                ctx.assertJsonSize(input, MAX_FUNCTION_INPUT_CHARS, 'Function input');
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

export function assertDependenciesExtracted(ctx: any, dependencyIds: readonly string[], ownerLogin?: string): void {
        for (const dependencyId of dependencyIds) {
            const dependency = ctx.jobs.get(dependencyId);
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

export function buildJobExtracted(ctx: any, id: string, request: NormalizedJobRequest, ownerLogin: string | undefined, createdAt: number): QaapJob {
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

export function insertJobExtracted(ctx: any, job: QaapJob, request: NormalizedJobRequest): void {
        ctx.jobs.set(job.id, job);
        ctx.requests.set(job.id, request);
        ctx.logs.set(job.id, '');
        if (job.idempotencyKey) {
            ctx.idempotencyIndex.set(ctx.ownerIdempotencyKey(job.ownerLogin, job.idempotencyKey), job.id);
        }
        ctx.onDidChangeJobEmitter.fire({ type: 'created', job });
}


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
import { INDEX_MODE, JOB_PRUNE_START_DELAY_MS, MAX_RETRY_ATTEMPTS, STORE_MODE } from './qaap-job-runtime';
import { QaapJobRequestError } from './qaap-job-runtime';

export function buildChildEnvExtracted(ctx: any, job: QaapJob): NodeJS.ProcessEnv {
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
        return ctx.tenantSpawn.resolveProcessEnv(job.cwd, env);
}

export async function resolveFunctionWorkspacePathExtracted(ctx: any, cwd: string, relativePath: string): Promise<string> {
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

export function restorePersistedIndexExtracted(ctx: any, stored: unknown): void {
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
            ctx.jobs.set(job.id, job);
            ctx.logs.set(job.id, typeof index.logs?.[job.id] === 'string' ? index.logs[job.id] : '');
            if (index.version === 2 && index.results && Object.prototype.hasOwnProperty.call(index.results, job.id)) {
                ctx.results.set(job.id, index.results[job.id]);
            }
            if (request) {
                ctx.requests.set(job.id, request);
            }
            if (job.idempotencyKey) {
                ctx.idempotencyIndex.set(ctx.ownerIdempotencyKey(job.ownerLogin, job.idempotencyKey), job.id);
            }
            if (job.state === 'retry_wait') {
                ctx.scheduleRetryWake(job);
            }
        }
        if (index.version === 2 && Array.isArray(index.graphs)) {
            for (const persisted of index.graphs) {
                if (!persisted?.graph?.id || typeof persisted.fingerprint !== 'string') {
                    continue;
                }
                ctx.graphs.set(persisted.graph.id, persisted);
                if (persisted.graph.idempotencyKey) {
                    ctx.graphIdempotencyIndex.set(
                        ctx.ownerIdempotencyKey(persisted.graph.ownerLogin, persisted.graph.idempotencyKey),
                        persisted.graph.id,
                    );
                }
            }
        }
}

export function persistExtracted(ctx: any): Promise<void> {
        const requests: Record<string, NormalizedJobRequest> = {};
        const logs: Record<string, string> = {};
        const results: Record<string, unknown> = {};
        for (const [id, request] of ctx.requests) {
            requests[id] = request;
        }
        for (const [id, log] of ctx.logs) {
            logs[id] = log;
        }
        for (const [id, result] of ctx.results) {
            results[id] = result;
        }
        const snapshot: PersistedJobIndex = {
            version: 2,
            jobs: [...ctx.jobs.values()],
            requests,
            logs,
            results,
            graphs: [...ctx.graphs.values()],
        };
        const previous = ctx.persistChain ?? Promise.resolve();
        ctx.persistChain = previous
            .catch(() => undefined)
            .then(async () => {
                await fsp.mkdir(ctx.storeDirectory(), { recursive: true, mode: STORE_MODE });
                await fsp.chmod(ctx.storeDirectory(), STORE_MODE).catch(() => undefined);
                await writeJsonAtomic(ctx.indexPath(), snapshot, { mode: INDEX_MODE });
            })
            .catch(error => console.warn('[qaap-jobs] failed to persist job index:', error));
        return ctx.persistChain;
}

export function normalizeIdempotencyKeyExtracted(ctx: any, value: string | undefined): string | undefined {
        const key = value?.trim() || undefined;
        if (key && (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key))) {
            throw new QaapJobRequestError(nls.localize('qaap/jobs/invalidIdempotencyKey', 'Invalid idempotency key.'));
        }
        return key;
}

export function normalizeRetryPolicyExtracted(ctx: any, value: QaapJobRetryPolicy | undefined): Required<QaapJobRetryPolicy> | undefined {
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

export function assertJsonSizeExtracted(ctx: any, value: unknown, maxChars: number, label: string): void {
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

export function stableJsonExtracted(ctx: any, value: unknown): string {
        const normalize = (candidate: unknown): unknown => {
            if (Array.isArray(candidate)) {
                return candidate.map(normalize);
            }
            if (candidate && typeof candidate === 'object') {
                const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
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

export function isDirectoryExtracted(ctx: any, candidate: string): boolean {
        try {
            return fs.statSync(candidate).isDirectory();
        } catch {
            return false;
        }
}

export function envIntOrExtracted(ctx: any, name: string, fallback: number): number {
        const raw = process.env[name]?.trim();
        if (raw === undefined || raw === '') {
            return fallback;
        }
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
}

export function scheduleRetentionPruneExtracted(ctx: any): void {
        if (ctx.retentionDays() <= 0 && ctx.maxJobsPerUser() <= 0) {
            return;
        }
        ctx.clearRetentionPruneTimers();
        ctx.pruneStartTimer = setTimeout(() => {
            void ctx.pruneRetainedJobs();
            ctx.pruneIntervalTimer = setInterval(() => {
                void ctx.pruneRetainedJobs();
            }, ctx.pruneIntervalMs());
            ctx.pruneIntervalTimer.unref?.();
        }, JOB_PRUNE_START_DELAY_MS);
        ctx.pruneStartTimer.unref?.();
}

export function clearRetentionPruneTimersExtracted(ctx: any): void {
        if (ctx.pruneStartTimer) {
            clearTimeout(ctx.pruneStartTimer);
            ctx.pruneStartTimer = undefined;
        }
        if (ctx.pruneIntervalTimer) {
            clearInterval(ctx.pruneIntervalTimer);
            ctx.pruneIntervalTimer = undefined;
        }
}

export function collectProtectedJobIdsExtracted(ctx: any): Set<string> {
        const protectedIds = new Set<string>();
        for (const job of ctx.jobs.values()) {
            if (!isQaapJobFinished(job.state)) {
                protectedIds.add(job.id);
                for (const dep of job.dependsOn) {
                    protectedIds.add(dep);
                }
            }
        }
        return protectedIds;
}

export function removeJobRecordExtracted(ctx: any, id: string): void {
        const job = ctx.jobs.get(id);
        ctx.jobs.delete(id);
        ctx.requests.delete(id);
        ctx.logs.delete(id);
        ctx.results.delete(id);
        if (job?.idempotencyKey) {
            ctx.idempotencyIndex.delete(ctx.ownerIdempotencyKey(job.ownerLogin, job.idempotencyKey));
        }
}

export function removeGraphRecordExtracted(ctx: any, id: string): void {
        const persisted = ctx.graphs.get(id);
        ctx.graphs.delete(id);
        if (persisted?.graph.idempotencyKey) {
            ctx.graphIdempotencyIndex.delete(
                ctx.ownerIdempotencyKey(persisted.graph.ownerLogin, persisted.graph.idempotencyKey),
            );
        }
}


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
import { MAX_FUNCTION_RESULT_CHARS } from './qaap-job-runtime';
import { QaapJobRequestError } from './qaap-job-runtime';

export function assertAcyclicGraphExtracted(ctx: any, dependenciesByKey: ReadonlyMap<string, readonly string[]>): void {
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

export function jobsForGraphExtracted(ctx: any, graph: QaapJobGraph): Record<string, QaapJob> {
        const result: Record<string, QaapJob> = {};
        for (const [key, id] of Object.entries(graph.jobsByKey)) {
            const job = ctx.jobs.get(id);
            if (job) {
                result[key] = job;
            }
        }
        return result;
}

export function drainQueueExtracted(ctx: any): void {
        if (ctx.draining || ctx.stopping) {
            return;
        }
        ctx.draining = true;
        try {
            while (true) {
                for (const job of ctx.jobs.values()) {
                    if (job.state === 'retry_wait') {
                        if ((job.nextAttemptAt ?? 0) <= Date.now()) {
                            const queued = ctx.replaceJob(job.id, { state: 'queued', nextAttemptAt: undefined });
                            ctx.onDidChangeJobEmitter.fire({ type: 'changed', job: queued });
                        } else {
                            ctx.scheduleRetryWake(job);
                        }
                        continue;
                    }
                    if (job.state !== 'waiting' && job.state !== 'queued') {
                        continue;
                    }
                    const dependencyStates = job.dependsOn.map(id => ctx.jobs.get(id)?.state);
                    if (dependencyStates.some(state => state === undefined || (isQaapJobFinished(state) && !didQaapJobSucceed(state)))) {
                        ctx.finishJob(job.id, 'dependency_failed');
                        continue;
                    }
                    if (dependencyStates.some(state => state !== 'succeeded')) {
                        if (job.state !== 'waiting') {
                            const waiting = ctx.replaceJob(job.id, { state: 'waiting' });
                            ctx.onDidChangeJobEmitter.fire({ type: 'changed', job: waiting });
                        }
                        continue;
                    }
                    if (job.state !== 'queued') {
                        const queued = ctx.replaceJob(job.id, { state: 'queued' });
                        ctx.onDidChangeJobEmitter.fire({ type: 'changed', job: queued });
                    }
                }

                // Pick one job at a time and re-rank after every start. Owners with fewer active
                // jobs go first, preventing one deep queue from consuming every global slot.
                const runningByOwner = new Map<string, number>();
                for (const running of ctx.jobs.values()) {
                    if (running.state === 'running') {
                        const owner = running.ownerLogin ?? '';
                        runningByOwner.set(owner, (runningByOwner.get(owner) ?? 0) + 1);
                    }
                }
                const candidates = [...ctx.jobs.values()]
                    .filter(job => job.state === 'queued')
                    .sort((left, right) => {
                        const load = (runningByOwner.get(left.ownerLogin ?? '') ?? 0)
                            - (runningByOwner.get(right.ownerLogin ?? '') ?? 0);
                        return load || left.createdAt - right.createdAt;
                    });
                const candidate = candidates.find(job => ctx.canStart(job));
                if (!candidate) {
                    break;
                }
                const running = ctx.replaceJob(candidate.id, {
                    state: 'running',
                    startedAt: candidate.startedAt ?? Date.now(),
                    attempt: candidate.attempt + 1,
                    nextAttemptAt: undefined,
                    finishedAt: undefined,
                    exitCode: undefined,
                });
                ctx.appendOutput(running.id, nls.localize(
                    'qaap/jobs/attemptStartedLog',
                    '\n[qaap] Starting attempt {0} of {1}.\n',
                    String(running.attempt),
                    String(running.retryPolicy?.maxAttempts ?? 1),
                ));
                ctx.onDidChangeJobEmitter.fire({ type: 'changed', job: running });
                void ctx.persist();
                ctx.runJob(running);
            }
        } finally {
            ctx.draining = false;
        }
}

export function canStartExtracted(ctx: any, candidate: QaapJob): boolean {
        const running = [...ctx.jobs.values()].filter(job => job.state === 'running');
        if (running.length >= ctx.maxConcurrentJobs()) {
            return false;
        }
        if (running.filter(job => job.ownerLogin === candidate.ownerLogin).length >= ctx.maxConcurrentJobsPerUser()) {
            return false;
        }
        if (running.filter(job => job.resourceClass === candidate.resourceClass).length >= ctx.resourceLimit(candidate.resourceClass)) {
            return false;
        }
        const sameWorkspace = running.filter(job => path.resolve(job.cwd) === path.resolve(candidate.cwd));
        if (candidate.workspaceAccess === 'read' && ctx.hasEarlierQueuedWriter(candidate)) {
            return false;
        }
        return candidate.workspaceAccess === 'read'
            ? sameWorkspace.every(job => job.workspaceAccess === 'read')
            : sameWorkspace.length === 0;
}

export function hasEarlierQueuedWriterExtracted(ctx: any, candidate: QaapJob): boolean {
        for (const job of ctx.jobs.values()) {
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

export function runJobExtracted(ctx: any, job: QaapJob): void {
        if (job.kind === 'function') {
            ctx.runFunctionJob(job);
        } else {
            ctx.runCommandJob(job);
        }
}

export function runCommandJobExtracted(ctx: any, job: QaapJob): void {
        try {
            if (!job.command) {
                throw new Error('Command job has no command.');
            }
            const child = ctx.tenantSpawn.spawnPrepared(job.command, {
                cwd: job.cwd,
                env: ctx.buildChildEnv(job),
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: true,
            });
            ctx.processes.set(job.id, child);
            child.stdout?.on('data', chunk => ctx.appendOutput(job.id, String(chunk)));
            child.stderr?.on('data', chunk => ctx.appendOutput(job.id, String(chunk)));
            child.once('error', error => {
                ctx.appendOutput(job.id, `${error instanceof Error ? error.message : String(error)}\n`);
                ctx.handleAttemptFailure(job.id, 'failed');
            });
            child.once('close', code => {
                ctx.handleProcessClose(job.id, child, code);
            });
            ctx.startAttemptTimeout(job, () => {
                ctx.appendOutput(job.id, nls.localize('qaap/jobs/timedOutLog', '\nJob timed out.\n'));
                ctx.terminateProcessTree(job.id, child);
                ctx.handleAttemptFailure(job.id, 'timed_out');
            });
        } catch (error) {
            ctx.appendOutput(job.id, `${error instanceof Error ? error.message : String(error)}\n`);
            ctx.handleAttemptFailure(job.id, 'failed');
        }
}

export function runFunctionJobExtracted(ctx: any, job: QaapJob): void {
        const definition = job.functionId ? ctx.functionRegistry.get(job.functionId) : undefined;
        if (!definition) {
            ctx.appendOutput(job.id, `${nls.localize('qaap/jobs/functionNotFound', 'Job function was not found.')}\n`);
            ctx.handleAttemptFailure(job.id, 'failed');
            return;
        }
        const controller = new AbortController();
        ctx.abortControllers.set(job.id, controller);
        ctx.startAttemptTimeout(job, () => {
            ctx.appendOutput(job.id, nls.localize('qaap/jobs/timedOutLog', '\nJob timed out.\n'));
            controller.abort(new Error('Timed out'));
            ctx.handleAttemptFailure(job.id, 'timed_out');
        });
        void Promise.resolve()
            .then(() => definition.execute({
                jobId: job.id,
                cwd: job.cwd,
                ownerLogin: job.ownerLogin,
                signal: controller.signal,
                emitOutput: chunk => {
                    if (ctx.jobs.get(job.id)?.state === 'running') {
                        ctx.appendOutput(job.id, chunk);
                    }
                },
                resolveWorkspacePath: relativePath => ctx.resolveFunctionWorkspacePath(job.cwd, relativePath),
            }, job.input))
            .then(result => {
                if (ctx.jobs.get(job.id)?.state !== 'running') {
                    return;
                }
                ctx.assertJsonSize(result, MAX_FUNCTION_RESULT_CHARS, 'Function result');
                if (result !== undefined) {
                    ctx.results.set(job.id, result);
                }
                ctx.finishJob(job.id, 'succeeded');
                ctx.drainQueue();
            })
            .catch(error => {
                if (ctx.jobs.get(job.id)?.state !== 'running') {
                    return;
                }
                ctx.appendOutput(job.id, `${error instanceof Error ? error.message : String(error)}\n`);
                ctx.handleAttemptFailure(job.id, 'failed');
            });
}

export function startAttemptTimeoutExtracted(ctx: any, job: QaapJob, onTimeout: () => void): void {
        const timer = setTimeout(() => {
            if (ctx.jobs.get(job.id)?.state === 'running') {
                onTimeout();
            }
        }, job.timeoutMs);
        timer.unref?.();
        ctx.timeoutTimers.set(job.id, timer);
}

export function handleProcessCloseExtracted(ctx: any, id: string, child: ChildProcess, code: number | null): void {
        ctx.reapProcessGroupAfterExit(child);
        const terminationTimer = ctx.terminationTimers.get(id);
        if (terminationTimer) {
            clearTimeout(terminationTimer);
            ctx.terminationTimers.delete(id);
        }
        const current = ctx.jobs.get(id);
        if (current?.state !== 'running') {
            ctx.processes.delete(id);
            return;
        }
        if (code === 0) {
            ctx.finishJob(id, 'succeeded', 0);
            ctx.drainQueue();
        } else {
            ctx.handleAttemptFailure(id, 'failed', code ?? undefined);
        }
}

export function handleAttemptFailureExtracted(ctx: any, id: string, finalState: 'failed' | 'timed_out', exitCode?: number): void {
        const current = ctx.jobs.get(id);
        if (current?.state !== 'running') {
            return;
        }
        ctx.clearActiveAttempt(id);
        const policy = current.retryPolicy;
        if (policy && current.attempt < policy.maxAttempts) {
            const initialBackoffMs = policy.initialBackoffMs ?? 1_000;
            const multiplier = policy.multiplier ?? 2;
            const maxBackoffMs = policy.maxBackoffMs ?? 60_000;
            const delay = Math.min(
                maxBackoffMs,
                Math.round(initialBackoffMs * Math.pow(multiplier, Math.max(0, current.attempt - 1))),
            );
            const retrying = ctx.replaceJob(id, {
                state: 'retry_wait',
                nextAttemptAt: Date.now() + delay,
                exitCode,
            });
            ctx.appendOutput(id, nls.localize(
                'qaap/jobs/retryScheduledLog',
                '[qaap] Attempt {0} failed; retrying in {1} ms.\n',
                String(current.attempt),
                String(delay),
            ));
            ctx.onDidChangeJobEmitter.fire({ type: 'changed', job: retrying });
            ctx.scheduleRetryWake(retrying);
            void ctx.persist();
        } else {
            ctx.finishJob(id, finalState, exitCode);
        }
        ctx.drainQueue();
}

export function scheduleRetryWakeExtracted(ctx: any, job: QaapJob): void {
        if (ctx.retryTimers.has(job.id) || job.state !== 'retry_wait') {
            return;
        }
        const delay = Math.max(0, (job.nextAttemptAt ?? Date.now()) - Date.now());
        const timer = setTimeout(() => {
            ctx.retryTimers.delete(job.id);
            if (ctx.jobs.get(job.id)?.state === 'retry_wait') {
                ctx.drainQueue();
                void ctx.persist();
            }
        }, delay);
        timer.unref?.();
        ctx.retryTimers.set(job.id, timer);
}

export function appendOutputExtracted(ctx: any, id: string, chunk: string): void {
        const job = ctx.jobs.get(id);
        if (!job || !chunk) {
            return;
        }
        const max = ctx.maxLogChars();
        const previous = ctx.logs.get(id) ?? '';
        const combined = previous + chunk;
        const log = combined.length <= max
            ? combined
            : `${nls.localize(
                'qaap/jobs/logTruncated',
                '[... {0} earlier characters truncated ...]',
                String(combined.length - max),
            )}\n${combined.slice(-max)}`;
        ctx.logs.set(id, log);
        ctx.onDidChangeJobEmitter.fire({ type: 'output', job, chunk });
}

export function clearActiveAttemptExtracted(ctx: any, id: string): void {
        const timeoutTimer = ctx.timeoutTimers.get(id);
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            ctx.timeoutTimers.delete(id);
        }
        ctx.processes.delete(id);
        ctx.abortControllers.delete(id);
}

export function finishJobExtracted(ctx: any, id: string,
        state: Exclude<QaapJobState, 'waiting' | 'queued' | 'running' | 'retry_wait'>,
        exitCode?: number,): QaapJob | undefined {
        const current = ctx.jobs.get(id);
        if (!current || isQaapJobFinished(current.state)) {
            return current;
        }
        ctx.clearActiveAttempt(id);
        const retryTimer = ctx.retryTimers.get(id);
        if (retryTimer) {
            clearTimeout(retryTimer);
            ctx.retryTimers.delete(id);
        }
        const finished = ctx.replaceJob(id, {
            state,
            finishedAt: Date.now(),
            nextAttemptAt: undefined,
            ...(exitCode !== undefined ? { exitCode } : {}),
        });
        ctx.onDidChangeJobEmitter.fire({ type: 'changed', job: finished });
        void ctx.persist();
        return finished;
}

export function replaceJobExtracted(ctx: any, id: string, patch: Partial<QaapJob>): QaapJob {
        const current = ctx.jobs.get(id);
        if (!current) {
            throw new Error(`Unknown job: ${id}`);
        }
        const updated = { ...current, ...patch };
        ctx.jobs.set(id, updated);
        return updated;
}

export function terminateProcessTreeExtracted(ctx: any, id: string, child: ChildProcess): void {
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
        ctx.terminationTimers.set(id, escalation);
}

export function reapProcessGroupAfterExitExtracted(ctx: any, child: ChildProcess): void {
        if (!child.pid || globalThis.process.platform === 'win32') {
            return;
        }
        try {
            globalThis.process.kill(-child.pid, 'SIGKILL');
        } catch { /* no residual descendants */ }
}


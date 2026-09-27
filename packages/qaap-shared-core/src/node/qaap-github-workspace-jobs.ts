// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { randomBytes } from 'crypto';
import type {
    QaapGithubOpenRepositoryResponse,
    QaapGithubWorkspaceJob,
    QaapGithubWorkspaceJobPhase,
    QaapGithubWorkspaceJobRequest,
    QaapGithubWorkspaceJobState,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapWorkspaceProgressUpdate } from './qaap-git-clone-progress';

/** Handed to a job body: cancellation plus a progress sink. */
export interface QaapGithubWorkspaceJobContext {
    readonly signal: AbortSignal;
    report(update: QaapWorkspaceProgressUpdate): void;
    /** Replace the label once the repository is resolved (`owner/name`). */
    relabel(label: string): void;
}

/** A failure the job body wants surfaced verbatim, with an optional machine code. */
export class QaapGithubWorkspaceJobError extends Error {
    constructor(message: string, readonly code?: string) {
        super(message);
        this.name = 'QaapGithubWorkspaceJobError';
    }
}

export interface QaapGithubWorkspaceJobStartOptions {
    /**
     * Owner of the job. `undefined` makes the job reachable only through its unguessable id
     * (anonymous public clones share one login, so they must not be listable or joinable).
     */
    readonly ownerKey: string | undefined;
    readonly kind: QaapGithubWorkspaceJobRequest['kind'];
    readonly label: string;
    /** Running jobs with the same owner + key are joined instead of started twice. */
    readonly dedupeKey?: string;
    /** Maps a thrown error to the message stored on the failed job. */
    readonly describeError?: (err: unknown) => string;
}

interface QaapGithubWorkspaceJobRecord {
    id: string;
    ownerKey: string | undefined;
    dedupeKey: string | undefined;
    kind: QaapGithubWorkspaceJobRequest['kind'];
    label: string;
    state: QaapGithubWorkspaceJobState;
    phase: QaapGithubWorkspaceJobPhase;
    percent?: number;
    detail?: string;
    error?: string;
    errorCode?: string;
    result?: QaapGithubOpenRepositoryResponse;
    startedAt: number;
    updatedAt: number;
    readonly controller: AbortController;
    readonly done: Promise<void>;
}

/** Finished jobs stay readable this long so a poller (or a reloaded page) can see the outcome. */
const FINISHED_JOB_RETENTION_MS = 15 * 60_000;
/** Bound per owner so a client cannot grow the registry without limit. */
const MAX_JOBS_PER_OWNER = 20;
const MAX_RUNNING_JOBS_PER_OWNER = 4;

/**
 * In-memory registry of background repository imports. Jobs are owned by a user login and every
 * read/cancel is checked against it, so one tenant can never observe another tenant's imports even
 * on a shared backend. The registry is per backend process, which is also where the clone runs.
 */
@injectable()
export class QaapGithubWorkspaceJobRegistry {

    protected readonly jobs = new Map<string, QaapGithubWorkspaceJobRecord>();

    /** Overridable clock for tests. */
    protected now(): number {
        return Date.now();
    }

    start(
        options: QaapGithubWorkspaceJobStartOptions,
        body: (context: QaapGithubWorkspaceJobContext) => Promise<QaapGithubOpenRepositoryResponse>,
    ): QaapGithubWorkspaceJob {
        this.prune();
        if (options.ownerKey !== undefined && options.dedupeKey) {
            const running = this.findRunning(options.ownerKey, options.dedupeKey);
            if (running) {
                return this.snapshot(running);
            }
        }
        if (options.ownerKey !== undefined) {
            const owned = [...this.jobs.values()].filter(job => job.ownerKey === options.ownerKey);
            if (owned.filter(job => job.state === 'running').length >= MAX_RUNNING_JOBS_PER_OWNER) {
                throw new QaapGithubWorkspaceJobError(
                    'Too many repository imports are running. Wait for one to finish and try again.',
                    'too_many_imports',
                );
            }
            // Drop the oldest finished jobs beyond the per-owner bound.
            const finished = owned.filter(job => job.state !== 'running').sort((a, b) => a.updatedAt - b.updatedAt);
            while (owned.length >= MAX_JOBS_PER_OWNER && finished.length > 0) {
                const oldest = finished.shift()!;
                this.jobs.delete(oldest.id);
                owned.splice(owned.indexOf(oldest), 1);
            }
        }
        const controller = new AbortController();
        const startedAt = this.now();
        let resolveDone: () => void = () => undefined;
        const record: QaapGithubWorkspaceJobRecord = {
            id: randomBytes(16).toString('hex'),
            ownerKey: options.ownerKey,
            dedupeKey: options.dedupeKey?.toLowerCase(),
            kind: options.kind,
            label: options.label,
            state: 'running',
            phase: 'queued',
            startedAt,
            updatedAt: startedAt,
            controller,
            done: new Promise<void>(resolve => { resolveDone = resolve; }),
        };
        this.jobs.set(record.id, record);
        const context: QaapGithubWorkspaceJobContext = {
            signal: controller.signal,
            report: update => {
                if (record.state !== 'running') {
                    return;
                }
                record.phase = update.phase;
                if (typeof update.percent === 'number' && Number.isFinite(update.percent)) {
                    record.percent = Math.max(record.percent ?? 0, Math.min(100, Math.round(update.percent)));
                }
                if (update.detail !== undefined) {
                    record.detail = update.detail;
                }
                record.updatedAt = this.now();
            },
            relabel: label => {
                record.label = label;
                record.updatedAt = this.now();
            },
        };
        // Run on the next tick so the caller can answer the HTTP request with the initial snapshot.
        void Promise.resolve().then(() => body(context)).then(result => {
            // A body that finishes despite a late cancel produced a usable workspace: report success.
            record.state = 'succeeded';
            record.phase = 'ready';
            record.percent = 100;
            record.detail = undefined;
            record.result = result;
        }, err => {
            if (controller.signal.aborted) {
                record.state = 'cancelled';
                record.error = 'Import cancelled.';
            } else {
                record.state = 'failed';
                record.error = options.describeError ? options.describeError(err) : err instanceof Error ? err.message : String(err);
                record.errorCode = err instanceof QaapGithubWorkspaceJobError ? err.code : undefined;
            }
        }).finally(() => {
            record.updatedAt = this.now();
            resolveDone();
        });
        return this.snapshot(record);
    }

    get(ownerKey: string | undefined, id: string): QaapGithubWorkspaceJob | undefined {
        const record = this.accessible(ownerKey, id);
        return record ? this.snapshot(record) : undefined;
    }

    /** Running jobs plus recently finished ones, newest first. Anonymous callers list nothing. */
    list(ownerKey: string | undefined): QaapGithubWorkspaceJob[] {
        this.prune();
        if (ownerKey === undefined) {
            return [];
        }
        return [...this.jobs.values()]
            .filter(job => job.ownerKey === ownerKey)
            .sort((a, b) => b.startedAt - a.startedAt)
            .map(job => this.snapshot(job));
    }

    /** Request cancellation; resolves with the job once its body has settled. */
    async cancel(ownerKey: string | undefined, id: string): Promise<QaapGithubWorkspaceJob | undefined> {
        const record = this.accessible(ownerKey, id);
        if (!record) {
            return undefined;
        }
        if (record.state === 'running') {
            record.controller.abort();
            await record.done;
        }
        return this.snapshot(record);
    }

    /** Resolves when the job settled (tests and graceful callers). */
    async whenSettled(id: string): Promise<void> {
        await this.jobs.get(id)?.done;
    }

    protected accessible(ownerKey: string | undefined, id: string): QaapGithubWorkspaceJobRecord | undefined {
        const record = this.jobs.get(id);
        if (!record) {
            return undefined;
        }
        // Owned jobs are visible to their owner only; anonymous jobs to whoever holds the id.
        return record.ownerKey === ownerKey ? record : undefined;
    }

    protected findRunning(ownerKey: string, dedupeKey: string): QaapGithubWorkspaceJobRecord | undefined {
        const key = dedupeKey.toLowerCase();
        return [...this.jobs.values()].find(job =>
            job.state === 'running' && job.ownerKey === ownerKey && job.dedupeKey === key);
    }

    protected prune(): void {
        const cutoff = this.now() - FINISHED_JOB_RETENTION_MS;
        for (const [id, job] of this.jobs) {
            if (job.state !== 'running' && job.updatedAt < cutoff) {
                this.jobs.delete(id);
            }
        }
    }

    protected snapshot(record: QaapGithubWorkspaceJobRecord): QaapGithubWorkspaceJob {
        return {
            id: record.id,
            kind: record.kind,
            label: record.label,
            state: record.state,
            phase: record.phase,
            ...(record.percent !== undefined ? { percent: record.percent } : {}),
            ...(record.detail !== undefined ? { detail: record.detail } : {}),
            ...(record.error !== undefined ? { error: record.error } : {}),
            ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
            ...(record.result !== undefined ? { result: record.result } : {}),
            startedAt: record.startedAt,
            updatedAt: record.updatedAt,
        };
    }
}

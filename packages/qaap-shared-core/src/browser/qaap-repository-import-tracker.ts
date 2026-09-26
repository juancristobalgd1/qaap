// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, type Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';
import {
    cancelQaapGithubWorkspaceJob,
    cloneQaapGithubRepository,
    fetchQaapGithubWorkspaceJob,
    openQaapGithubRepository,
    startQaapGithubWorkspaceJob,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubOpenRepositoryResponse,
    QaapGithubWorkspaceJob,
    QaapGithubWorkspaceJobPhase,
    QaapGithubWorkspaceJobRequest,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

/** Server calls used by the tracker; injectable so the state machine is testable without HTTP. */
export interface QaapRepositoryImportApi {
    start(request: QaapGithubWorkspaceJobRequest): Promise<QaapGithubWorkspaceJob>;
    get(id: string): Promise<QaapGithubWorkspaceJob>;
    cancel(id: string): Promise<QaapGithubWorkspaceJob>;
    /** Single-request import for backends without `/workspace-jobs` (answered 404). */
    legacy(request: QaapGithubWorkspaceJobRequest): Promise<QaapGithubOpenRepositoryResponse>;
}

export const DEFAULT_QAAP_REPOSITORY_IMPORT_API: QaapRepositoryImportApi = {
    start: startQaapGithubWorkspaceJob,
    get: fetchQaapGithubWorkspaceJob,
    cancel: cancelQaapGithubWorkspaceJob,
    legacy: request => request.kind === 'open'
        ? openQaapGithubRepository(request.owner, request.name)
        : cloneQaapGithubRepository(request.repository),
};

export interface QaapRepositoryImportTimers {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    now(): number;
}

const DEFAULT_TIMERS: QaapRepositoryImportTimers = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
};

/** Poll interval while the job runs. */
export const QAAP_REPOSITORY_IMPORT_POLL_MS = 1000;
/** Consecutive failed polls (network blips, tenant restarts) tolerated before giving up. */
export const QAAP_REPOSITORY_IMPORT_MAX_POLL_FAILURES = 8;

/** Rejection of {@link QaapRepositoryImport.result}; `cancelled` distinguishes a user cancel. */
export class QaapRepositoryImportError extends Error {
    constructor(message: string, readonly cancelled = false, readonly code?: string) {
        super(message);
        this.name = 'QaapRepositoryImportError';
    }
}

/** Stable key of a request: two imports of the same repository share one job. */
export function repositoryImportKey(request: QaapGithubWorkspaceJobRequest): string {
    const raw = request.kind === 'open' ? `${request.owner}/${request.name}` : request.repository;
    return raw.trim().replace(/\.git$/i, '').replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/\/+$/, '').toLowerCase();
}

export function isRepositoryImportFinished(job: Pick<QaapGithubWorkspaceJob, 'state'>): boolean {
    return job.state !== 'running';
}

/** Short user-facing label of the current phase. */
export function describeRepositoryImportPhase(phase: QaapGithubWorkspaceJobPhase, kind: QaapGithubWorkspaceJob['kind']): string {
    switch (phase) {
        case 'queued':
        case 'resolving':
            return nls.localize('qaap/repositoryImport/phaseResolving', 'Checking repository on GitHub…');
        case 'preparing':
            return nls.localize('qaap/repositoryImport/phasePreparing', 'Preparing workspace…');
        case 'cloning':
            return kind === 'open'
                ? nls.localize('qaap/repositoryImport/phaseImporting', 'Downloading repository…')
                : nls.localize('qaap/repositoryImport/phaseCloning', 'Cloning repository…');
        case 'fetching':
            return nls.localize('qaap/repositoryImport/phaseFetching', 'Updating existing copy…');
        case 'checking-out':
            return nls.localize('qaap/repositoryImport/phaseCheckingOut', 'Writing files…');
        case 'finalizing':
            return nls.localize('qaap/repositoryImport/phaseFinalizing', 'Finishing…');
        case 'registering':
            return nls.localize('qaap/repositoryImport/phaseRegistering', 'Adding project…');
        case 'ready':
            return nls.localize('qaap/repositoryImport/phaseReady', 'Ready');
    }
    return nls.localize('qaap/repositoryImport/phaseWorking', 'Working…');
}

/** One-line status, e.g. `Cloning repository… 45%`. */
export function formatRepositoryImportStatus(job: QaapGithubWorkspaceJob): string {
    if (job.state === 'failed') {
        return job.error || nls.localize('qaap/repositoryImport/failed', 'The repository could not be imported.');
    }
    if (job.state === 'cancelled') {
        return nls.localize('qaap/repositoryImport/cancelled', 'Import cancelled.');
    }
    const phase = describeRepositoryImportPhase(job.phase, job.kind);
    return typeof job.percent === 'number' && job.state === 'running' ? `${phase} ${job.percent}%` : phase;
}

/** One running (or finished) repository import as seen by the browser. */
export class QaapRepositoryImport {

    protected readonly onDidChangeEmitter = new Emitter<QaapGithubWorkspaceJob>();
    readonly onDidChange: Event<QaapGithubWorkspaceJob> = this.onDidChangeEmitter.event;

    readonly result: Promise<QaapGithubOpenRepositoryResponse>;

    /**
     * Who presents this import: the open-repository dialog (`foreground`, opens the workspace when
     * done) or the snackbar after the dialog was closed (`background`, only lists the project).
     */
    presenter: 'foreground' | 'background' = 'foreground';
    /** Set once a background watcher is attached, so closing the dialog twice never doubles it. */
    backgroundWatched = false;

    protected current: QaapGithubWorkspaceJob;
    protected serverJobId: string | undefined;
    protected pollHandle: unknown;
    protected pollFailures = 0;
    protected cancelRequested = false;
    protected settled = false;
    protected resolveResult!: (value: QaapGithubOpenRepositoryResponse) => void;
    protected rejectResult!: (reason: QaapRepositoryImportError) => void;

    constructor(
        readonly request: QaapGithubWorkspaceJobRequest,
        label: string,
        protected readonly api: QaapRepositoryImportApi,
        protected readonly timers: QaapRepositoryImportTimers,
    ) {
        const now = timers.now();
        this.current = {
            id: '',
            kind: request.kind,
            label,
            state: 'running',
            phase: 'queued',
            startedAt: now,
            updatedAt: now,
        };
        this.result = new Promise<QaapGithubOpenRepositoryResponse>((resolve, reject) => {
            this.resolveResult = resolve;
            this.rejectResult = reject;
        });
        // Callers that only watch `onDidChange` must not trigger an unhandled rejection.
        this.result.catch(() => undefined);
    }

    get key(): string {
        return repositoryImportKey(this.request);
    }

    get job(): QaapGithubWorkspaceJob {
        return this.current;
    }

    get running(): boolean {
        return !this.settled;
    }

    /** Begin the import; called once by the tracker. */
    async begin(): Promise<void> {
        let job: QaapGithubWorkspaceJob;
        try {
            job = await this.api.start(this.request);
        } catch (err) {
            if (this.isMissingJobsApi(err)) {
                await this.runLegacy();
                return;
            }
            this.fail(err);
            return;
        }
        this.serverJobId = job.id;
        this.accept(job);
        if (this.cancelRequested && !this.settled) {
            await this.cancel();
            return;
        }
        this.schedulePoll();
    }

    /** Ask the server to stop. Resolves once the job has settled (or immediately in legacy mode). */
    async cancel(): Promise<void> {
        if (this.settled) {
            return;
        }
        this.cancelRequested = true;
        if (!this.serverJobId) {
            // Still starting (or legacy single request): stop watching; the start path re-checks.
            if (this.current.id === 'legacy') {
                this.finish({ ...this.current, state: 'cancelled', error: undefined });
            }
            return;
        }
        this.clearPoll();
        try {
            this.accept(await this.api.cancel(this.serverJobId));
        } catch (err) {
            this.fail(err);
            return;
        }
        if (!this.settled) {
            this.schedulePoll();
        }
    }

    dispose(): void {
        this.clearPoll();
        this.onDidChangeEmitter.dispose();
    }

    protected isMissingJobsApi(err: unknown): boolean {
        const status = (err as { status?: unknown } | undefined)?.status;
        return status === 404 || status === 405;
    }

    protected async runLegacy(): Promise<void> {
        this.update({ ...this.current, id: 'legacy', phase: 'cloning', percent: undefined });
        try {
            const result = await this.api.legacy(this.request);
            if (this.settled) {
                return;
            }
            this.finish({
                ...this.current,
                state: 'succeeded',
                phase: 'ready',
                percent: 100,
                label: result.repository.fullName,
                result,
            });
        } catch (err) {
            if (!this.settled) {
                this.fail(err);
            }
        }
    }

    protected schedulePoll(): void {
        if (this.settled) {
            return;
        }
        this.clearPoll();
        this.pollHandle = this.timers.setTimeout(() => {
            this.pollHandle = undefined;
            void this.poll();
        }, QAAP_REPOSITORY_IMPORT_POLL_MS);
    }

    protected clearPoll(): void {
        if (this.pollHandle !== undefined) {
            this.timers.clearTimeout(this.pollHandle);
            this.pollHandle = undefined;
        }
    }

    protected async poll(): Promise<void> {
        if (this.settled || !this.serverJobId) {
            return;
        }
        try {
            const job = await this.api.get(this.serverJobId);
            this.pollFailures = 0;
            this.accept(job);
        } catch (err) {
            const status = (err as { status?: unknown } | undefined)?.status;
            if (status === 404) {
                // The backend restarted (jobs are in memory) or the job expired.
                this.fail(new QaapRepositoryImportError(nls.localize(
                    'qaap/repositoryImport/lost',
                    'The server lost track of this import (it may have restarted). Try again.'
                )));
                return;
            }
            this.pollFailures += 1;
            if (this.pollFailures >= QAAP_REPOSITORY_IMPORT_MAX_POLL_FAILURES) {
                this.fail(new QaapRepositoryImportError(nls.localize(
                    'qaap/repositoryImport/unreachable',
                    'Lost the connection to the server while importing. Check your connection and try again.'
                )));
                return;
            }
        }
        this.schedulePoll();
    }

    protected accept(job: QaapGithubWorkspaceJob): void {
        if (this.settled) {
            return;
        }
        if (isRepositoryImportFinished(job)) {
            this.finish(job);
            return;
        }
        // Never let a late or reordered poll move the bar backwards.
        const percent = typeof job.percent === 'number'
            ? Math.max(job.percent, this.current.percent ?? 0)
            : this.current.percent;
        this.update({ ...job, percent });
    }

    protected finish(job: QaapGithubWorkspaceJob): void {
        this.clearPoll();
        this.settled = true;
        this.update(job);
        if (job.state === 'succeeded' && job.result) {
            this.resolveResult(job.result);
        } else if (job.state === 'cancelled') {
            this.rejectResult(new QaapRepositoryImportError(formatRepositoryImportStatus(job), true));
        } else {
            this.rejectResult(new QaapRepositoryImportError(
                job.error || nls.localize('qaap/repositoryImport/failed', 'The repository could not be imported.'),
                false,
                job.errorCode,
            ));
        }
    }

    protected fail(err: unknown): void {
        if (this.settled) {
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: unknown } | undefined)?.code;
        this.finish({
            ...this.current,
            state: 'failed',
            error: message,
            errorCode: typeof code === 'string' ? code : undefined,
            updatedAt: this.timers.now(),
        });
    }

    protected update(job: QaapGithubWorkspaceJob): void {
        this.current = job;
        this.onDidChangeEmitter.fire(job);
    }
}

/**
 * Browser-side registry of repository imports. Owns polling so a closed dialog never stops
 * progress tracking, and joins a second request for a repository that is already importing.
 */
export class QaapRepositoryImportTracker {

    protected readonly imports = new Map<string, QaapRepositoryImport>();
    protected readonly onDidChangeEmitter = new Emitter<QaapRepositoryImport>();
    /** Fires on every progress update of any import. */
    readonly onDidChange: Event<QaapRepositoryImport> = this.onDidChangeEmitter.event;

    constructor(
        protected readonly api: QaapRepositoryImportApi = DEFAULT_QAAP_REPOSITORY_IMPORT_API,
        protected readonly timers: QaapRepositoryImportTimers = DEFAULT_TIMERS,
    ) { }

    /** Start an import, or return the one already running for the same repository. */
    start(request: QaapGithubWorkspaceJobRequest, label: string): QaapRepositoryImport {
        const key = repositoryImportKey(request);
        const existing = this.imports.get(key);
        if (existing?.running) {
            return existing;
        }
        existing?.dispose();
        const repositoryImport = new QaapRepositoryImport(request, label, this.api, this.timers);
        this.imports.set(key, repositoryImport);
        repositoryImport.onDidChange(() => this.onDidChangeEmitter.fire(repositoryImport));
        void repositoryImport.begin();
        return repositoryImport;
    }

    get(request: QaapGithubWorkspaceJobRequest): QaapRepositoryImport | undefined {
        return this.imports.get(repositoryImportKey(request));
    }

    /** Imports that are still running, oldest first. */
    running(): QaapRepositoryImport[] {
        return [...this.imports.values()].filter(candidate => candidate.running);
    }

    /** Forget a finished import (e.g. after its outcome was shown). */
    forget(repositoryImport: QaapRepositoryImport): void {
        if (repositoryImport.running) {
            return;
        }
        if (this.imports.get(repositoryImport.key) === repositoryImport) {
            this.imports.delete(repositoryImport.key);
        }
        repositoryImport.dispose();
    }
}

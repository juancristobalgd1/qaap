// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event, nls } from '@theia/core';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_REVIEW_DIFF_CAP_CHARS } from '../common/qaap-agent-review';
import { QaapWorkflowDef, QaapWorkflowNodeOutcome, validateQaapWorkflowDef } from '../common/qaap-workflow-ir';
import {
    QaapWorkflowRun,
    QaapWorkflowRunBudget,
    advanceQaapWorkflowRun,
    expireQaapWorkflowRun,
    startQaapWorkflowRun,
} from '../common/qaap-workflow-run';
import { writeJsonAtomic } from './qaap-write-json-atomic';

const STORE_MODE = 0o700;
const INDEX_MODE = 0o600;
const MAX_RUNS_PER_OWNER = 200;
/**
 * Hard cap per stored artifact. Producers already cap at what a prompt can carry; this is the
 * store's own guarantee that one enormous change cannot grow the shared run index without bound.
 */
const MAX_ARTIFACT_CHARS = DEFAULT_REVIEW_DIFF_CAP_CHARS;

/**
 * The definition travels with the run: defs are immutable `id@version` and are not stored
 * anywhere else, so a run must stay replayable even if its template is edited or deleted.
 */
/** Where a dispatched node is actually executing, so terminal events can be routed back. */
export interface QaapWorkflowDispatchedNode {
    readonly nodeId: string;
    /** Agent task id or job id, depending on `kind`. */
    readonly externalId: string;
    readonly kind: 'agent' | 'job';
    readonly dispatchedAt: number;
}

export interface QaapPersistedWorkflowRun {
    readonly run: QaapWorkflowRun;
    readonly def: QaapWorkflowDef;
    readonly ownerLogin: string;
    /** Absolute working directory every node of this run executes in. */
    readonly cwd: string;
    /** Values a node's `promptRef` template resolves against, e.g. the user's task text. */
    readonly inputs: Readonly<Record<string, string>>;
    /**
     * Commit the repository was on when the run started. Everything after it is this run's change,
     * committed or not — agents are told to work toward a PR, so many of them commit.
     */
    readonly baseRef?: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    /** Node id → its live execution. Persisted so a restart can still map events back to nodes. */
    readonly dispatched: Readonly<Record<string, QaapWorkflowDispatchedNode>>;
    /**
     * Text a deterministic node produced for later `promptRef` templates (the captured diff, say),
     * keyed by the producing node's `artifactKey`. Server-side like `cwd` and `inputs`: it is
     * working-tree content and never reaches the run summary the HTTP API returns.
     */
    readonly artifacts: Readonly<Record<string, string>>;
}

interface PersistedWorkflowRunIndex {
    readonly version: 1;
    readonly runs: readonly QaapPersistedWorkflowRun[];
}

export interface QaapWorkflowDispatchResult {
    readonly record: QaapPersistedWorkflowRun;
    /** Nodes the caller must now start on the job runtime or the agent task runner. */
    readonly dispatch: readonly string[];
}

export interface QaapStartWorkflowRunOptions {
    /** Absolute working directory every node runs in. */
    readonly cwd: string;
    readonly ownerLogin?: string;
    /** Template values for `promptRef` resolution, e.g. `{ task: 'fix the login bug' }`. */
    readonly inputs?: Readonly<Record<string, string>>;
    /** Commit the repository is on right now; the run's change is measured against it. */
    readonly baseRef?: string;
    readonly budget?: QaapWorkflowRunBudget;
}

export class QaapWorkflowRunRequestError extends Error { }

/**
 * Durable, owner-scoped storage for workflow runs.
 *
 * The store owns persistence and the pure reducer; it never spawns anything. Callers dispatch the
 * returned node ids to the appropriate runtime and report each outcome back through
 * {@link report} or {@link interrupt}, which is what makes a run survive a backend restart.
 */
@injectable()
export class QaapWorkflowRunStore {

    protected readonly records = new Map<string, QaapPersistedWorkflowRun>();
    protected mutationChain: Promise<void> = Promise.resolve();
    protected readonly onDidChangeEmitter = new Emitter<QaapPersistedWorkflowRun>();
    readonly onDidChange: Event<QaapPersistedWorkflowRun> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        try {
            fs.mkdirSync(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
            fs.chmodSync(this.storeDirectory(), STORE_MODE);
            this.restoreFromDisk();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-workflow-runs] failed to restore run index:', error);
            }
        }
    }

    list(ownerLogin?: string): QaapPersistedWorkflowRun[] {
        const owner = this.normalizeOwner(ownerLogin);
        return [...this.records.values()]
            .filter(record => record.ownerLogin === owner)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map(record => this.clone(record));
    }

    get(ownerLogin: string | undefined, runId: string): QaapPersistedWorkflowRun | undefined {
        const record = this.records.get(runId);
        return record?.ownerLogin === this.normalizeOwner(ownerLogin) ? this.clone(record) : undefined;
    }

    /**
     * Runs that still hold dispatched nodes. On boot the caller reconciles each one against the
     * job runtime and the agent task runner, reporting dead nodes through {@link interrupt}.
     */
    listUnfinished(ownerLogin?: string): QaapPersistedWorkflowRun[] {
        return this.list(ownerLogin).filter(record => this.isUnfinished(record));
    }

    /**
     * Every tenant's unfinished runs. Backend-internal: boot reconciliation must see all owners,
     * and `listUnfinished()` without an argument only sees the anonymous bucket. Never expose this
     * through an HTTP endpoint — it crosses tenant boundaries by design.
     */
    listAllUnfinished(): QaapPersistedWorkflowRun[] {
        return [...this.records.values()]
            .filter(record => this.isUnfinished(record))
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map(record => this.clone(record));
    }

    protected isUnfinished(record: QaapPersistedWorkflowRun): boolean {
        return record.run.status === 'running' || record.run.status === 'awaiting-human';
    }

    start(def: QaapWorkflowDef, options: QaapStartWorkflowRunOptions): Promise<QaapWorkflowDispatchResult> {
        const { ownerLogin, budget } = options;
        return this.mutate(records => {
            const validation = validateQaapWorkflowDef(def);
            if (!validation.ok) {
                throw new QaapWorkflowRunRequestError(nls.localize(
                    'qaap/workflowRuns/invalidDefinition',
                    'Invalid workflow definition: {0}',
                    validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
                ));
            }
            const owner = this.normalizeOwner(ownerLogin);
            if (records.filter(record => record.ownerLogin === owner).length >= MAX_RUNS_PER_OWNER) {
                throw new QaapWorkflowRunRequestError(nls.localize(
                    'qaap/workflowRuns/limit', 'You can keep at most {0} workflow runs.', String(MAX_RUNS_PER_OWNER),
                ));
            }
            const started = startQaapWorkflowRun(def, { runId: randomUUID(), budget });
            const now = this.now();
            const record: QaapPersistedWorkflowRun = {
                run: started.run,
                def,
                ownerLogin: owner,
                cwd: options.cwd,
                inputs: options.inputs ?? {},
                ...(options.baseRef ? { baseRef: options.baseRef } : {}),
                createdAt: now,
                updatedAt: now,
                dispatched: {},
                artifacts: {},
            };
            return { records: [...records, record], result: { record, dispatch: started.dispatch } };
        }, result => result.record);
    }

    /** Report the outcome of a dispatched node and return whatever must start next. */
    report(
        ownerLogin: string | undefined,
        runId: string,
        nodeId: string,
        outcome: QaapWorkflowNodeOutcome,
        bindingRef?: string,
        /** Text this node produced for later prompts, stored under the node's `artifactKey`. */
        artifact?: { readonly key: string; readonly value: string },
    ): Promise<QaapWorkflowDispatchResult> {
        return this.mutate(records => {
            const owner = this.normalizeOwner(ownerLogin);
            const index = records.findIndex(entry => entry.run.id === runId && entry.ownerLogin === owner);
            if (index < 0) {
                throw new QaapWorkflowRunRequestError(nls.localize(
                    'qaap/workflowRuns/notFound', 'Workflow run {0} was not found.', runId,
                ));
            }
            const previous = records[index];
            if (!previous.run.active.includes(nodeId)) {
                // Duplicate or stale report (retried webhook, restart race): keep state, dispatch nothing.
                return { records, result: { record: this.clone(previous), dispatch: [] } };
            }
            const advanced = advanceQaapWorkflowRun(previous.def, previous.run, nodeId, outcome, bindingRef);
            const dispatched = { ...previous.dispatched };
            delete dispatched[nodeId];
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                run: advanced.run,
                dispatched,
                artifacts: artifact
                    ? { ...previous.artifacts, [artifact.key]: artifact.value.slice(0, MAX_ARTIFACT_CHARS) }
                    : previous.artifacts,
                updatedAt: this.now(),
            };
            const next = [...records];
            next[index] = record;
            return { records: next, result: { record, dispatch: advanced.dispatch } };
        }, result => result.record);
    }

    /** Record where a dispatched node is executing, so its terminal event can be routed back. */
    attachDispatch(
        ownerLogin: string | undefined,
        runId: string,
        nodeId: string,
        kind: 'agent' | 'job',
        externalId: string,
    ): Promise<QaapPersistedWorkflowRun> {
        return this.mutate(records => {
            const owner = this.normalizeOwner(ownerLogin);
            const index = records.findIndex(entry => entry.run.id === runId && entry.ownerLogin === owner);
            if (index < 0) {
                throw new QaapWorkflowRunRequestError(nls.localize(
                    'qaap/workflowRuns/notFound', 'Workflow run {0} was not found.', runId,
                ));
            }
            const previous = records[index];
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                dispatched: {
                    ...previous.dispatched,
                    [nodeId]: { nodeId, externalId, kind, dispatchedAt: this.now() },
                },
                updatedAt: this.now(),
            };
            const next = [...records];
            next[index] = record;
            return { records: next, result: record };
        }, result => result);
    }

    /** Resolve the run and node a job or agent-task id belongs to. */
    findByExternalId(externalId: string): { readonly record: QaapPersistedWorkflowRun; readonly nodeId: string } | undefined {
        for (const record of this.records.values()) {
            for (const entry of Object.values(record.dispatched)) {
                if (entry.externalId === externalId) {
                    return { record: this.clone(record), nodeId: entry.nodeId };
                }
            }
        }
        return undefined;
    }

    /**
     * Report that a dispatched node lost its process — an agent task restored as `interrupted`,
     * or a job that came back `interrupted` after a backend restart. Routed as a `fail` outcome so
     * the graph's own failure edges decide what happens, instead of hanging on a dead node.
     */
    interrupt(ownerLogin: string | undefined, runId: string, nodeId: string): Promise<QaapWorkflowDispatchResult> {
        return this.report(ownerLogin, runId, nodeId, 'fail');
    }

    /**
     * End a run that outlived its wall clock. Terminal on purpose — unlike a timed-out NODE, which
     * routes the graph's failure edge, an expired run has no branch left worth taking.
     */
    async expire(ownerLogin: string | undefined, runId: string): Promise<QaapPersistedWorkflowRun | undefined> {
        const record = await this.mutate<QaapPersistedWorkflowRun | undefined>(records => {
            const owner = this.normalizeOwner(ownerLogin);
            const index = records.findIndex(entry => entry.run.id === runId && entry.ownerLogin === owner);
            if (index < 0) {
                return { records, result: undefined };
            }
            const previous = records[index];
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                run: expireQaapWorkflowRun(previous.run),
                dispatched: {},
                updatedAt: this.now(),
            };
            const next = [...records];
            next[index] = record;
            return { records: next, result: record };
        });
        if (record) {
            this.onDidChangeEmitter.fire(this.clone(record));
        }
        return record;
    }

    protected async persist(records: readonly QaapPersistedWorkflowRun[]): Promise<void> {
        await fsp.mkdir(this.storeDirectory(), { recursive: true, mode: STORE_MODE });
        const index: PersistedWorkflowRunIndex = { version: 1, runs: records };
        await writeJsonAtomic(this.indexPath(), index, { mode: INDEX_MODE });
    }

    protected restoreFromDisk(): void {
        let raw: string;
        try {
            raw = fs.readFileSync(this.indexPath(), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
            return;
        }
        const parsed = JSON.parse(raw) as Partial<PersistedWorkflowRunIndex>;
        if (parsed?.version !== 1 || !Array.isArray(parsed.runs)) {
            console.warn('[qaap-workflow-runs] ignoring unreadable run index.');
            return;
        }
        this.records.clear();
        for (const record of parsed.runs) {
            if (record?.run?.id && record.def) {
                // `dispatched`, `cwd` and `inputs` were added after the first runs were written;
                // default them rather than dropping otherwise valid rows.
                this.records.set(record.run.id, {
                    ...record,
                    dispatched: record.dispatched ?? {},
                    cwd: record.cwd ?? '',
                    inputs: record.inputs ?? {},
                    artifacts: record.artifacts ?? {},
                });
            }
        }
    }

    protected mutate<T>(
        apply: (records: readonly QaapPersistedWorkflowRun[]) => { records: readonly QaapPersistedWorkflowRun[]; result: T },
        changed?: (result: T) => QaapPersistedWorkflowRun,
    ): Promise<T> {
        const run = this.mutationChain.then(async () => {
            const { records, result } = apply([...this.records.values()]);
            await this.persist(records);
            this.records.clear();
            for (const record of records) {
                this.records.set(record.run.id, record);
            }
            return result;
        });
        // Keep the chain alive even when this mutation rejects, so one bad request cannot wedge the store.
        this.mutationChain = run.then(() => undefined, () => undefined);
        return run.then(result => {
            if (changed) {
                this.onDidChangeEmitter.fire(changed(result));
            }
            return result;
        });
    }

    protected normalizeOwner(ownerLogin?: string): string {
        return ownerLogin?.trim().toLowerCase() ?? '';
    }

    protected clone(record: QaapPersistedWorkflowRun): QaapPersistedWorkflowRun {
        return JSON.parse(JSON.stringify(record)) as QaapPersistedWorkflowRun;
    }

    protected now(): number {
        return Date.now();
    }

    protected storeDirectory(): string {
        return process.env.QAAP_WORKFLOW_RUN_STATE_DIR?.trim() || path.join(os.homedir(), '.qaap', 'workflow-runs');
    }

    protected indexPath(): string {
        return path.join(this.storeDirectory(), 'index.json');
    }
}

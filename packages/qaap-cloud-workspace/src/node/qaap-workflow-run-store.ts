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
    DEFAULT_QAAP_WORKFLOW_RUN_BUDGET,
    QaapWorkflowRun,
    QaapWorkflowRunBudget,
    advanceQaapWorkflowRun,
    expireQaapWorkflowRun,
    startQaapWorkflowRun,
} from '../common/qaap-workflow-run';
import { appendQaapWorkflowTrace, QaapWorkflowTraceEntry } from '../common/qaap-workflow-trace';
import { writeJsonAtomic } from './qaap-write-json-atomic';

const STORE_MODE = 0o700;
const INDEX_MODE = 0o600;
const MAX_RUNS_PER_OWNER = 200;
/**
 * Hard cap per stored artifact. Producers already cap at what a prompt can carry; this is the
 * store's own guarantee that one enormous change cannot grow the shared run index without bound.
 */
const MAX_ARTIFACT_CHARS = DEFAULT_REVIEW_DIFF_CAP_CHARS;
/** A creator that cannot publish an external id within this window has lost its claim. */
export const QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS = 30_000;

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

/**
 * Durable ownership of the create side-effect for one node visit.
 *
 * The external id does not exist yet, so this is deliberately separate from `dispatched`. A
 * concurrent replay that sees the claim waits for its owner to publish the id instead of spawning
 * a second agent for the same visit.
 */
export interface QaapWorkflowDispatchClaim {
    readonly nodeId: string;
    readonly visit: number;
    readonly kind: 'agent' | 'job';
    readonly claimId: string;
    readonly claimedAt: number;
}

export type QaapWorkflowDispatchClaimResult =
    | { readonly status: 'claimed' }
    | { readonly status: 'pending'; readonly claimId: string }
    | { readonly status: 'attached'; readonly externalId: string };

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
    /**
     * The run's declared success check: the npm script that decides whether its goal is met. Absent
     * means "whatever this repository verifies with", which is the pre-goal behaviour.
     */
    readonly goalCheckScript?: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    /** Node id → its live execution. Persisted so a restart can still map events back to nodes. */
    readonly dispatched: Readonly<Record<string, QaapWorkflowDispatchedNode>>;
    /** Node id → durable create claim held until its external id is attached. */
    readonly dispatchClaims: Readonly<Record<string, QaapWorkflowDispatchClaim>>;
    /**
     * Text a deterministic node produced for later `promptRef` templates (the captured diff, say),
     * keyed by the producing node's `artifactKey`. Server-side like `cwd` and `inputs`: it is
     * working-tree content and never reaches the run summary the HTTP API returns.
     */
    readonly artifacts: Readonly<Record<string, string>>;
    /**
     * Node id → the backend that ran it, kept for the whole run. An adversarial review is only
     * adversarial if a DIFFERENT model performs it, and the judge starts long after the writer's
     * dispatch entry is gone.
     */
    readonly routedAgents: Readonly<Record<string, string>>;
    /** What the run actually did, node by node — the answer to "why did this end like this?". */
    readonly trace: readonly QaapWorkflowTraceEntry[];
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
    /** npm script that must exit 0 for this run's goal to count as met. */
    readonly goalCheckScript?: string;
    readonly budget?: QaapWorkflowRunBudget;
}

export class QaapWorkflowRunRequestError extends Error { }

/** How an existing unit of work is adopted into a run mid-life (ADR-002 chat-turn adoption). */
export interface QaapAdoptWorkflowRunOptions {
    /** Absolute working directory every node runs in. */
    readonly cwd: string;
    readonly ownerLogin?: string;
    /** Correlation values, e.g. `{ conversationId, rootUserMessageId }` for chat turns. */
    readonly inputs?: Readonly<Record<string, string>>;
    /** Node the adopted run is parked on: active, already counted as visited. */
    readonly seedNodeId: string;
    /**
     * Visits already spent on the seed node before adoption (>= 1). For a chat turn this is
     * 1 + the restart resumes the imperative projection already recorded, so the run's ledger
     * carries the ceiling across governance changes.
     */
    readonly seedVisits: number;
    /** External process the node was attached to when the backend died, when known. */
    readonly deadExternalId?: string;
    readonly deadKind?: 'agent' | 'job';
    /** When the dead process was originally dispatched; defaults to adoption time. */
    readonly dispatchedAt?: number;
    readonly budget?: QaapWorkflowRunBudget;
}

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
                ...(options.goalCheckScript ? { goalCheckScript: options.goalCheckScript } : {}),
                createdAt: now,
                updatedAt: now,
                dispatched: {},
                dispatchClaims: {},
                artifacts: {},
                routedAgents: {},
                trace: [],
            };
            return { records: [...records, record], result: { record, dispatch: started.dispatch } };
        }, result => result.record);
    }

    /**
     * Adopt an ALREADY-RUNNING unit of work into a run parked on one node (ADR-002). Unlike
     * {@link start}, nothing is dispatched: the seed node is active with its visits pre-counted,
     * optionally attached to the dead external process it was running as, and the caller's next
     * step is reporting an outcome for it (`resume:restart` after a restart, a terminal otherwise).
     * Persisted before the promise resolves, like every other mutation.
     */
    adoptRun(def: QaapWorkflowDef, options: QaapAdoptWorkflowRunOptions): Promise<QaapPersistedWorkflowRun> {
        return this.mutate(records => {
            const validation = validateQaapWorkflowDef(def);
            if (!validation.ok) {
                throw new QaapWorkflowRunRequestError(nls.localize(
                    'qaap/workflowRuns/invalidDefinition',
                    'Invalid workflow definition: {0}',
                    validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
                ));
            }
            if (!def.nodes.some(node => node.id === options.seedNodeId)) {
                throw new QaapWorkflowRunRequestError(`Adopted node "${options.seedNodeId}" is not declared by "${def.id}".`);
            }
            const owner = this.normalizeOwner(options.ownerLogin);
            let next = [...records];
            if (next.filter(record => record.ownerLogin === owner).length >= MAX_RUNS_PER_OWNER) {
                // Adoption is lifecycle bookkeeping the user never asked to budget: reap the
                // oldest FINISHED run of the same definition before giving up like start() does.
                const reapable = next
                    .filter(record => record.ownerLogin === owner
                        && record.def.id === def.id
                        && !this.isUnfinished(record))
                    .sort((left, right) => left.updatedAt - right.updatedAt)[0];
                if (!reapable) {
                    throw new QaapWorkflowRunRequestError(nls.localize(
                        'qaap/workflowRuns/limit', 'You can keep at most {0} workflow runs.', String(MAX_RUNS_PER_OWNER),
                    ));
                }
                next = next.filter(record => record !== reapable);
            }
            const now = this.now();
            const seedVisits = Math.max(1, Math.floor(options.seedVisits));
            const record: QaapPersistedWorkflowRun = {
                run: {
                    id: randomUUID(),
                    defId: def.id,
                    defVersion: def.version,
                    status: 'running',
                    active: [options.seedNodeId],
                    visits: { [options.seedNodeId]: seedVisits },
                    joinArrivals: {},
                    firedJoins: [],
                    bindings: {},
                    nodeRuns: seedVisits,
                    budget: options.budget ?? DEFAULT_QAAP_WORKFLOW_RUN_BUDGET,
                },
                def,
                ownerLogin: owner,
                cwd: options.cwd,
                inputs: options.inputs ?? {},
                createdAt: now,
                updatedAt: now,
                dispatched: options.deadExternalId
                    ? {
                        [options.seedNodeId]: {
                            nodeId: options.seedNodeId,
                            externalId: options.deadExternalId,
                            kind: options.deadKind ?? 'agent',
                            dispatchedAt: options.dispatchedAt ?? now,
                        },
                    }
                    : {},
                dispatchClaims: {},
                artifacts: {},
                routedAgents: {},
                trace: [],
            };
            return { records: [...next, record], result: record };
        }, result => result);
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
        /** Short generated phrase for the trace; never raw repository output. */
        detail?: string,
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
            const executed = dispatched[nodeId];
            delete dispatched[nodeId];
            const dispatchClaims = { ...previous.dispatchClaims };
            delete dispatchClaims[nodeId];
            const finishedAt = this.now();
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                run: advanced.run,
                dispatched,
                dispatchClaims,
                artifacts: artifact
                    ? { ...previous.artifacts, [artifact.key]: artifact.value.slice(0, MAX_ARTIFACT_CHARS) }
                    : previous.artifacts,
                trace: appendQaapWorkflowTrace(previous.trace, {
                    nodeId,
                    kind: previous.def.nodes.find(node => node.id === nodeId)?.kind ?? 'deterministic',
                    outcome,
                    ...(executed ? { startedAt: executed.dispatchedAt, durationMs: finishedAt - executed.dispatchedAt } : {}),
                    finishedAt,
                    ...(previous.routedAgents[nodeId] ? { agentRef: previous.routedAgents[nodeId] } : {}),
                    ...(executed ? { externalId: executed.externalId } : {}),
                    ...(detail ? { detail } : {}),
                }),
                updatedAt: finishedAt,
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
            const existing = previous.dispatched[nodeId];
            if (existing) {
                if (existing.kind !== kind || existing.externalId !== externalId) {
                    throw new QaapWorkflowRunRequestError(`Workflow node "${nodeId}" is already attached to different work.`);
                }
                return { records, result: this.clone(previous) };
            }
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

    /**
     * Persist ownership of the create side-effect before an agent process is created.
     *
     * This mutation is serialized with every other run mutation. Therefore exactly one caller can
     * receive `claimed`; concurrent callers receive `pending`, and a replay after attachment gets
     * the existing external id.
     */
    claimDispatch(
        ownerLogin: string | undefined,
        runId: string,
        nodeId: string,
        visit: number,
        kind: 'agent' | 'job',
        claimId: string,
    ): Promise<QaapWorkflowDispatchClaimResult> {
        return this.mutate<QaapWorkflowDispatchClaimResult>(records => {
            const owner = this.normalizeOwner(ownerLogin);
            const index = records.findIndex(entry => entry.run.id === runId && entry.ownerLogin === owner);
            if (index < 0) {
                throw new QaapWorkflowRunRequestError(nls.localize(
                    'qaap/workflowRuns/notFound', 'Workflow run {0} was not found.', runId,
                ));
            }
            const previous = records[index];
            if (!previous.run.active.includes(nodeId) || previous.run.visits[nodeId] !== visit) {
                throw new QaapWorkflowRunRequestError(`Workflow node "${nodeId}" visit ${visit} is no longer active.`);
            }
            const attached = previous.dispatched[nodeId];
            if (attached) {
                if (attached.kind !== kind) {
                    throw new QaapWorkflowRunRequestError(`Workflow node "${nodeId}" is attached with a different runtime kind.`);
                }
                return { records, result: { status: 'attached', externalId: attached.externalId } as const };
            }
            const pending = previous.dispatchClaims[nodeId];
            if (pending) {
                if (pending.visit !== visit || pending.kind !== kind) {
                    throw new QaapWorkflowRunRequestError(`Workflow node "${nodeId}" has a conflicting dispatch claim.`);
                }
                const now = this.now();
                if (now - pending.claimedAt >= QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS) {
                    const record: QaapPersistedWorkflowRun = {
                        ...previous,
                        dispatchClaims: {
                            ...previous.dispatchClaims,
                            [nodeId]: { nodeId, visit, kind, claimId, claimedAt: now },
                        },
                        updatedAt: now,
                    };
                    const next = [...records];
                    next[index] = record;
                    return { records: next, result: { status: 'claimed' } };
                }
                return {
                    records,
                    result: pending.claimId === claimId
                        ? { status: 'claimed' }
                        : { status: 'pending', claimId: pending.claimId },
                };
            }
            const now = this.now();
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                dispatchClaims: {
                    ...previous.dispatchClaims,
                    [nodeId]: { nodeId, visit, kind, claimId, claimedAt: now },
                },
                updatedAt: now,
            };
            const next = [...records];
            next[index] = record;
            return { records: next, result: { status: 'claimed' } };
        });
    }

    /** Convert the caller's durable claim into the durable external-id attachment. */
    completeDispatchClaim(
        ownerLogin: string | undefined,
        runId: string,
        nodeId: string,
        visit: number,
        kind: 'agent' | 'job',
        claimId: string,
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
            const existing = previous.dispatched[nodeId];
            if (existing?.kind === kind && existing.externalId === externalId) {
                return { records, result: this.clone(previous) };
            }
            const claim = previous.dispatchClaims[nodeId];
            if (
                !previous.run.active.includes(nodeId)
                || previous.run.visits[nodeId] !== visit
                || claim?.claimId !== claimId
                || claim?.visit !== visit
                || claim?.kind !== kind
            ) {
                throw new QaapWorkflowRunRequestError(`Workflow dispatch claim for "${nodeId}" visit ${visit} is no longer valid.`);
            }
            const now = this.now();
            const dispatchClaims = { ...previous.dispatchClaims };
            delete dispatchClaims[nodeId];
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                dispatched: {
                    ...previous.dispatched,
                    [nodeId]: { nodeId, externalId, kind, dispatchedAt: now },
                },
                dispatchClaims,
                updatedAt: now,
            };
            const next = [...records];
            next[index] = record;
            return { records: next, result: record };
        }, result => result);
    }

    /** Release only the caller's own unfinished claim; used when process creation/attach fails. */
    releaseDispatchClaim(
        ownerLogin: string | undefined,
        runId: string,
        nodeId: string,
        claimId: string,
    ): Promise<void> {
        return this.mutate(records => {
            const owner = this.normalizeOwner(ownerLogin);
            const index = records.findIndex(entry => entry.run.id === runId && entry.ownerLogin === owner);
            if (index < 0 || records[index].dispatchClaims[nodeId]?.claimId !== claimId) {
                return { records, result: undefined };
            }
            const previous = records[index];
            const dispatchClaims = { ...previous.dispatchClaims };
            delete dispatchClaims[nodeId];
            const next = [...records];
            next[index] = { ...previous, dispatchClaims, updatedAt: this.now() };
            return { records: next, result: undefined };
        });
    }

    /**
     * Remember which backend ran a node. Unlike {@link QaapPersistedWorkflowRun.dispatched}, which
     * is cleared when the node reports, this survives the whole run: a judge dispatched later has
     * to know who wrote the code it is about to review.
     */
    noteRoutedAgent(
        ownerLogin: string | undefined,
        runId: string,
        nodeId: string,
        agentRef: string,
    ): Promise<QaapPersistedWorkflowRun | undefined> {
        return this.mutate(records => {
            const owner = this.normalizeOwner(ownerLogin);
            const index = records.findIndex(entry => entry.run.id === runId && entry.ownerLogin === owner);
            if (index < 0) {
                return { records, result: undefined };
            }
            const previous = records[index];
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                routedAgents: { ...previous.routedAgents, [nodeId]: agentRef },
                updatedAt: this.now(),
            };
            const next = [...records];
            next[index] = record;
            return { records: next, result: record };
        });
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
            const expiredAt = this.now();
            // Close the story: without this the trace ends on whatever finished last, and the step
            // that was still in flight when the clock ran out — usually the interesting one —
            // simply never appears.
            let trace = previous.trace;
            for (const nodeId of previous.run.active) {
                const executed = previous.dispatched[nodeId];
                trace = appendQaapWorkflowTrace(trace, {
                    nodeId,
                    kind: previous.def.nodes.find(node => node.id === nodeId)?.kind ?? 'agent-turn',
                    outcome: 'fail',
                    ...(executed ? { startedAt: executed.dispatchedAt, durationMs: expiredAt - executed.dispatchedAt } : {}),
                    finishedAt: expiredAt,
                    ...(previous.routedAgents[nodeId] ? { agentRef: previous.routedAgents[nodeId] } : {}),
                    ...(executed ? { externalId: executed.externalId } : {}),
                    detail: 'Still running when the run\'s wall clock ran out.',
                });
            }
            const record: QaapPersistedWorkflowRun = {
                ...previous,
                run: expireQaapWorkflowRun(previous.run),
                dispatched: {},
                dispatchClaims: {},
                trace,
                updatedAt: expiredAt,
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
                    dispatchClaims: record.dispatchClaims ?? {},
                    cwd: record.cwd ?? '',
                    inputs: record.inputs ?? {},
                    artifacts: record.artifacts ?? {},
                    routedAgents: record.routedAgents ?? {},
                    trace: record.trace ?? [],
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

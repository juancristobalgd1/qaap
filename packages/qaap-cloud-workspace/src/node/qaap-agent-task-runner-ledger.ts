// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import { resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { autoContinueAllowedForInteraction } from '@theia/qaap-transcript/lib/common/qaap-agent-turn-completion';
import { isQaapAgentTaskFinished, QaapAgentTask, QaapAgentTaskState, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { INDEX_PATH, PersistedAgentTaskIndex, SHELL_AGENT_ID, STORE_DIR, STORE_DIR_MODE } from './qaap-agent-task-runner-constants';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import {
    QaapAgentCommandReceipt, QaapAgentEffect, QaapAgentLedgerImport, QaapAgentRunLedger, QaapAgentRunRow, QaapAgentRunState,
} from './qaap-agent-run-ledger';
import { QaapAgentRestartContinuationPolicy, QaapAgentRunOutbox, QaapAgentTurnContinuationHandler } from './qaap-agent-run-outbox';
import { MAX_RESTART_RESUMES, QAAP_AUTO_RESUME_TURNS_ENABLED } from './qaap-agent-conversation-store-constants';

// Task runner ↔ agent-run ledger glue (`QAAP_AGENT_LEDGER=on`). With the flag off none of this runs
// and the runner keeps rewriting `~/.qaap/agent-tasks/index.json`.

const RUN_STATE_BY_TASK_STATE: Readonly<Record<QaapAgentTaskState, QaapAgentRunState>> = {
    queued: 'queued',
    running: 'running',
    completed: 'succeeded',
    completed_with_warnings: 'succeeded',
    blocked: 'succeeded',
    failed: 'failed',
    interrupted: 'interrupted',
    cancelled: 'cancelled',
};

/** Ledger used by this runner, or undefined (index.json path) when the flag is off. */
export function resolveAgentRunLedgerExtracted(ctx: QaapAgentTaskRunnerContext): QaapAgentRunLedger | undefined {
    if (!QaapAgentRunLedger.isEnabled()) {
        ctx.agentRunLedger = undefined;
        return undefined;
    }
    if (!ctx.agentRunLedger) {
        fs.mkdirSync(STORE_DIR, { recursive: true, mode: STORE_DIR_MODE });
        ctx.agentRunLedger = new QaapAgentRunLedger({ databasePath: resolveQaapSqlitePath(INDEX_PATH), legacyPath: INDEX_PATH });
    }
    return ctx.agentRunLedger;
}

/** Ledger row for one task; `request` is only kept while the task waits in the queue. */
export function taskToLedgerRow(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask, request?: QaapCreateAgentTaskRequest): QaapAgentRunRow {
    const conversationId = ctx.conversationIdForTask?.(task.id);
    return {
        runId: task.id,
        owner: task.ownerLogin,
        ...(conversationId ? { conversationId } : {}),
        ...(task.parentId ? { parentRunId: task.parentId } : {}),
        ...(task.agentId ? { agentId: task.agentId } : {}),
        ...(task.agentModel?.modelId ? { modelId: task.agentModel.modelId } : {}),
        cwd: task.cwd,
        state: RUN_STATE_BY_TASK_STATE[task.state] ?? 'failed',
        ...(task.state === 'queued' && typeof task.queuePosition === 'number' ? { queuePosition: task.queuePosition } : {}),
        ...(task.state === 'queued' && request ? { request } : {}),
        task,
        ...(task.state === 'queued' && task.queueHeld ? { queueHeld: true } : {}),
        ...(typeof task.restartResumeCount === 'number' ? { resumeCount: task.restartResumeCount } : {}),
        createdAt: task.createdAt,
        ...(typeof task.finishedAt === 'number' ? { finishedAt: task.finishedAt } : {}),
    };
}

/** Converts a legacy `index.json` (v2 object or v1 array) into ledger rows plus idempotency receipts. */
export function legacyTaskIndexToLedgerImport(ctx: QaapAgentTaskRunnerContext, raw: string): QaapAgentLedgerImport {
    const stored = JSON.parse(raw) as unknown;
    const legacy = Array.isArray(stored);
    if (!legacy && (stored as Partial<PersistedAgentTaskIndex> | undefined)?.version !== 2) {
        throw new Error('Unsupported persisted agent task index version.');
    }
    const tasks = legacy ? stored as QaapAgentTask[] : (stored as Partial<PersistedAgentTaskIndex>).tasks;
    if (!Array.isArray(tasks)) {
        throw new Error('Invalid persisted agent task index.');
    }
    const queuedRequests = legacy ? {} : (stored as Partial<PersistedAgentTaskIndex>).queuedRequests ?? {};
    const runs: QaapAgentRunRow[] = [];
    const receipts: QaapAgentCommandReceipt[] = [];
    for (const task of tasks) {
        if (!task?.id || typeof task.cwd !== 'string') {
            continue;
        }
        const request = Object.prototype.hasOwnProperty.call(queuedRequests, task.id) ? queuedRequests[task.id] : undefined;
        runs.push(taskToLedgerRow(ctx, task, request));
        if (task.clientRequestId) {
            receipts.push({ owner: task.ownerLogin, commandId: task.clientRequestId, runId: task.id, result: { taskId: task.id } });
        }
    }
    return { runs, receipts };
}

/** Rebuilds the persisted index shape from ledger rows so `restorePersistedIndex` keeps one recovery policy. */
export function ledgerToTaskIndex(ledger: QaapAgentRunLedger): PersistedAgentTaskIndex {
    const tasks: QaapAgentTask[] = [];
    const queuedRequests: Record<string, QaapCreateAgentTaskRequest> = {};
    for (const run of ledger.listRunsForRecovery()) {
        const task = run.task as QaapAgentTask | undefined;
        if (!task || typeof task !== 'object' || task.id !== run.runId || typeof task.cwd !== 'string'
            // Never re-attribute a run to another owner (I1), even from a damaged snapshot.
            || QaapAgentRunLedger.ownerKey(task.ownerLogin) !== run.owner) {
            continue;
        }
        tasks.push(task);
        if (run.state === 'queued' && run.request && typeof run.request === 'object') {
            queuedRequests[run.runId] = run.request as QaapCreateAgentTaskRequest;
        }
    }
    return { version: 2, tasks, queuedRequests };
}

/**
 * Startup restore from the ledger, importing `index.json` once (the file is kept for rollback).
 * {@link QaapAgentRunOutbox.reconcileAfterProcessLoss} commits the process-loss policy (lost runs →
 * `interrupted`, their process effects cancelled, one deterministic `turn.continue` per eligible
 * run, the owners' queues held) in one transaction before any row is loaded, so
 * `restorePersistedIndex` only loads and validates what the ledger already decided.
 */
export function restoreFromLedgerExtracted(ctx: QaapAgentTaskRunnerContext, ledger: QaapAgentRunLedger): void {
    ledger.importLegacy(raw => legacyTaskIndexToLedgerImport(ctx, raw));
    const reconciled = QaapAgentRunOutbox.reconcileAfterProcessLoss(ledger, restartContinuationPolicy());
    if (reconciled.interrupted.length > 0 || reconciled.requeued.length > 0) {
        console.info(`[qaap-agent-outbox] reconciled after process loss: ${reconciled.interrupted.length} run(s) interrupted, `
            + `${reconciled.continuations.length} continuation(s) enqueued, ${reconciled.cancelled.length} effect(s) cancelled, `
            + `${reconciled.requeued.length} requeued.`);
    }
    ctx.restorePersistedIndex(ledgerToTaskIndex(ledger));
}

/** Restart-continuation policy shared with the conversation store's legacy auto-resume. */
export function restartContinuationPolicy(): QaapAgentRestartContinuationPolicy {
    return { enabled: QAAP_AUTO_RESUME_TURNS_ENABLED, maxResumes: MAX_RESTART_RESUMES };
}

/** Whether a lost run may continue on its own: an autonomous coding-agent turn, no human in the loop. */
export function isRunContinuable(agentId: string | undefined, request: QaapCreateAgentTaskRequest, autoApprove: boolean | undefined): boolean {
    return agentId !== SHELL_AGENT_ID && autoContinueAllowedForInteraction({
        interactionModeId: request.interactionModeId,
        approvalPolicyId: request.approvalPolicyId,
        autoApprove,
    });
}

/** Starts this process's outbox worker (after recovery) and binds the turn handlers. */
export function startAgentRunOutboxExtracted(ctx: QaapAgentTaskRunnerContext, ledger: QaapAgentRunLedger): QaapAgentRunOutbox {
    ctx.agentRunOutbox?.stop();
    const outbox = new QaapAgentRunOutbox({ ledger });
    ctx.agentRunOutbox = outbox;
    outbox.register(QaapAgentRunOutbox.TURN_START, effect => runTurnStartEffect(ctx, effect), { retry: false });
    if (ctx.turnContinuationHandler) {
        registerTurnContinueHandler(ctx, outbox);
    }
    return outbox;
}

/**
 * Binds the conversation-level continuation. Until it is bound, `turn.continue` effects stay
 * pending and do not block their thread (the claim only considers handled kinds).
 */
export function setTurnContinuationHandlerExtracted(ctx: QaapAgentTaskRunnerContext, handler: QaapAgentTurnContinuationHandler): void {
    ctx.turnContinuationHandler = handler;
    if (ctx.agentRunOutbox) {
        registerTurnContinueHandler(ctx, ctx.agentRunOutbox);
    }
}

function registerTurnContinueHandler(ctx: QaapAgentTaskRunnerContext, outbox: QaapAgentRunOutbox): void {
    outbox.register(QaapAgentRunOutbox.TURN_CONTINUE, effect => runTurnContinueEffect(ctx, effect), { retry: true });
}

/** Ledger commit that durably starts a run: its row (running) and the `turn.start` intent. */
export function turnStartEffect(task: QaapAgentTask): QaapAgentEffect {
    return {
        effectId: QaapAgentRunOutbox.turnStartEffectId(task.id),
        runId: task.id,
        owner: task.ownerLogin,
        kind: QaapAgentRunOutbox.TURN_START,
        // Intent only (I2): never the env, argv, prompt or tokens. The request stays in memory.
        payload: { version: 1 },
    };
}

/** Hands a durably accepted start to the worker. The request never leaves memory. */
export function enqueueTurnStartExtracted(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask, request: QaapCreateAgentTaskRequest): void {
    (ctx.outboxStartRequests ??= new Map()).set(task.id, request);
    ctx.agentRunOutbox?.kick();
}

/**
 * Queue promotion through the ledger: the row turns `running` and its `turn.start` is committed in
 * one transaction. Returns false (storage gate closed, task left queued) when the write fails.
 */
export function commitQueuedTaskStartExtracted(
    ctx: QaapAgentTaskRunnerContext, ledger: QaapAgentRunLedger, running: QaapAgentTask,
): boolean {
    const row = taskToLedgerRow(ctx, running);
    try {
        ledger.commit({ runUpserts: [row], effects: [turnStartEffect(running)] });
    } catch (error) {
        ctx.storageWriteFailed = true;
        console.warn('[qaap-agent-tasks] task ledger write failed; new tasks and queue promotion are blocked.',
            error instanceof Error ? error.message : error);
        return false;
    }
    ctx.ledgerSyncedRows?.set(running.id, JSON.stringify(row));
    return true;
}

async function runTurnStartEffect(ctx: QaapAgentTaskRunnerContext, effect: QaapAgentEffect): Promise<void> {
    const request = ctx.outboxStartRequests?.get(effect.runId);
    ctx.outboxStartRequests?.delete(effect.runId);
    const task = ctx.tasks.get(effect.runId);
    // Cancelled or finished before the worker got to it, or not this owner's run: nothing to start.
    if (!task || task.state !== 'running' || QaapAgentRunLedger.ownerKey(task.ownerLogin) !== QaapAgentRunLedger.ownerKey(effect.owner)) {
        return;
    }
    if (!request) {
        ctx.finishTask(task.id, 'interrupted', undefined);
        return;
    }
    try {
        await ctx.spawnProcessWhenReady(task, request);
    } catch (error) {
        if (ctx.tasks.get(task.id)?.state === 'running' && !ctx.processes.has(task.id)) {
            ctx.finishTask(task.id, 'failed', 1);
        }
        throw error;
    }
}

async function runTurnContinueEffect(ctx: QaapAgentTaskRunnerContext, effect: QaapAgentEffect): Promise<void> {
    const handler = ctx.turnContinuationHandler;
    if (!handler) {
        throw new Error('The turn continuation handler is not bound yet.');
    }
    const lost = ctx.tasks.get(effect.runId);
    if (!lost || QaapAgentRunLedger.ownerKey(lost.ownerLogin) !== QaapAgentRunLedger.ownerKey(effect.owner)) {
        return;
    }
    // Idempotent: a retried effect, or a manual resume that got there first, never adds a second turn.
    if (findContinuationOf(ctx, lost.id) || lost.state !== 'interrupted') {
        return;
    }
    const run = ctx.agentRunLedger?.getRun(effect.owner, effect.runId);
    await handler({ runId: lost.id, ownerLogin: lost.ownerLogin, conversationId: run?.conversationId });
    if (findContinuationOf(ctx, lost.id)) {
        // The continuation went first; the queue that waited behind the lost run can follow it.
        resumeQueueExtracted(ctx, lost.ownerLogin);
    }
}

function findContinuationOf(ctx: QaapAgentTaskRunnerContext, runId: string): QaapAgentTask | undefined {
    return [...ctx.tasks.values()].find(task => task.restartContinuationOf === runId
        || (task.resumedFromTaskId === runId && !isQaapAgentTaskFinished(task.state)));
}

/**
 * Task fields for a create that continues `runId` from its in-flight restart-continuation effect
 * (never from a request body). Undefined when the claim does not hold, so it gets no exemption.
 */
export function restartContinuationFieldsExtracted(
    ctx: QaapAgentTaskRunnerContext, runId: string | undefined, ownerLogin: string | undefined,
): Pick<QaapAgentTask, 'restartContinuationOf' | 'resumedFromTaskId' | 'restartResumeCount'> | undefined {
    const lost = runId ? ctx.tasks.get(runId) : undefined;
    if (!lost || !ctx.agentRunLedger || lost.state !== 'interrupted'
        || QaapAgentRunLedger.ownerKey(lost.ownerLogin) !== QaapAgentRunLedger.ownerKey(ownerLogin)
        || !ctx.agentRunOutbox?.isInFlight(QaapAgentRunOutbox.restartContinuationEffectId(lost.id))) {
        return undefined;
    }
    return { restartContinuationOf: lost.id, resumedFromTaskId: lost.id, restartResumeCount: (lost.restartResumeCount ?? 0) + 1 };
}

/**
 * Holds the owner's queued tasks after a root run failed (same agent: a provider that just failed
 * will likely fail the next message too). They wait for {@link resumeQueueExtracted}.
 */
export function holdQueueAfterFailureExtracted(ctx: QaapAgentTaskRunnerContext, failed: QaapAgentTask): void {
    if (!ctx.agentRunLedger || failed.parentId) {
        return;
    }
    const owner = QaapAgentRunLedger.ownerKey(failed.ownerLogin);
    for (const task of [...ctx.tasks.values()]) {
        if (task.state === 'queued' && !task.queueHeld && QaapAgentRunLedger.ownerKey(task.ownerLogin) === owner
            && (!task.agentId || !failed.agentId || task.agentId === failed.agentId)) {
            const held: QaapAgentTask = { ...task, queueHeld: true };
            ctx.tasks.set(task.id, held);
            ctx.onDidChangeTaskEmitter.fire({ type: 'reordered', task: held });
        }
    }
}

/** `queue.resume`: releases the owner's held queued tasks and promotes them. Returns how many. */
export function resumeQueueExtracted(ctx: QaapAgentTaskRunnerContext, ownerLogin: string | undefined): number {
    const owner = QaapAgentRunLedger.ownerKey(ownerLogin);
    const released: QaapAgentTask[] = [];
    for (const task of [...ctx.tasks.values()]) {
        if (task.state === 'queued' && task.queueHeld && QaapAgentRunLedger.ownerKey(task.ownerLogin) === owner) {
            const rest: QaapAgentTask = { ...task, queueHeld: undefined };
            ctx.tasks.set(task.id, rest);
            released.push(rest);
        }
    }
    if (released.length > 0) {
        void ctx.persist();
        for (const task of released) {
            ctx.onDidChangeTaskEmitter.fire({ type: 'reordered', task });
        }
        ctx.drainQueuedTasks();
    }
    return released.length;
}

/**
 * Writes the rows that changed since the last commit (and deletes removed tasks) in one
 * transaction, instead of rewriting the whole `index.json`.
 */
export function persistToLedgerExtracted(ctx: QaapAgentTaskRunnerContext, ledger: QaapAgentRunLedger): void {
    const synced = ctx.ledgerSyncedRows ??= new Map<string, string>();
    const upserts: QaapAgentRunRow[] = [];
    const signatures = new Map<string, string>();
    for (const task of ctx.tasks.values()) {
        const row = taskToLedgerRow(ctx, task, ctx.queuedCreateRequests.get(task.id));
        const signature = JSON.stringify(row);
        signatures.set(task.id, signature);
        if (synced.get(task.id) !== signature) {
            upserts.push(row);
        }
    }
    const deletes = [...synced.keys()]
        .filter(id => !signatures.has(id))
        .map(id => ({ owner: ledgerOwnerOf(synced.get(id)), runId: id }));
    if (upserts.length > 0 || deletes.length > 0) {
        ledger.commit({ runUpserts: upserts, runDeletes: deletes });
    }
    ctx.ledgerSyncedRows = signatures;
}

/** Task id previously accepted for this owner's client request id, if that task still exists. */
export function findLedgerClientRequestExtracted(
    ctx: QaapAgentTaskRunnerContext, ledger: QaapAgentRunLedger, ownerLogin: string | undefined, clientRequestId: string,
): QaapAgentTask | undefined {
    const receipt = ledger.findReceipt(ownerLogin, clientRequestId);
    return receipt ? ctx.tasks.get(receipt.runId) : undefined;
}

/**
 * Durably accepts a new task: the run row, the client request receipt and (with `startEffect`) its
 * `turn.start` intent commit together. Returns the already-accepted task when the receipt existed
 * (a retry after a restart or a race).
 */
export function commitCreatedTaskExtracted(
    ctx: QaapAgentTaskRunnerContext,
    ledger: QaapAgentRunLedger,
    task: QaapAgentTask,
    request: QaapCreateAgentTaskRequest,
    clientRequestId: string | undefined,
    options: { readonly continuable?: boolean; readonly startEffect?: boolean } = {},
): QaapAgentTask | undefined {
    const row = taskToLedgerRow(ctx, task, request);
    const prior = clientRequestId ? ledger.findReceipt(task.ownerLogin, clientRequestId) : undefined;
    if (prior && !ctx.tasks.has(prior.runId)) {
        // The earlier task was removed from memory (pruned/deleted) before its row: same outcome as
        // the in-memory cache, which forgot the id and let the retry create a new task.
        ledger.commit({ runDeletes: [{ owner: task.ownerLogin, runId: prior.runId }] });
    }
    const outcome = ledger.commit({
        ...(clientRequestId ? { receipt: { owner: task.ownerLogin, commandId: clientRequestId, runId: task.id, result: { taskId: task.id } } } : {}),
        runUpserts: [options.continuable === undefined ? row : { ...row, continuable: options.continuable }],
        ...(options.startEffect ? { effects: [turnStartEffect(task)] } : {}),
    });
    if (outcome.duplicate) {
        return outcome.runId ? ctx.tasks.get(outcome.runId) : undefined;
    }
    ctx.ledgerSyncedRows?.set(task.id, JSON.stringify(row));
    return undefined;
}

function ledgerOwnerOf(signature: string | undefined): string | undefined {
    try {
        return (JSON.parse(signature ?? '{}') as { owner?: string }).owner;
    } catch {
        return undefined;
    }
}

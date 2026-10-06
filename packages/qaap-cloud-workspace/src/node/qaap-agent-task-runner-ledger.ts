// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import { resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentTask, QaapAgentTaskState, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { INDEX_PATH, PersistedAgentTaskIndex, STORE_DIR, STORE_DIR_MODE } from './qaap-agent-task-runner-constants';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import {
    QaapAgentCommandReceipt, QaapAgentLedgerImport, QaapAgentRunLedger, QaapAgentRunRow, QaapAgentRunState,
} from './qaap-agent-run-ledger';

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

/** Startup restore from the ledger, importing `index.json` once (the file is kept for rollback). */
export function restoreFromLedgerExtracted(ctx: QaapAgentTaskRunnerContext, ledger: QaapAgentRunLedger): void {
    ledger.importLegacy(raw => legacyTaskIndexToLedgerImport(ctx, raw));
    ctx.restorePersistedIndex(ledgerToTaskIndex(ledger));
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
 * Durably accepts a new task: the run row and the client request receipt commit together. Returns
 * the already-accepted task when the receipt existed (a retry after a restart or a race).
 */
export function commitCreatedTaskExtracted(
    ctx: QaapAgentTaskRunnerContext,
    ledger: QaapAgentRunLedger,
    task: QaapAgentTask,
    request: QaapCreateAgentTaskRequest,
    clientRequestId: string | undefined,
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
        runUpserts: [row],
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

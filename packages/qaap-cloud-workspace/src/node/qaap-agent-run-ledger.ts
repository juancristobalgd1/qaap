// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { QaapSqliteStore, QaapSqliteStoreOptions } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

/** Run lifecycle stored in `qaap_agent_runs.state` (coarser than the task state kept in `task_json`). */
export type QaapAgentRunState = 'queued' | 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

/** Outbox effect lifecycle stored in `qaap_agent_outbox.status`. */
export type QaapAgentEffectStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** One durable agent run. `owner` scopes every read and write (invariant I1). */
export interface QaapAgentRunRow {
    readonly runId: string;
    readonly owner: string | undefined;
    readonly conversationId?: string;
    readonly parentRunId?: string;
    readonly agentId?: string;
    readonly modelId?: string;
    readonly cwd: string;
    readonly state: QaapAgentRunState;
    readonly queuePosition?: number;
    readonly queueHeld?: boolean;
    readonly nativeSessionId?: string;
    /** Restart continuations already spent on this turn's lineage; never decreases. */
    readonly resumeCount?: number;
    /**
     * Whether a process loss may continue this run automatically (autonomous `agent` contract, no
     * human approval in the loop). Unset keeps the stored value; never set means "no".
     */
    readonly continuable?: boolean;
    /** Original create request; only kept while it is needed to start the run (queued). */
    readonly request?: unknown;
    /** Full wire snapshot of the run (the task DTO), so the ledger replaces `index.json` losslessly. */
    readonly task?: unknown;
    readonly createdAt: number;
    readonly updatedAt?: number;
    readonly finishedAt?: number;
    readonly lastErrorClass?: string;
    readonly resetAt?: number;
}

/** Idempotency record for one client command (e.g. a create POST with `clientRequestId`). */
export interface QaapAgentCommandReceipt {
    readonly owner: string | undefined;
    readonly commandId: string;
    readonly runId: string;
    readonly status?: string;
    readonly result?: unknown;
    readonly acceptedAt?: number;
}

/** Durable intention (never env or argv: invariant I2), executed later by the outbox worker. */
export interface QaapAgentEffect {
    readonly effectId: string;
    readonly runId: string;
    readonly owner: string | undefined;
    readonly kind: string;
    /** FIFO key within the owner: effects of one thread run one at a time, in order. Defaults to `runId`. */
    readonly threadKey?: string;
    readonly payload?: unknown;
    readonly status?: QaapAgentEffectStatus;
    readonly attemptCount?: number;
    readonly availableAt?: number;
    readonly leaseOwner?: string;
    readonly lastError?: string;
    readonly createdAt?: number;
}

/** Owner-scoped reference to a run. */
export interface QaapAgentRunRef {
    readonly owner: string | undefined;
    readonly runId: string;
}

export interface QaapAgentLedgerCommit {
    /** Inserted with `INSERT OR IGNORE`; when it already exists nothing else in the commit is applied. */
    readonly receipt?: QaapAgentCommandReceipt;
    readonly runUpserts?: readonly QaapAgentRunRow[];
    /** Deleting a run also deletes its receipts and outbox effects (cascade). */
    readonly runDeletes?: readonly QaapAgentRunRef[];
    /** Inserted with `INSERT OR IGNORE`, so deterministic effect ids are idempotent. */
    readonly effects?: readonly QaapAgentEffect[];
    /** Moves the run's `pending`/`running` effects to `cancelled`. */
    readonly cancelEffectsFor?: readonly QaapAgentRunRef[];
}

export interface QaapAgentLedgerCommitResult {
    /** True when the receipt already existed: the stored outcome is returned and nothing was written. */
    readonly duplicate: boolean;
    readonly runId?: string;
    readonly result?: unknown;
}

/** How {@link QaapAgentRunLedger.settleEffect} leaves a claimed effect. */
export type QaapAgentEffectSettlement =
    | { readonly status: 'succeeded' | 'failed' | 'cancelled'; readonly error?: string }
    | { readonly status: 'pending'; readonly availableAt: number; readonly error?: string };

export interface QaapAgentLedgerReconcileOptions {
    readonly now: number;
    /** Effect kinds bound to a live agent process (cancelled, never replayed, after a process loss). */
    readonly processKinds: readonly string[];
    /** Continuation to enqueue for an interrupted run, if it is eligible. */
    readonly continuation?: (run: QaapAgentRunRow) => QaapAgentEffect | undefined;
}

export interface QaapAgentLedgerReconcileResult {
    readonly cancelled: readonly string[];
    readonly requeued: readonly string[];
    readonly interrupted: readonly QaapAgentRunRow[];
    /** Continuations inserted by this reconciliation (an id that already existed is not repeated). */
    readonly continuations: readonly QaapAgentEffect[];
    /** Owner keys whose queued runs are now held. */
    readonly heldOwners: readonly string[];
}

/** Rows produced by a one-time legacy import. */
export interface QaapAgentLedgerImport {
    readonly runs: readonly QaapAgentRunRow[];
    readonly receipts?: readonly QaapAgentCommandReceipt[];
}

export interface QaapAgentRunLedgerOptions extends Omit<QaapSqliteStoreOptions, 'namespace'> {
    readonly namespace?: string;
}

interface RunRecord {
    run_id: string;
    owner: string;
    conversation_id?: string;
    parent_run_id?: string;
    agent_id?: string;
    model_id?: string;
    cwd: string;
    state: QaapAgentRunState;
    queue_position?: number;
    queue_held: number;
    native_session_id?: string;
    resume_count: number;
    continuable?: number;
    request_json?: string;
    task_json?: string;
    created_at: number;
    updated_at: number;
    finished_at?: number;
    last_error_class?: string;
    reset_at?: number;
}

interface EffectRecord {
    effect_id: string;
    run_id: string;
    owner: string;
    kind: string;
    thread_key?: string;
    payload_json?: string;
    status: QaapAgentEffectStatus;
    attempt_count: number;
    available_at: number;
    lease_owner?: string;
    last_error?: string;
    created_at: number;
}

/**
 * Ordered ledger schema steps. The connection-wide `PRAGMA user_version` belongs to
 * `@theia/qaap-persistence`, so the ledger records its own version in `qaap_migration`
 * (`<namespace>/schema/v<n>`). Append new steps, never edit or reorder existing ones.
 *
 * Receipts and outbox rows reference `(run_id, owner)`: a row can never point at another owner's run.
 */
const QAAP_AGENT_RUN_LEDGER_SCHEMA: ReadonlyArray<(database: DatabaseSync) => void> = [
    database => database.exec(`
        CREATE TABLE IF NOT EXISTS qaap_agent_runs (
            run_id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            conversation_id TEXT,
            parent_run_id TEXT,
            agent_id TEXT,
            model_id TEXT,
            cwd TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('queued', 'starting', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
            queue_position INTEGER,
            queue_held INTEGER NOT NULL DEFAULT 0 CHECK (queue_held IN (0, 1)),
            native_session_id TEXT,
            resume_count INTEGER NOT NULL DEFAULT 0 CHECK (resume_count >= 0),
            request_json TEXT,
            task_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            finished_at INTEGER,
            last_error_class TEXT,
            reset_at INTEGER,
            UNIQUE (run_id, owner)
        );
        CREATE INDEX IF NOT EXISTS qaap_agent_runs_owner_state
            ON qaap_agent_runs (owner, state, queue_position);
        CREATE INDEX IF NOT EXISTS qaap_agent_runs_conversation
            ON qaap_agent_runs (owner, conversation_id);
        CREATE TABLE IF NOT EXISTS qaap_agent_command_receipts (
            owner TEXT NOT NULL,
            command_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            status TEXT NOT NULL,
            result_json TEXT,
            accepted_at INTEGER NOT NULL,
            PRIMARY KEY (owner, command_id),
            FOREIGN KEY (run_id, owner) REFERENCES qaap_agent_runs (run_id, owner)
                ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS qaap_agent_command_receipts_run
            ON qaap_agent_command_receipts (run_id);
        CREATE TABLE IF NOT EXISTS qaap_agent_outbox (
            effect_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            owner TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload_json TEXT,
            status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            available_at INTEGER NOT NULL,
            lease_owner TEXT,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (run_id, owner) REFERENCES qaap_agent_runs (run_id, owner) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS qaap_agent_outbox_status_available
            ON qaap_agent_outbox (status, available_at);
        CREATE INDEX IF NOT EXISTS qaap_agent_outbox_run_status
            ON qaap_agent_outbox (run_id, status);
    `),
    // v2 (outbox worker): per-thread FIFO key and the run's auto-continue eligibility.
    database => database.exec(`
        ALTER TABLE qaap_agent_outbox ADD COLUMN thread_key TEXT;
        ALTER TABLE qaap_agent_runs ADD COLUMN continuable INTEGER CHECK (continuable IN (0, 1));
        CREATE INDEX IF NOT EXISTS qaap_agent_outbox_owner_thread
            ON qaap_agent_outbox (owner, thread_key, status);
    `),
];

/** The only `null` in the ledger: what node:sqlite binds as SQL NULL. */
const SQL_NULL: SQLInputValue = null;

const RUN_UPSERT_SQL = `
    INSERT INTO qaap_agent_runs (
        run_id, owner, conversation_id, parent_run_id, agent_id, model_id, cwd, state,
        queue_position, queue_held, native_session_id, resume_count, continuable, request_json, task_json,
        created_at, updated_at, finished_at, last_error_class, reset_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (run_id) DO UPDATE SET
        conversation_id = COALESCE(excluded.conversation_id, qaap_agent_runs.conversation_id),
        parent_run_id = excluded.parent_run_id,
        agent_id = excluded.agent_id,
        model_id = excluded.model_id,
        cwd = excluded.cwd,
        state = excluded.state,
        queue_position = excluded.queue_position,
        queue_held = excluded.queue_held,
        native_session_id = excluded.native_session_id,
        resume_count = MAX(qaap_agent_runs.resume_count, excluded.resume_count),
        continuable = COALESCE(excluded.continuable, qaap_agent_runs.continuable),
        request_json = excluded.request_json,
        task_json = excluded.task_json,
        updated_at = excluded.updated_at,
        finished_at = excluded.finished_at,
        last_error_class = excluded.last_error_class,
        reset_at = excluded.reset_at
    WHERE qaap_agent_runs.owner = excluded.owner
`;

/**
 * Durable agent-run ledger in the tenant SQLite database (see `doc/qaap-agent-run-ledger.md`).
 *
 * Every mutation goes through {@link commit}: command receipt, run rows and outbox effects land in
 * one transaction or not at all. All reads take an owner, and an owner never reads or writes
 * another owner's rows (invariant I1). Only used when `QAAP_AGENT_LEDGER` is on.
 */
export class QaapAgentRunLedger extends QaapSqliteStore {

    static readonly NAMESPACE = 'agent-run-ledger';

    constructor(options: QaapAgentRunLedgerOptions) {
        super({ ...options, namespace: options.namespace ?? QaapAgentRunLedger.NAMESPACE });
        this.migrateLedgerSchema();
    }

    /**
     * Applies one command atomically. A receipt that already exists short-circuits the commit and
     * returns the stored outcome, so a retried client command never creates a second run.
     */
    commit(change: QaapAgentLedgerCommit): QaapAgentLedgerCommitResult {
        return this.withTransaction(database => {
            const now = Date.now();
            if (change.receipt) {
                const receipt = change.receipt;
                const owner = QaapAgentRunLedger.ownerKey(receipt.owner);
                const inserted = database.prepare(`
                    INSERT OR IGNORE INTO qaap_agent_command_receipts
                        (owner, command_id, run_id, status, result_json, accepted_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(...QaapAgentRunLedger.sqlParams([
                    owner,
                    receipt.commandId,
                    receipt.runId,
                    receipt.status ?? 'accepted',
                    QaapAgentRunLedger.toJson(receipt.result),
                    receipt.acceptedAt ?? now,
                ]));
                if (inserted.changes === 0) {
                    const stored = this.readReceipt(database, owner, receipt.commandId);
                    return { duplicate: true, runId: stored?.runId, result: stored?.result };
                }
            }
            for (const run of change.runUpserts ?? []) {
                this.upsertRun(database, run, now);
            }
            for (const ref of change.runDeletes ?? []) {
                database.prepare('DELETE FROM qaap_agent_runs WHERE owner = ? AND run_id = ?')
                    .run(QaapAgentRunLedger.ownerKey(ref.owner), ref.runId);
            }
            for (const ref of change.cancelEffectsFor ?? []) {
                database.prepare(`
                    UPDATE qaap_agent_outbox SET status = 'cancelled', lease_owner = NULL
                    WHERE owner = ? AND run_id = ? AND status IN ('pending', 'running')
                `).run(QaapAgentRunLedger.ownerKey(ref.owner), ref.runId);
            }
            for (const effect of change.effects ?? []) {
                this.insertEffect(database, effect, now);
            }
            return change.receipt
                ? { duplicate: false, runId: change.receipt.runId, result: change.receipt.result }
                : { duplicate: false };
        });
    }

    getRun(owner: string | undefined, runId: string): QaapAgentRunRow | undefined {
        const record = this.withDatabase(database => database.prepare(
            'SELECT * FROM qaap_agent_runs WHERE owner = ? AND run_id = ?',
        ).get(QaapAgentRunLedger.ownerKey(owner), runId)) as RunRecord | undefined;
        return record ? QaapAgentRunLedger.toRun(record) : undefined;
    }

    /** The owner's runs in creation order. */
    listRuns(owner: string | undefined): QaapAgentRunRow[] {
        const records = this.withDatabase(database => database.prepare(
            'SELECT * FROM qaap_agent_runs WHERE owner = ? ORDER BY created_at, rowid',
        ).all(QaapAgentRunLedger.ownerKey(owner))) as unknown as RunRecord[];
        return records.map(record => QaapAgentRunLedger.toRun(record));
    }

    /**
     * Every run in this database, for the backend's own startup recovery only. The database is
     * the tenant's; never expose the result to a request without filtering by owner.
     */
    listRunsForRecovery(): QaapAgentRunRow[] {
        const records = this.withDatabase(database => database.prepare(
            'SELECT * FROM qaap_agent_runs ORDER BY created_at, rowid',
        ).all()) as unknown as RunRecord[];
        return records.map(record => QaapAgentRunLedger.toRun(record));
    }

    findReceipt(owner: string | undefined, commandId: string): QaapAgentCommandReceipt | undefined {
        return this.withDatabase(database => this.readReceipt(database, QaapAgentRunLedger.ownerKey(owner), commandId));
    }

    listEffects(owner: string | undefined, runId?: string): QaapAgentEffect[] {
        const ownerKey = QaapAgentRunLedger.ownerKey(owner);
        const records = this.withDatabase(database => runId === undefined
            ? database.prepare('SELECT * FROM qaap_agent_outbox WHERE owner = ? ORDER BY rowid').all(ownerKey)
            : database.prepare('SELECT * FROM qaap_agent_outbox WHERE owner = ? AND run_id = ? ORDER BY rowid').all(ownerKey, runId),
        ) as unknown as EffectRecord[];
        return records.map(record => QaapAgentRunLedger.toEffect(record));
    }

    /** True once {@link importLegacy} recorded the import (whether or not it found rows to copy). */
    isLegacyImported(): boolean {
        return this.withDatabase(database => !!database.prepare(
            'SELECT 1 FROM qaap_migration WHERE namespace = ?',
        ).get(this.namespace));
    }

    /**
     * Imports the legacy JSON source exactly once and never modifies or deletes it
     * (`doc/qaap-sqlite-persistence.md`). Rows are only copied into an empty ledger. A parse error
     * propagates and leaves the import unrecorded, so the caller can fail closed and retry later.
     */
    importLegacy(loader: (raw: string) => QaapAgentLedgerImport, sourcePath = this.legacyPath): boolean {
        if (!sourcePath || !fs.existsSync(sourcePath) || this.isLegacyImported()) {
            return false;
        }
        const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
        const imported = loader(raw);
        return this.withTransaction(database => {
            if (database.prepare('SELECT 1 FROM qaap_migration WHERE namespace = ?').get(this.namespace)) {
                return false;
            }
            const empty = !database.prepare('SELECT 1 FROM qaap_agent_runs LIMIT 1').get();
            if (empty) {
                const now = Date.now();
                for (const run of imported.runs) {
                    this.upsertRun(database, run, now);
                }
                const runIds = new Set(imported.runs.map(run => run.runId));
                for (const receipt of imported.receipts ?? []) {
                    if (runIds.has(receipt.runId)) {
                        database.prepare(`
                            INSERT OR IGNORE INTO qaap_agent_command_receipts
                                (owner, command_id, run_id, status, result_json, accepted_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `).run(...QaapAgentRunLedger.sqlParams([
                            QaapAgentRunLedger.ownerKey(receipt.owner),
                            receipt.commandId,
                            receipt.runId,
                            receipt.status ?? 'accepted',
                            QaapAgentRunLedger.toJson(receipt.result),
                            receipt.acceptedAt ?? now,
                        ]));
                    }
                }
            }
            database.prepare('INSERT INTO qaap_migration (namespace, source_path, migrated_at) VALUES (?, ?, ?)')
                .run(this.namespace, sourcePath, Date.now());
            return empty;
        });
    }

    /**
     * Claims the oldest runnable effect atomically (`UPDATE … RETURNING`): `pending`, due, of a
     * handled kind, and with no `running` effect nor an earlier unfinished effect of a handled kind
     * in the same owner thread (per-thread FIFO). Unhandled kinds neither run nor block.
     */
    claimNextEffect(leaseOwner: string, now: number, kinds: readonly string[]): QaapAgentEffect | undefined {
        if (kinds.length === 0) {
            return undefined;
        }
        const handled = JSON.stringify(kinds);
        const record = this.withTransaction(database => database.prepare(`
            UPDATE qaap_agent_outbox
            SET status = 'running', attempt_count = attempt_count + 1, lease_owner = ?, last_error = NULL
            WHERE status = 'pending' AND effect_id = (
                SELECT candidate.effect_id FROM qaap_agent_outbox AS candidate
                WHERE candidate.status = 'pending'
                    AND candidate.available_at <= ?
                    AND candidate.kind IN (SELECT value FROM json_each(?))
                    AND NOT EXISTS (
                        SELECT 1 FROM qaap_agent_outbox AS active
                        WHERE active.owner = candidate.owner
                            AND COALESCE(active.thread_key, active.run_id) = COALESCE(candidate.thread_key, candidate.run_id)
                            AND (active.status = 'running' OR (
                                active.status = 'pending'
                                AND active.rowid < candidate.rowid
                                AND active.kind IN (SELECT value FROM json_each(?))
                            ))
                    )
                ORDER BY candidate.rowid
                LIMIT 1
            )
            RETURNING *
        `).get(leaseOwner, now, handled, handled)) as EffectRecord | undefined;
        return record ? QaapAgentRunLedger.toEffect(record) : undefined;
    }

    /**
     * Settles a claimed effect. Only the lease holder can settle it, so an effect that startup
     * reconciliation (or a cancel) already moved on is never overwritten. Returns whether it changed.
     */
    settleEffect(effectId: string, leaseOwner: string, outcome: QaapAgentEffectSettlement): boolean {
        const changes = this.withTransaction(database => {
            if (outcome.status === 'pending') {
                return database.prepare(`
                    UPDATE qaap_agent_outbox SET status = 'pending', available_at = ?, lease_owner = NULL, last_error = ?
                    WHERE effect_id = ? AND status = 'running' AND lease_owner = ?
                `).run(...QaapAgentRunLedger.sqlParams([outcome.availableAt, outcome.error, effectId, leaseOwner])).changes;
            }
            return database.prepare(`
                UPDATE qaap_agent_outbox SET status = ?, lease_owner = NULL, last_error = ?
                WHERE effect_id = ? AND status = 'running' AND lease_owner = ?
            `).run(...QaapAgentRunLedger.sqlParams([outcome.status, outcome.error, effectId, leaseOwner])).changes;
        });
        return Number(changes) > 0;
    }

    /** Earliest `available_at` among pending effects of the given kinds, if any. */
    nextEffectAvailableAt(kinds: readonly string[]): number | undefined {
        if (kinds.length === 0) {
            return undefined;
        }
        const row = this.withDatabase(database => database.prepare(`
            SELECT MIN(available_at) AS next FROM qaap_agent_outbox
            WHERE status = 'pending' AND kind IN (SELECT value FROM json_each(?))
        `).get(JSON.stringify(kinds))) as { next?: number } | undefined;
        return typeof row?.next === 'number' ? row.next : undefined;
    }

    /**
     * Startup reconciliation after the previous backend process died, in one transaction:
     * - `running` effects of a process kind are `cancelled` (their process is gone);
     * - `running` effects of any other kind go back to `pending` (safe to repeat);
     * - `running`/`starting` runs become `interrupted` (row and task snapshot), and their pending
     *   process effects are cancelled (the in-memory start request died with the process);
     * - `continuation(run)` may return one effect per interrupted run (inserted `OR IGNORE`, so a
     *   deterministic id makes a second restart a no-op);
     * - queued runs of every owner with an interrupted run are held (`queue_held`).
     */
    reconcileAfterProcessLoss(options: QaapAgentLedgerReconcileOptions): QaapAgentLedgerReconcileResult {
        return this.withTransaction(database => {
            const now = options.now;
            const processKinds = JSON.stringify(options.processKinds);
            const cancelled = (database.prepare(`
                UPDATE qaap_agent_outbox
                SET status = 'cancelled', lease_owner = NULL, last_error = 'The server process running this effect ended.'
                WHERE status = 'running' AND kind IN (SELECT value FROM json_each(?))
                RETURNING effect_id
            `).all(processKinds) as unknown as Array<{ effect_id: string }>).map(row => row.effect_id);
            const requeued = (database.prepare(`
                UPDATE qaap_agent_outbox
                SET status = 'pending', lease_owner = NULL, available_at = ?, last_error = 'Requeued after the server process ended.'
                WHERE status = 'running'
                RETURNING effect_id
            `).all(now) as unknown as Array<{ effect_id: string }>).map(row => row.effect_id);
            const lost = (database.prepare(`
                SELECT * FROM qaap_agent_runs WHERE state IN ('running', 'starting') ORDER BY created_at, rowid
            `).all() as unknown as RunRecord[]).map(record => QaapAgentRunLedger.toRun(record));
            const interrupted: QaapAgentRunRow[] = [];
            const continuations: QaapAgentEffect[] = [];
            const heldOwners = new Set<string>();
            for (const run of lost) {
                const owner = QaapAgentRunLedger.ownerKey(run.owner);
                database.prepare(`
                    UPDATE qaap_agent_runs
                    SET state = 'interrupted', finished_at = COALESCE(finished_at, ?), updated_at = ?,
                        task_json = CASE WHEN json_valid(task_json)
                            THEN json_set(task_json, '$.state', 'interrupted', '$.finishedAt', ?)
                            ELSE task_json END
                    WHERE owner = ? AND run_id = ?
                `).run(now, now, now, owner, run.runId);
                cancelled.push(...(database.prepare(`
                    UPDATE qaap_agent_outbox
                    SET status = 'cancelled', lease_owner = NULL, last_error = 'The run was interrupted before this effect ran.'
                    WHERE owner = ? AND run_id = ? AND status = 'pending' AND kind IN (SELECT value FROM json_each(?))
                    RETURNING effect_id
                `).all(owner, run.runId, processKinds) as unknown as Array<{ effect_id: string }>).map(row => row.effect_id));
                const row: QaapAgentRunRow = { ...run, state: 'interrupted' };
                interrupted.push(row);
                heldOwners.add(owner);
                const continuation = options.continuation?.(row);
                if (continuation && this.insertEffect(database, continuation, now)) {
                    continuations.push(continuation);
                }
            }
            for (const owner of heldOwners) {
                database.prepare(`
                    UPDATE qaap_agent_runs
                    SET queue_held = 1, updated_at = ?,
                        task_json = CASE WHEN json_valid(task_json)
                            THEN json_set(task_json, '$.queueHeld', json('true'))
                            ELSE task_json END
                    WHERE owner = ? AND state = 'queued'
                `).run(now, owner);
            }
            return { cancelled, requeued, interrupted, continuations, heldOwners: [...heldOwners] };
        });
    }

    protected migrateLedgerSchema(): void {
        this.withTransaction(database => {
            QAAP_AGENT_RUN_LEDGER_SCHEMA.forEach((step, index) => {
                const marker = `${this.namespace}/schema/v${index + 1}`;
                if (database.prepare('SELECT 1 FROM qaap_migration WHERE namespace = ?').get(marker)) {
                    return;
                }
                step(database);
                database.prepare('INSERT INTO qaap_migration (namespace, source_path, migrated_at) VALUES (?, ?, ?)')
                    .run(marker, 'schema', Date.now());
            });
        });
    }

    protected upsertRun(database: DatabaseSync, run: QaapAgentRunRow, now: number): void {
        const owner = QaapAgentRunLedger.ownerKey(run.owner);
        const result = database.prepare(RUN_UPSERT_SQL).run(...QaapAgentRunLedger.sqlParams([
            run.runId,
            owner,
            run.conversationId,
            run.parentRunId,
            run.agentId,
            run.modelId,
            run.cwd,
            run.state,
            run.queuePosition,
            run.queueHeld ? 1 : 0,
            run.nativeSessionId,
            run.resumeCount ?? 0,
            run.continuable === undefined ? undefined : run.continuable ? 1 : 0,
            QaapAgentRunLedger.toJson(run.request),
            QaapAgentRunLedger.toJson(run.task),
            run.createdAt,
            run.updatedAt ?? now,
            run.finishedAt,
            run.lastErrorClass,
            run.resetAt,
        ]));
        if (result.changes === 0) {
            throw new Error(`Agent run ${run.runId} belongs to another owner.`);
        }
    }

    /** Returns false when an effect with the same id already existed (deterministic ids are idempotent). */
    protected insertEffect(database: DatabaseSync, effect: QaapAgentEffect, now: number): boolean {
        const owner = QaapAgentRunLedger.ownerKey(effect.owner);
        if (!database.prepare('SELECT 1 FROM qaap_agent_runs WHERE owner = ? AND run_id = ?').get(owner, effect.runId)) {
            throw new Error(`Agent run ${effect.runId} does not exist for this owner.`);
        }
        return database.prepare(`
            INSERT OR IGNORE INTO qaap_agent_outbox
                (effect_id, run_id, owner, kind, thread_key, payload_json, status, attempt_count, available_at, lease_owner, last_error, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...QaapAgentRunLedger.sqlParams([
            effect.effectId,
            effect.runId,
            owner,
            effect.kind,
            effect.threadKey ?? effect.runId,
            QaapAgentRunLedger.toJson(effect.payload),
            effect.status ?? 'pending',
            effect.attemptCount ?? 0,
            effect.availableAt ?? now,
            effect.leaseOwner,
            effect.lastError,
            effect.createdAt ?? now,
        ])).changes > 0;
    }

    protected static toRun(record: RunRecord): QaapAgentRunRow {
        return QaapAgentRunLedger.withoutUndefined({
            runId: record.run_id,
            owner: record.owner,
            conversationId: record.conversation_id ?? undefined,
            parentRunId: record.parent_run_id ?? undefined,
            agentId: record.agent_id ?? undefined,
            modelId: record.model_id ?? undefined,
            cwd: record.cwd,
            state: record.state,
            queuePosition: record.queue_position ?? undefined,
            queueHeld: record.queue_held === 1,
            nativeSessionId: record.native_session_id ?? undefined,
            resumeCount: record.resume_count,
            continuable: typeof record.continuable === 'number' ? record.continuable === 1 : undefined,
            request: QaapAgentRunLedger.fromJson(record.request_json) ?? undefined,
            task: QaapAgentRunLedger.fromJson(record.task_json) ?? undefined,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
            finishedAt: record.finished_at ?? undefined,
            lastErrorClass: record.last_error_class ?? undefined,
            resetAt: record.reset_at ?? undefined,
        });
    }

    protected static toEffect(record: EffectRecord): QaapAgentEffect {
        return QaapAgentRunLedger.withoutUndefined({
            effectId: record.effect_id,
            runId: record.run_id,
            owner: record.owner,
            kind: record.kind,
            threadKey: record.thread_key ?? undefined,
            payload: QaapAgentRunLedger.fromJson(record.payload_json) ?? undefined,
            status: record.status,
            attemptCount: record.attempt_count,
            availableAt: record.available_at,
            leaseOwner: record.lease_owner ?? undefined,
            lastError: record.last_error ?? undefined,
            createdAt: record.created_at,
        });
    }

    protected readReceipt(database: DatabaseSync, ownerKey: string, commandId: string): QaapAgentCommandReceipt | undefined {
        const record = database.prepare(
            'SELECT * FROM qaap_agent_command_receipts WHERE owner = ? AND command_id = ?',
        ).get(ownerKey, commandId) as {
            owner: string; command_id: string; run_id: string; status: string; result_json?: string; accepted_at: number;
        } | undefined;
        return record ? {
            owner: record.owner,
            commandId: record.command_id,
            runId: record.run_id,
            status: record.status,
            result: QaapAgentRunLedger.fromJson(record.result_json),
            acceptedAt: record.accepted_at,
        } : undefined;
    }
}

export namespace QaapAgentRunLedger {
    export const FLAG_ENV = 'QAAP_AGENT_LEDGER';

    /** `QAAP_AGENT_LEDGER=on|1|true` enables the ledger; anything else keeps the `index.json` path. */
    export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true|on)$/i.test(env[FLAG_ENV]?.trim() ?? '');
    }

    /** Owner key stored in every row: GitHub logins are case-insensitive; no owner (local mode) is `_`. */
    export function ownerKey(owner: string | undefined): string {
        return owner?.trim().toLowerCase() || '_';
    }

    export function toJson(value: unknown): string | undefined {
        return value === undefined ? undefined : JSON.stringify(value);
    }

    /** SQLite NULL comes back as `null`; the ledger API only uses `undefined`. */
    export function fromJson(value: string | undefined): unknown {
        return value ? JSON.parse(value) : undefined;
    }

    /** Binds `undefined` as SQL NULL (node:sqlite rejects `undefined` parameters). */
    export function sqlParams(values: ReadonlyArray<string | number | undefined>): SQLInputValue[] {
        return values.map(value => value === undefined ? SQL_NULL : value);
    }

    /** Drops absent columns so rows read back like the objects that were written. */
    export function withoutUndefined<T extends object>(value: T): T {
        return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
    }
}

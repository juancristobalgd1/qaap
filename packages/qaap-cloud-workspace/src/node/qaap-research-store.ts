// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core/lib/common/event';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeJsonAtomicSync } from './qaap-write-json-atomic';
import {
    normalizeResearchGoal,
    type ResearchGoal,
    type ResearchMetricSpec,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import type { ResearchExperimentRecord } from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';
import type { QaapCreateResearchGoalBody } from '@theia/qaap-mobile-shell/lib/common/qaap-research-api';

const GOALS_STORE_DIR = path.join(os.homedir(), '.qaap');
const GOALS_STORE_PATH = path.join(GOALS_STORE_DIR, 'research-goals.json');
const GOALS_FILE_MODE = 0o600;
const GOALS_DIR_MODE = 0o700;

interface PersistedResearchGoals {
    readonly goals: ResearchGoal[];
    /** goalId → owner GitHub login, kept out of {@link ResearchGoal} itself (pure, tested layer). */
    readonly owners?: Record<string, string>;
}

/**
 * Node-owned persistence for the auto-researcher v1: goal metadata in `~/.qaap/research-goals.json`
 * (mirrors {@link QaapWorkHubRoutineStore}), and a per-repo, append-mostly JSONL experiment ledger
 * at `<goal.cwd>/.qaap/experiments.jsonl` (mirrors the round-by-round shape defined in
 * `qaap-research-ledger.ts`).
 *
 * The ledger is rewritten atomically (temp file + rename) on every write rather than truly
 * append-only, because a round's record is written as a skeleton BEFORE each phase and rewritten
 * IN PLACE as the phase advances — the ledger file itself is the runner's checkpoint, so a
 * half-written file after a crash would be worse than a slightly more expensive full rewrite.
 */
@injectable()
export class QaapResearchStore {

    protected readonly goals = new Map<string, ResearchGoal>();
    protected readonly ownerByGoalId = new Map<string, string>();
    /** Serializes RMW ledger writes per repository so concurrent rounds never corrupt JSONL. */
    protected readonly ledgerChains = new Map<string, Promise<void>>();
    protected ledgerTempCounter = 0;
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.loadFromDisk();
    }

    // ---- goal metadata ---------------------------------------------------

    list(): ResearchGoal[] {
        return [...this.goals.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    listRunning(): ResearchGoal[] {
        return this.list().filter(goal => goal.status === 'running');
    }

    get(id: string): ResearchGoal | undefined {
        return this.goals.get(id);
    }

    ownerOf(id: string): string | undefined {
        return this.ownerByGoalId.get(id);
    }

    create(body: QaapCreateResearchGoalBody, ownerLogin?: string): ResearchGoal {
        const goal = normalizeResearchGoal({
            id: randomUUID(),
            cwd: body.cwd.trim(),
            agentId: body.agentId?.trim() || undefined,
            description: body.description.trim(),
            agentModel: body.agentModel,
            runCommand: body.runCommand?.trim() || undefined,
            runTimeoutMs: body.runTimeoutMs,
            metrics: body.metrics,
            maxRounds: body.maxRounds,
            deadlineAt: body.deadlineAt,
            stagnationRounds: body.stagnationRounds,
            infraFailureLimit: body.infraFailureLimit,
        });
        this.goals.set(goal.id, goal);
        if (ownerLogin) {
            this.ownerByGoalId.set(goal.id, ownerLogin);
        }
        this.persistGoals();
        this.onDidChangeEmitter.fire();
        return goal;
    }

    updateGoal(id: string, patch: Partial<Pick<ResearchGoal, 'status' | 'terminationReason' | 'startedAt' | 'finishedAt'>>): ResearchGoal | undefined {
        const existing = this.goals.get(id);
        if (!existing) {
            return undefined;
        }
        let finishedAt = patch.finishedAt ?? existing.finishedAt;
        if (patch.finishedAt === undefined
            && patch.status !== undefined
            && patch.status !== 'running'
            && existing.status === 'running') {
            finishedAt = Date.now();
        }
        const next: ResearchGoal = { ...existing, ...patch, finishedAt };
        this.goals.set(id, next);
        this.persistGoals();
        this.onDidChangeEmitter.fire();
        return next;
    }

    cancel(id: string): ResearchGoal | undefined {
        return this.updateGoal(id, { status: 'cancelled', terminationReason: 'cancelled' });
    }

    /** Starts a new goal with the same configuration as a stopped goal (new id, fresh ledger branch). */
    replayFrom(sourceId: string, ownerLogin?: string): ResearchGoal {
        const source = this.goals.get(sourceId);
        if (!source) {
            throw new Error('Research goal not found.');
        }
        if (source.status === 'running') {
            throw new Error('Research goal is already running.');
        }
        const owner = ownerLogin ?? this.ownerByGoalId.get(sourceId);
        return this.create({
            cwd: source.cwd,
            description: source.description,
            agentId: source.agentId,
            agentModel: source.agentModel,
            runCommand: source.runCommand,
            runTimeoutMs: source.runTimeoutMs,
            metrics: source.metrics.map(metric => ({ ...metric })),
            maxRounds: source.maxRounds,
            deadlineAt: source.deadlineAt,
            stagnationRounds: source.stagnationRounds,
            infraFailureLimit: source.infraFailureLimit,
        }, owner);
    }

    // ---- experiment ledger -------------------------------------------------

    protected ledgerPath(cwd: string): string {
        return path.join(cwd, '.qaap', 'experiments.jsonl');
    }

    /** All records for `cwd`, oldest round first. Never cached — the runner is the only writer. */
    readLedger(cwd: string): ResearchExperimentRecord[] {
        return this.parseLedgerRaw(this.readLedgerRawSync(cwd));
    }

    /** Await pending writes for `cwd`, then read — use from HTTP handlers after async upserts. */
    async readLedgerAsync(cwd: string): Promise<ResearchExperimentRecord[]> {
        await this.ledgerChains.get(cwd);
        return this.parseLedgerRaw(await this.readLedgerRawAsync(cwd));
    }

    /** {@link readLedger} scoped to one goal, in case two goals ever share a `cwd`. */
    readLedgerForGoal(goal: ResearchGoal): ResearchExperimentRecord[] {
        return this.readLedger(goal.cwd).filter(record => record.goalId === goal.id);
    }

    async readLedgerForGoalAsync(goal: ResearchGoal): Promise<ResearchExperimentRecord[]> {
        return (await this.readLedgerAsync(goal.cwd)).filter(record => record.goalId === goal.id);
    }

    /**
     * Upserts a record by id: same id as an existing row → rewritten in place (a round's record
     * moves through `propose` → `run` → `measure` → `done` without changing identity); new id →
     * appended. Writes are serialized per `cwd` and use async atomic rename so the event loop is
     * not blocked on large ledgers.
     */
    async upsertRecord(cwd: string, record: ResearchExperimentRecord): Promise<void> {
        return this.enqueueLedgerOp(cwd, async () => {
            const records = this.parseLedgerRaw(await this.readLedgerRawAsync(cwd));
            const index = records.findIndex(existing => existing.id === record.id);
            const next = index >= 0
                ? records.map((existing, i) => (i === index ? record : existing))
                : [...records, record];
            await this.writeLedgerAtomic(cwd, next);
        });
    }

    bestSoFar(goal: ResearchGoal, metric: ResearchMetricSpec): number | undefined {
        const values = this.readLedgerForGoal(goal)
            .map(record => record.metrics.find(value => value.name === metric.name)?.value)
            .filter((value): value is number => value !== undefined);
        if (values.length === 0) {
            return undefined;
        }
        return metric.direction === 'max' ? Math.max(...values) : Math.min(...values);
    }

    protected enqueueLedgerOp(cwd: string, op: () => Promise<void>): Promise<void> {
        const previous = this.ledgerChains.get(cwd) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(op)
            .catch(error => {
                console.warn('[qaap-research] ledger write failed:', error instanceof Error ? error.message : error);
            });
        this.ledgerChains.set(cwd, next);
        return next;
    }

    protected readLedgerRawSync(cwd: string): string {
        try {
            return fs.readFileSync(this.ledgerPath(cwd), 'utf8');
        } catch {
            return '';
        }
    }

    protected async readLedgerRawAsync(cwd: string): Promise<string> {
        try {
            return await fsp.readFile(this.ledgerPath(cwd), 'utf8');
        } catch {
            return '';
        }
    }

    protected parseLedgerRaw(raw: string): ResearchExperimentRecord[] {
        if (!raw) {
            return [];
        }
        const records: ResearchExperimentRecord[] = [];
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            try {
                records.push(JSON.parse(trimmed) as ResearchExperimentRecord);
            } catch (error) {
                console.warn('[qaap-research] skipped corrupt ledger line:', error instanceof Error ? error.message : error);
            }
        }
        return records;
    }

    protected async writeLedgerAtomic(cwd: string, records: readonly ResearchExperimentRecord[]): Promise<void> {
        const ledgerPath = this.ledgerPath(cwd);
        await fsp.mkdir(path.dirname(ledgerPath), { recursive: true });
        const tmp = `${ledgerPath}.${process.pid}.${++this.ledgerTempCounter}.tmp`;
        const body = records.map(record => JSON.stringify(record)).join('\n');
        try {
            await fsp.writeFile(tmp, records.length > 0 ? `${body}\n` : '', 'utf8');
            await fsp.rename(tmp, ledgerPath);
        } catch (error) {
            await fsp.rm(tmp, { force: true }).catch(() => undefined);
            throw error;
        }
    }

    // ---- persistence (goal metadata only — the ledger lives per-repo) ------

    protected loadFromDisk(): void {
        try {
            if (!fs.existsSync(GOALS_STORE_PATH)) {
                return;
            }
            const raw = fs.readFileSync(GOALS_STORE_PATH, 'utf8');
            const parsed = JSON.parse(raw) as PersistedResearchGoals;
            for (const goal of parsed.goals ?? []) {
                if (goal?.id && goal.cwd && goal.description) {
                    this.goals.set(goal.id, goal);
                }
            }
            for (const [goalId, owner] of Object.entries(parsed.owners ?? {})) {
                if (this.goals.has(goalId)) {
                    this.ownerByGoalId.set(goalId, owner);
                }
            }
        } catch (error) {
            console.warn('[qaap-research] failed to load goal store:', error);
        }
    }

    protected persistGoals(): void {
        try {
            fs.mkdirSync(GOALS_STORE_DIR, { recursive: true, mode: GOALS_DIR_MODE });
            const payload: PersistedResearchGoals = {
                goals: this.list(),
                owners: Object.fromEntries(this.ownerByGoalId),
            };
            writeJsonAtomicSync(GOALS_STORE_PATH, payload, { mode: GOALS_FILE_MODE });
        } catch (error) {
            console.warn('[qaap-research] failed to persist goal store:', error);
        }
    }
}

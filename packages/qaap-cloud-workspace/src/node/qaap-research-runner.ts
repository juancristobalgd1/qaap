// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
    type ResearchAgentModel,
    type ResearchGoal,
    type ResearchGoalStatus,
    type TerminationReason,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import {
    configFingerprint,
    evaluateVerdict,
    parseExperimentProposal,
    parseMetricFromStdout,
    resolveTerminationReason,
    type ResearchExperimentRecord,
    type ResearchMetricValue,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';
import { realChangeFingerprint, type RealFileChange } from '@theia/qaap-mobile-shell/lib/common/qaap-research-realchange';
import { extractAgentTextFromLog, extractAgentTurnError } from '@theia/qaap-mobile-shell/lib/common/qaap-research-agent-log';
import { buildResearchRoundPrompt } from '@theia/qaap-mobile-shell/lib/common/qaap-research-prompt';
import { isQaapAgentTaskFinished, type QaapAgentTask, type QaapAgentTaskEvent } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapResearchStore } from './qaap-research-store';

/** Wall-clock cap for the `measure` phase's metricCommand — parsing a number should be fast. */
const MEASURE_TIMEOUT_MS = 2 * 60 * 1000;
const GIT_COMMAND_TIMEOUT_MS = 15_000;
/** Resume attempts for a `run`-phase whose process was lost to a backend restart, not to a real
 *  command failure. After this many, treat it as an infra failure rather than retry forever. */
const MAX_RUN_RESUME_ATTEMPTS = 2;

/**
 * Wall-clock cap for the preflight probe (see {@link QaapResearchRunner.ensurePreflightPassed}).
 * A trivial "reply READY" turn should settle in seconds; if the CLI is hung this bounds how long
 * a broken agent can block round 1 before the runner gives up and fails the goal.
 */
const PREFLIGHT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Deliberately trivial and explicit: this only needs to prove the agent CLI can authenticate,
 * resolve the requested model, and produce a reply — not that it can plan or use tools. Real
 * incidents this catches (see the round-1 alternative, which burns a whole round discovering the
 * same thing): an expired CLI session ("Not logged in · Please run /login") and an invalid model
 * id (`model_not_found`).
 */
const PREFLIGHT_PROMPT =
    'Preflight check. Reply with exactly the single word: READY. Do not use any tools, do not read files, do not plan.';

/** Path (relative to `goal.cwd`) of the runner-owned ledger file — never product of an experiment.
 *  Excluded from every round's diff AND from the round's commit, so it never contaminates
 *  `git diff --stat` (the anti-stall fallback reads it), `git status` (the repeat-config guard
 *  reads it, see {@link collectRealFileChanges}), or shows up on the `qaap/research/<goalId>`
 *  branch. See {@link roundDiffStat}. */
const LEDGER_RELATIVE_PATH = '.qaap/experiments.jsonl';
const LEDGER_PATHSPEC_EXCLUDE = `:(exclude)${LEDGER_RELATIVE_PATH}`;

const REMINDER_MISSING_BLOCK =
    'Your previous reply did not include a parseable [QAAP experiment] JSON block, so the runner '
    + 'synthesized one from your file changes instead. End your NEXT reply with the marker and the '
    + 'fenced JSON block exactly as specified below — a missing block costs a whole round.';

const REMINDER_NOOP_ROUND =
    'Your previous reply made no repo file changes (the ledger file does not count — the runner owns '
    + 'it, not you) and included no parseable [QAAP experiment] block either, so the runner has nothing '
    + 'to run or measure. Either actually change a file for the lever you are testing, or if you are '
    + 'only reasoning this round, still end your reply with the marker and the fenced JSON block.';

function reminderRepeatedFingerprint(round: number): string {
    return `The actual file changes you made this turn are identical to round ${round}'s (the runner compared `
        + 'the resulting file contents on disk, not the config text you declared — fingerprint collision). '
        + 'Change a DIFFERENT lever this time — repeating a change you already made wastes a full round.';
}

/**
 * Maps the goal's explicit {@link ResearchAgentModel} (if any) onto the task runner's request
 * shape. Passing this as `agentModel` on `create()` makes it win over Settings-alias routing (see
 * `resolveRequestAgentModel` in `qaap-agent-task.ts`) — the fix for propose turns getting routed
 * to a task-kind alias (e.g. NVIDIA/meta-llama) that the goal's `claude` CLI agent cannot spawn.
 * `provider` is validated non-empty by `normalizeResearchGoal` but not against the task runner's
 * narrower provider union, so the cast trusts that validation rather than re-checking it here.
 */
function toAgentTaskModel(agentModel: ResearchAgentModel | undefined): QaapCreateAgentTaskQaiqModel | undefined {
    if (!agentModel) {
        return undefined;
    }
    return {
        provider: agentModel.provider as QaapCreateAgentTaskQaiqModel['provider'],
        vendor: agentModel.vendor ?? 'unknown',
        modelId: agentModel.modelId,
    };
}

/**
 * Owns the auto-researcher v1 loop: propose (an agent task, minutes) → run (the goal's
 * `runCommand`, hours) → measure (the metric command, minutes) → record, repeated until
 * {@link resolveTerminationReason} says stop. See `qaap-research-goal.ts` for why the round is
 * split this way — the agent's own shell tools time out around 30s, so it can never own the `run`
 * phase; only this runner can, because Node can simply `await` for hours.
 *
 * Mirrors {@link QaapWorkHubRoutineRunner} (hooks `QaapAgentTaskRunner.onDidChangeTask`) and
 * {@link QaapAgentTaskRunner.restoreFromDisk} (reconciles state left behind by a backend restart)
 * but drives a multi-phase state machine instead of a single fire-and-forget task per tick.
 */
@injectable()
export class QaapResearchRunner {

    @inject(QaapResearchStore)
    protected readonly store: QaapResearchStore;

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    /** goalId → the task id / synthetic id currently executing, so `cancel` can kill it immediately
     *  instead of waiting out a multi-hour `runCommand`. */
    protected readonly activeExecutionId = new Map<string, string>();
    /** Guards against two loops running concurrently for the same goal (e.g. a duplicate `start`
     *  call racing the boot-time reconciliation). */
    protected readonly loopRunning = new Set<string>();

    @postConstruct()
    protected init(): void {
        void this.reconcileOnBoot();
    }

    /**
     * Resumes every goal left `running` on disk after a backend restart. Mirrors
     * {@link QaapAgentTaskRunner.restoreFromDisk}: the ledger's last record IS the checkpoint, so
     * this never needs its own separate "was interrupted" bookkeeping.
     */
    protected async reconcileOnBoot(): Promise<void> {
        for (const goal of this.store.listRunning()) {
            this.ensureLoop(goal.id);
        }
    }

    /** Starts a freshly created goal's loop. Called by the endpoint right after `store.create`. */
    start(goal: ResearchGoal): void {
        this.ensureLoop(goal.id);
    }

    /** Cancels a running goal: flips its status and kills whatever phase is currently executing. */
    cancel(goalId: string): ResearchGoal | undefined {
        const cancelled = this.store.cancel(goalId);
        const activeId = this.activeExecutionId.get(goalId);
        if (activeId) {
            this.taskRunner.cancel(activeId);
        }
        return cancelled;
    }

    protected ensureLoop(goalId: string): void {
        if (this.loopRunning.has(goalId)) {
            return;
        }
        this.loopRunning.add(goalId);
        void this.runLoop(goalId).finally(() => this.loopRunning.delete(goalId));
    }

    // ---- the loop --------------------------------------------------------

    protected async runLoop(goalId: string): Promise<void> {
        if (!(await this.ensurePreflightPassed(goalId))) {
            // Either the probe failed (goal already terminated as 'infra-broken') or the goal was
            // cancelled/vanished while the probe was in flight. Either way, round 1 must not start.
            return;
        }
        for (;;) {
            const goal = this.store.get(goalId);
            if (!goal || goal.status !== 'running') {
                return;
            }
            const records = this.readRoundLedger(goal);
            const last = records[records.length - 1];
            try {
                if (last && last.phase !== 'done') {
                    await this.resumeRound(goal, last);
                } else {
                    await this.startNewRound(goal, records.length + 1);
                }
            } catch (error) {
                console.error(`[qaap-research] round failed for goal ${goal.id}:`, error instanceof Error ? error.message : error);
                return;
            }
            const refreshed = this.store.get(goalId);
            if (!refreshed || refreshed.status !== 'running') {
                return;
            }
            const reason = resolveTerminationReason(refreshed, this.readRoundLedger(refreshed), Date.now());
            if (reason) {
                this.terminate(refreshed, reason);
                return;
            }
        }
    }

    /** The ledger, excluding the `round: 0` preflight-probe record (see {@link ensurePreflightPassed})
     *  — everything that counts rounds (round numbering, `maxRounds`, stagnation, and infra-failure
     *  streaks via `resolveTerminationReason`) must never see it. */
    protected readRoundLedger(goal: ResearchGoal): ResearchExperimentRecord[] {
        return this.store.readLedgerForGoal(goal).filter(record => !record.preflight);
    }

    /**
     * Runs a cheap, once-per-goal sanity check ahead of round 1: spawns the SAME agent/model as
     * the goal with a trivial "reply READY" prompt and waits for it to settle. This exists because
     * a broken agent — expired CLI auth, an invalid model id — currently gets discovered only
     * after the propose turn burns a whole round on it (see `PREFLIGHT_PROMPT`'s doc for the two
     * real incidents). Detecting it here fails the goal in seconds instead of a round.
     *
     * Idempotent per goal: if a `preflight: true` record already exists (a prior probe already
     * ran, including across a backend restart), this is a no-op that returns `true` immediately.
     *
     * Returns `false` when round 1 must not start — either the probe itself failed (the goal was
     * already terminated as `'infra-broken'` and a `round: 0` record recorded the reason) or the
     * goal was cancelled/vanished while the probe was in flight.
     */
    protected async ensurePreflightPassed(goalId: string): Promise<boolean> {
        const goal = this.store.get(goalId);
        if (!goal || goal.status !== 'running') {
            return false;
        }
        if (this.store.readLedgerForGoal(goal).some(record => record.preflight)) {
            return true;
        }

        const task = this.taskRunner.create({
            cwd: goal.cwd,
            prompt: PREFLIGHT_PROMPT,
            agent: goal.agentId ?? this.taskRunner.defaultAgent(),
            title: `Research preflight: ${goal.description}`,
            autoApprove: true,
            agentModel: toAgentTaskModel(goal.agentModel),
        });
        this.activeExecutionId.set(goal.id, task.id);
        const finished = await this.waitForTaskFinishOrTimeout(task.id, PREFLIGHT_TIMEOUT_MS);
        this.activeExecutionId.delete(goal.id);
        if (this.isCancelled(goal.id)) {
            return false;
        }

        if (!finished) {
            // Timed out: the task may still be running server-side — cancel it so it does not leak.
            this.taskRunner.cancel(task.id);
            this.recordPreflightResult(goal, `preflight failed: timed out after ${Math.round(PREFLIGHT_TIMEOUT_MS / 60_000)} minutes with no response.`);
            this.terminate(goal, 'infra-broken');
            return false;
        }

        const detail = await this.taskRunner.detail(finished.id);
        const stdout = detail?.log ?? '';
        // Same two-signal check as the propose phase (see the BUG 1 comment on `runPropose`): a
        // non-zero exit AND a stream-json `result` event with `is_error: true` while exiting 0
        // (e.g. an expired OAuth session) both mean the CLI itself is broken.
        const turnError = extractAgentTurnError(stdout);
        if (finished.state === 'failed' || turnError) {
            const reason = turnError
                ?? `agent task exited with a non-zero status${finished.exitCode !== undefined ? ` (exit code ${finished.exitCode})` : ''}.`;
            this.recordPreflightResult(goal, `preflight failed: ${reason}`);
            this.terminate(goal, 'infra-broken');
            return false;
        }

        // No literal-"READY" requirement — any non-empty prose means the CLI authenticated,
        // resolved the model, and replied. An empty reply with no error signal at all is still
        // suspicious enough to fail fast on, rather than let round 1 discover it.
        const agentText = extractAgentTextFromLog(stdout).trim();
        if (!agentText) {
            this.recordPreflightResult(goal, 'preflight failed: agent produced no text response.');
            this.terminate(goal, 'infra-broken');
            return false;
        }

        this.recordPreflightResult(goal, undefined);
        return true;
    }

    /** Writes the `round: 0` preflight record. `failureNote` present → verdict `'failed'`, matching
     *  the shape `finishAsInfraFailure` uses for a normal round's infra failure. */
    protected recordPreflightResult(goal: ResearchGoal, failureNote: string | undefined): void {
        const now = Date.now();
        const record: ResearchExperimentRecord = {
            id: randomUUID(),
            goalId: goal.id,
            round: 0,
            startedAt: now,
            finishedAt: now,
            hypothesis: '(preflight)',
            declaredConfig: {},
            declaredConfigFingerprint: '',
            realChangeFingerprint: '',
            phase: 'done',
            metrics: [],
            verdict: failureNote ? 'failed' : undefined,
            notes: failureNote ?? 'preflight ok',
            preflight: true,
        };
        this.store.upsertRecord(goal.cwd, record);
    }

    protected terminate(goal: ResearchGoal, reason: TerminationReason): void {
        const status: ResearchGoalStatus = reason === 'infra-broken' ? 'failed'
            : reason === 'cancelled' ? 'cancelled'
                : 'completed';
        this.store.updateGoal(goal.id, { status, terminationReason: reason });
    }

    protected isCancelled(goalId: string): boolean {
        return this.store.get(goalId)?.status !== 'running';
    }

    // ---- round orchestration ----------------------------------------------

    protected async startNewRound(goal: ResearchGoal, round: number): Promise<void> {
        const skeleton: ResearchExperimentRecord = {
            id: randomUUID(),
            goalId: goal.id,
            round,
            startedAt: Date.now(),
            hypothesis: '',
            declaredConfig: {},
            declaredConfigFingerprint: '',
            realChangeFingerprint: '',
            phase: 'propose',
            metrics: [],
        };
        this.store.upsertRecord(goal.cwd, skeleton);
        await this.runPropose(goal, skeleton, {});
    }

    /** Resumes whichever phase the last record was in when the backend went away. */
    protected async resumeRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        if (record.phase === 'propose') {
            // The propose task's process died with the backend. Idempotent to just re-run it: the
            // agent re-reads the ledger from scratch, so there is no partial state to reconcile.
            await this.runPropose(goal, record, {});
            return;
        }
        if (record.phase === 'run') {
            // The lever is already committed (record.sha is set) — only the long-running process
            // was lost, so re-run runCommand rather than starting the round over.
            await this.runRunPhase(goal, record, true);
            return;
        }
        if (record.phase === 'measure') {
            // run already succeeded; only the (cheap) metric command needs to happen again.
            await this.runMeasurePhase(goal, record);
        }
    }

    // ---- phase: propose -----------------------------------------------------

    protected async runPropose(
        goal: ResearchGoal,
        record: ResearchExperimentRecord,
        options: { readonly reminder?: string; readonly fingerprintRetried?: boolean; readonly noopRetried?: boolean },
    ): Promise<void> {
        const priorRecords = this.store.readLedgerForGoal(goal).filter(existing => existing.id !== record.id);
        let prompt = buildResearchRoundPrompt(goal, priorRecords);
        if (options.reminder) {
            prompt = `${options.reminder}\n\n${prompt}`;
        }
        // Autonomous loop: there is no human in front of this task to approve tool calls, so it
        // must run with skip-permissions on, regardless of any operator-level auto-approve default.
        const task = this.taskRunner.create({
            cwd: goal.cwd,
            prompt,
            agent: goal.agentId ?? this.taskRunner.defaultAgent(),
            title: `Research round ${record.round}: ${goal.description}`,
            autoApprove: true,
            agentModel: toAgentTaskModel(goal.agentModel),
        });
        this.activeExecutionId.set(goal.id, task.id);
        const finished = await this.waitForTaskFinish(task.id);
        this.activeExecutionId.delete(goal.id);
        if (this.isCancelled(goal.id)) {
            return;
        }

        const detail = await this.taskRunner.detail(finished.id);
        const stdout = detail?.log ?? '';

        // THIRD outcome, distinct from both "infra broke" (non-zero exit) and "no-op" (the agent
        // ran but changed nothing): the agent CLI itself reported a terminal failure — e.g. an
        // expired OAuth session — often while still exiting 0. Left undetected, this masquerades
        // as a no-op round ("(no file changes detected)") and burns the whole round budget on an
        // error that will never resolve itself. Check BOTH signals: the task's own terminal state
        // (mirrors how qaap-agent-task-runner.ts marks a spawn/process failure) and the stream-json
        // `result` event's `is_error` flag (catches a CLI that exits 0 having done nothing).
        const turnError = extractAgentTurnError(stdout);
        if (finished.state === 'failed' || turnError) {
            const reason = turnError
                ?? `agent task exited with a non-zero status${finished.exitCode !== undefined ? ` (exit code ${finished.exitCode})` : ''}.`;
            this.finishAsInfraFailure(goal, record, `agent turn failed: ${reason}`, record.runAttempts);
            return;
        }

        // The log is stream-json for QAIQ/Claude Code agents: the agent's actual prose — and with
        // it the [QAAP experiment] block — is JSON-escaped inside `stream_event` envelopes, never
        // present as a literal fence in the raw log. Scrape it out first so the marker regex below
        // can actually match. Plain-text agent logs pass through this unchanged.
        const agentText = extractAgentTextFromLog(stdout);
        const proposal = parseExperimentProposal(agentText);
        const diffStat = this.roundDiffStat(goal.cwd);
        // Anti-stall fallback: a format miss must never cost a night of compute. Synthesize a
        // record from whatever the agent actually changed and keep the loop moving.
        const resolved = proposal ?? this.synthesizeFallbackProposal(diffStat);
        const notes = proposal ? record.notes : this.appendNote(record.notes, REMINDER_MISSING_BLOCK);
        // `declaredConfig`/`declaredConfigFingerprint`: the agent's own self-report. Kept for the
        // ledger/prompt ("what did the agent SAY it changed"), but UNVERIFIED — never the basis for
        // the repeat-config guard below. See the trust-boundary note on `ResearchExperimentRecord`.
        const declaredConfigFingerprint = configFingerprint(resolved.config);

        // The repeat-config guard must rest on what the runner can actually observe changed in the
        // repo, not on the agent's report of it — the same "the runner measures, the agent doesn't
        // self-report" principle already applied to the metric. See `qaap-research-realchange.ts`
        // for the real failure this fixes (declared configs that don't match reality, or the same
        // logical value serialized two different ways across rounds).
        const realChanges = this.collectRealFileChanges(goal.cwd);
        const roundRealChangeFingerprint = realChangeFingerprint(realChanges);
        // Gate on there being any real change at all: an empty real-change set is the no-op guard's
        // territory (below), not "the same experiment repeated" — two reasoning-only rounds with no
        // file changes are not a collision.
        const collidingRound = realChanges.length > 0
            ? priorRecords.find(existing => existing.realChangeFingerprint === roundRealChangeFingerprint)?.round
            : undefined;

        const proposed: ResearchExperimentRecord = {
            ...record,
            hypothesis: resolved.hypothesis,
            symptom: resolved.symptom,
            lever: resolved.lever,
            declaredConfig: resolved.config,
            declaredConfigFingerprint,
            realChangeFingerprint: roundRealChangeFingerprint,
            notes,
        };
        this.store.upsertRecord(goal.cwd, proposed);

        // No-op guard: no repo changes (ledger excluded) AND no parseable proposal means the agent
        // did literally nothing this turn. Never spend an actual runCommand (hours) measuring
        // nothing — re-prompt once, exactly like the fingerprint guard below, then give up on the
        // round as a no-op rather than loop forever on a stubborn agent.
        const isNoop = !proposal && diffStat.trim().length === 0;
        if (isNoop && !options.noopRetried) {
            await this.runPropose(goal, proposed, {
                reminder: REMINDER_NOOP_ROUND,
                fingerprintRetried: options.fingerprintRetried,
                noopRetried: true,
            });
            return;
        }

        if (collidingRound !== undefined && !options.fingerprintRetried) {
            // The prompt is persuasion; the fingerprint is the guarantee — re-prompt exactly once,
            // then accept whatever comes back rather than loop forever on a stubborn agent.
            await this.runPropose(goal, proposed, {
                reminder: reminderRepeatedFingerprint(collidingRound),
                fingerprintRetried: true,
                noopRetried: options.noopRetried,
            });
            return;
        }

        if (isNoop) {
            this.finishAsNoop(goal, proposed);
            return;
        }
        await this.commitRound(goal, proposed);
    }

    protected synthesizeFallbackProposal(diffStat: string):
        { readonly hypothesis: string; readonly symptom?: string; readonly lever?: string; readonly config: Record<string, unknown> } {
        return {
            hypothesis: '(not declared)',
            // The diff itself — not an empty object — so two different fallback rounds fingerprint
            // differently instead of colliding with each other on `{}` every time.
            config: { fallbackDiffStat: diffStat || '(no file changes detected)' },
        };
    }

    /** `git diff --stat`, EXCLUDING the runner's own ledger file — `.qaap/experiments.jsonl` is
     *  written by this runner on every phase transition, not by the agent, so it must never look
     *  like an experiment change (anti-stall fallback config) or a no-op round's only "change". */
    protected roundDiffStat(cwd: string): string {
        return this.runGit(cwd, ['diff', '--stat', '--', '.', LEDGER_PATHSPEC_EXCLUDE]).stdout
            || this.runGit(cwd, ['diff', '--cached', '--stat', '--', '.', LEDGER_PATHSPEC_EXCLUDE]).stdout
            || '';
    }

    /**
     * The runner's own view of what changed on disk this round, via `git status` — never the
     * agent's self-report. This is the source data for `realChangeFingerprint`, the repeat-config
     * guard's actual basis (see the trust-boundary note in `qaap-research-runner.ts`#runPropose and
     * on `ResearchExperimentRecord`). Reads each changed path's CURRENT content straight off disk
     * (not through git, so it reflects the working tree exactly as the next `git add -A` would
     * commit it); a path that git reports deleted is recorded with `content: undefined` instead of
     * being read. The ledger file itself is always excluded — it is runner state, not experiment
     * content (see {@link LEDGER_RELATIVE_PATH}).
     */
    protected collectRealFileChanges(cwd: string): RealFileChange[] {
        const status = this.runGit(cwd, ['status', '--porcelain', '--untracked-files=all']).stdout;
        if (!status) {
            return [];
        }
        const changes: RealFileChange[] = [];
        for (const rawLine of status.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            if (!line.trim()) {
                continue;
            }
            // Porcelain v1: `XY PATH`, or `XY ORIG_PATH -> PATH` for a rename/copy. Treat a rename
            // as a delete of the old path plus a change at the new one, so the resulting-state
            // fingerprint reflects reality regardless of which git chose to call it.
            const codes = line.slice(0, 2);
            const rest = line.slice(3);
            const arrowIndex = rest.indexOf(' -> ');
            if (arrowIndex >= 0) {
                this.pushRealFileChange(changes, cwd, rest.slice(0, arrowIndex), true);
                this.pushRealFileChange(changes, cwd, rest.slice(arrowIndex + 4), false);
                continue;
            }
            this.pushRealFileChange(changes, cwd, rest, codes.includes('D'));
        }
        return changes;
    }

    protected pushRealFileChange(changes: RealFileChange[], cwd: string, rawPath: string, deleted: boolean): void {
        const relativePath = this.unquoteGitPath(rawPath);
        if (!relativePath || relativePath === LEDGER_RELATIVE_PATH) {
            return;
        }
        if (deleted) {
            changes.push({ path: relativePath, content: undefined });
            return;
        }
        try {
            changes.push({ path: relativePath, content: fs.readFileSync(path.join(cwd, relativePath), 'utf8') });
        } catch {
            // Binary content, a symlink, or a race with a concurrent delete: still record the path
            // under a stable marker rather than silently dropping it from the fingerprint — a
            // binary-only round must still be able to collide-detect.
            changes.push({ path: relativePath, content: '(unreadable: binary content or a race with a concurrent change)' });
        }
    }

    /** Strips the double-quoting `git status` applies to paths containing spaces or special
     *  characters. Not a full unescape of git's octal escapes — good enough for the ASCII repo
     *  paths this runner deals with; anything fancier just ends up as a (still-stable) literal. */
    protected unquoteGitPath(rawPath: string): string {
        const trimmed = rawPath.trim();
        if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    }

    /** A round where the agent made no repo changes and proposed nothing parseable, even after one
     *  re-prompt: record it as done without ever touching runCommand/measure, so a format miss can
     *  never cost a real (hours-long) run on top of the round it already wasted. */
    protected finishAsNoop(goal: ResearchGoal, record: ResearchExperimentRecord): void {
        const finished: ResearchExperimentRecord = {
            ...record,
            phase: 'done',
            // Explicit 'noop' verdict (not left `undefined`) so this round counts toward
            // stagnation — a stuck agent that never proposes anything usable IS a lack of
            // progress, and must not let an inert agent quietly exhaust the whole round budget
            // instead of tripping `stagnationRounds`. See {@link resolveTerminationReason}.
            verdict: 'noop',
            notes: this.appendNote(
                record.notes,
                'No-op round: no repo file changes and no parseable [QAAP experiment] block, even after a '
                + 'reminder. Skipped runCommand/measure entirely rather than burn a run on nothing.',
            ),
            finishedAt: Date.now(),
        };
        this.store.upsertRecord(goal.cwd, finished);
    }

    // ---- phase: commit (round → branch) --------------------------------------

    /** Every round is one commit on `qaap/research/<goalId>`, whether or not the agent's proposal
     *  parsed — the fallback path still commits whatever the agent changed. */
    protected async commitRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        const branch = `qaap/research/${goal.id}`;
        const baselineSha = this.runGit(goal.cwd, ['rev-parse', 'HEAD']).stdout || undefined;
        this.runGit(goal.cwd, ['checkout', '-B', branch]);
        // Exclude the ledger: it is runner state, not experiment content, and must never end up in
        // a round's commit on the research branch (see LEDGER_PATHSPEC_EXCLUDE).
        this.runGit(goal.cwd, ['add', '-A', '--', '.', LEDGER_PATHSPEC_EXCLUDE]);
        const message = `research(round ${record.round}): ${(record.lever ?? record.hypothesis).slice(0, 160)}`;
        // --allow-empty: a round whose proposal made no file changes must still get a placeholder
        // commit so `sha`/`baselineSha` stay a consistent per-round chain for revert to walk.
        this.runGit(goal.cwd, ['commit', '--allow-empty', '-m', message]);
        const sha = this.runGit(goal.cwd, ['rev-parse', 'HEAD']).stdout || undefined;

        const committed: ResearchExperimentRecord = {
            ...record,
            sha,
            baselineSha,
            phase: goal.runCommand ? 'run' : 'measure',
        };
        this.store.upsertRecord(goal.cwd, committed);
        if (goal.runCommand) {
            await this.runRunPhase(goal, committed, false);
        } else {
            await this.runMeasurePhase(goal, committed);
        }
    }

    // ---- phase: run (the long-running work) ----------------------------------

    protected async runRunPhase(goal: ResearchGoal, record: ResearchExperimentRecord, isResume: boolean): Promise<void> {
        if (!goal.runCommand) {
            await this.runMeasurePhase(goal, record);
            return;
        }
        const runAttempts = (record.runAttempts ?? 0) + (isResume ? 1 : 0);
        if (isResume && runAttempts > MAX_RUN_RESUME_ATTEMPTS) {
            this.finishAsInfraFailure(goal, record, `runCommand lost its process ${MAX_RUN_RESUME_ATTEMPTS} times across backend `
                + 'restarts; treating as an infra failure rather than retrying indefinitely.', runAttempts);
            return;
        }

        const taskId = record.id;
        this.activeExecutionId.set(goal.id, taskId);
        const result = await this.taskRunner.runGenericCommand(
            goal.runCommand,
            goal.cwd,
            this.buildResearchCommandEnv(),
            taskId,
            goal.runTimeoutMs || DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
            { header: `\n[qaap-research] round ${record.round}: running ${goal.runCommand}\n`, tailOutput: true },
        );
        this.activeExecutionId.delete(goal.id);
        if (this.isCancelled(goal.id)) {
            return;
        }
        if (result.exitCode !== 0) {
            this.finishAsInfraFailure(
                goal,
                record,
                `runCommand exited ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}.`,
                runAttempts,
            );
            return;
        }
        const advanced: ResearchExperimentRecord = { ...record, phase: 'measure', runAttempts };
        this.store.upsertRecord(goal.cwd, advanced);
        await this.runMeasurePhase(goal, advanced);
    }

    // ---- phase: measure -------------------------------------------------------

    protected async runMeasurePhase(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        const primary = goal.metrics.find(metric => metric.primary) ?? goal.metrics[0];
        const metrics: ResearchMetricValue[] = [];
        for (const spec of goal.metrics) {
            const taskId = `${record.id}:${spec.name}`;
            this.activeExecutionId.set(goal.id, taskId);
            const result = await this.taskRunner.runGenericCommand(
                spec.metricCommand,
                goal.cwd,
                this.buildResearchCommandEnv(),
                taskId,
                MEASURE_TIMEOUT_MS,
                { header: `\n[qaap-research] round ${record.round}: measuring ${spec.name}\n`, tailOutput: true },
            );
            this.activeExecutionId.delete(goal.id);
            if (this.isCancelled(goal.id)) {
                return;
            }
            const value = result.exitCode === 0 ? parseMetricFromStdout(result.stdout, spec) : undefined;
            if (value === undefined) {
                this.finishAsInfraFailure(goal, record, `metricCommand for "${spec.name}" failed or produced an unparseable value.`, record.runAttempts);
                return;
            }
            metrics.push({ name: spec.name, value, direction: spec.direction });
        }
        if (!primary) {
            this.finishAsInfraFailure(goal, record, 'Goal has no metrics to evaluate.', record.runAttempts);
            return;
        }
        const primaryValue = metrics.find(metric => metric.name === primary.name)!.value;
        const best = this.store.bestSoFar(goal, primary);
        const { verdict, delta } = evaluateVerdict(primaryValue, best, primary);
        const measured: ResearchExperimentRecord = {
            ...record,
            phase: 'done',
            metrics,
            verdict,
            delta,
            bestSoFar: verdict === 'improved' ? primaryValue : best,
            finishedAt: Date.now(),
        };
        this.store.upsertRecord(goal.cwd, measured);
        if (verdict === 'regressed') {
            await this.revertRound(goal, measured);
        }
    }

    protected finishAsInfraFailure(goal: ResearchGoal, record: ResearchExperimentRecord, reason: string, runAttempts: number | undefined): void {
        const failed: ResearchExperimentRecord = {
            ...record,
            phase: 'done',
            verdict: 'failed',
            notes: this.appendNote(record.notes, reason),
            finishedAt: Date.now(),
            runAttempts,
        };
        this.store.upsertRecord(goal.cwd, failed);
    }

    // ---- discard a regression --------------------------------------------------

    /** `git revert`, NEVER `reset --hard` — the agent workflow itself forbids destructive resets
     *  (`DESTRUCTIVE_COMMANDS_MARKER`), and the runner holds itself to the same rule. */
    protected async revertRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        if (!record.sha) {
            return;
        }
        const taskId = `${record.id}:revert`;
        const result = await this.taskRunner.runGenericCommand(
            `git revert --no-edit ${this.shellQuote(record.sha)}`,
            goal.cwd,
            this.buildResearchCommandEnv(),
            taskId,
            GIT_COMMAND_TIMEOUT_MS,
            { header: `\n[qaap-research] round ${record.round}: reverting regression\n`, tailOutput: true },
        );
        if (result.exitCode === 0) {
            this.store.upsertRecord(goal.cwd, { ...record, reverted: true });
        } else {
            this.store.upsertRecord(goal.cwd, {
                ...record,
                notes: this.appendNote(record.notes, `git revert failed (exit ${result.exitCode}); regression left in place — needs a human look.`),
            });
        }
    }

    // ---- small helpers ---------------------------------------------------------

    protected waitForTaskFinish(taskId: string): Promise<QaapAgentTask> {
        return new Promise(resolve => {
            const disposable = this.taskRunner.onDidChangeTask((event: QaapAgentTaskEvent) => {
                if (event.task.id !== taskId || !isQaapAgentTaskFinished(event.task.state)) {
                    return;
                }
                disposable.dispose();
                resolve(event.task);
            });
        });
    }

    /** {@link waitForTaskFinish}, but resolves `undefined` instead of hanging forever if the task
     *  never settles within `timeoutMs` — only used for the preflight probe, which must not be
     *  able to block round 1 indefinitely on a hung CLI. */
    protected waitForTaskFinishOrTimeout(taskId: string, timeoutMs: number): Promise<QaapAgentTask | undefined> {
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(undefined);
            }, timeoutMs);
            this.waitForTaskFinish(taskId).then(task => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(task);
            });
        });
    }

    protected appendNote(existing: string | undefined, note: string): string {
        return existing ? `${existing}\n${note}` : note;
    }

    protected buildResearchCommandEnv(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };
        this.taskRunner.applyHelperEnv(env);
        return env;
    }

    protected runGit(cwd: string, args: readonly string[]): { readonly stdout: string; readonly ok: boolean } {
        try {
            const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_COMMAND_TIMEOUT_MS });
            return { stdout: (result.stdout ?? '').trim(), ok: result.status === 0 };
        } catch {
            return { stdout: '', ok: false };
        }
    }

    /** POSIX single-quote escaping so a sha is passed as one safe shell argument. */
    protected shellQuote(value: string): string {
        return `'${value.split('\'').join('\'\\\'\'')}'`;
    }
}

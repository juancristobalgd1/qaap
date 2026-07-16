// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import {
    DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
    type ResearchGoal,
    type ResearchGoalStatus,
    type TerminationReason,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import {
    configFingerprint,
    evaluateVerdict,
    parseExperimentProposal,
    parseMetricFromStdout,
    resolveTerminationReason,
    type ResearchExperimentRecord,
    type ResearchMetricValue,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';
import { extractAgentTextFromLog } from '@theia/qaap-mobile-shell/lib/common/qaap-research-agent-log';
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

/** Runner-owned state, never product of an experiment: excluded from every round's diff AND from
 *  the round's commit, so it never contaminates `git diff --stat` (the anti-stall fallback reads
 *  it) or shows up on the `qaap/research/<goalId>` branch. See {@link roundDiffStat}. */
const LEDGER_PATHSPEC_EXCLUDE = ':(exclude).qaap/experiments.jsonl';

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
    return `Your proposed config matches round ${round}'s config exactly (fingerprint collision). `
        + 'Change a DIFFERENT lever this time — repeating a config you already tried wastes a full round.';
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
        for (;;) {
            const goal = this.store.get(goalId);
            if (!goal || goal.status !== 'running') {
                return;
            }
            const records = this.store.readLedgerForGoal(goal);
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
            const reason = resolveTerminationReason(refreshed, this.store.readLedgerForGoal(refreshed), Date.now());
            if (reason) {
                this.terminate(refreshed, reason);
                return;
            }
        }
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
            config: {},
            configFingerprint: '',
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
        });
        this.activeExecutionId.set(goal.id, task.id);
        const finished = await this.waitForTaskFinish(task.id);
        this.activeExecutionId.delete(goal.id);
        if (this.isCancelled(goal.id)) {
            return;
        }

        const detail = await this.taskRunner.detail(finished.id);
        const stdout = detail?.log ?? '';
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
        const fingerprint = configFingerprint(resolved.config);
        const collidingRound = priorRecords.find(existing => existing.configFingerprint === fingerprint)?.round;

        const proposed: ResearchExperimentRecord = {
            ...record,
            hypothesis: resolved.hypothesis,
            symptom: resolved.symptom,
            lever: resolved.lever,
            config: resolved.config,
            configFingerprint: fingerprint,
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

    /** A round where the agent made no repo changes and proposed nothing parseable, even after one
     *  re-prompt: record it as done without ever touching runCommand/measure, so a format miss can
     *  never cost a real (hours-long) run on top of the round it already wasted. */
    protected finishAsNoop(goal: ResearchGoal, record: ResearchExperimentRecord): void {
        const finished: ResearchExperimentRecord = {
            ...record,
            phase: 'done',
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

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import {
    DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
    type ResearchAgentModel,
    type ResearchGoal,
    type ResearchGoalStatus,
    type ResearchMetricSpec,
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
import { parseAgentBlockedSignal } from '../common/qaap-agent-default-workflow';
import { QaapAgentTaskRunner, type QaapGenericCommandResult } from './qaap-agent-task-runner';
import { QaapResearchStore } from './qaap-research-store';
import { cancelExtracted, collectRealFileChangesExtracted, ensureLoopExtracted, ensurePreflightPassedExtracted, pushRealFileChangeExtracted, reconcileOnBootExtracted, recordPreflightResultExtracted, resumeRoundExtracted, roundDiffStatExtracted, runLoopExtracted, runProposeExtracted, startNewRoundExtracted, synthesizeFallbackProposalExtracted, terminateExtracted, unquoteGitPathExtracted } from './qaap-research-runner-render2';
import { appendCommandOutputExtracted, buildResearchCommandEnvExtracted, commitRoundChangesExtracted, commitRoundExtracted, describeGateFailureExtracted, discardBrokenRoundExtracted, finishAsInfraFailureExtracted, finishAsNoopExtracted, revertRoundExtracted, runGitExtracted, runMeasurePhaseExtracted, runRunPhaseExtracted, waitForTaskFinishExtracted, waitForTaskFinishOrTimeoutExtracted } from './qaap-research-runner-streaming2';

/** Minimum wall-clock allowance for a `measure` phase. */
const MIN_MEASURE_TIMEOUT_MS = 2 * 60 * 1000;
/** Metric commands are post-processing, not the potentially multi-hour training run. */
const MAX_MEASURE_TIMEOUT_MS = 10 * 60 * 1000;
/** Per stdout/stderr stream; the task log still receives its normal diagnostic tail on disk. */
export const RESEARCH_COMMAND_CAPTURE_MAX_CHARS = 256 * 1024;
/** Bounds input copied into the metric parser and its isolated regex worker. */
const RESEARCH_METRIC_PARSE_MAX_CHARS = RESEARCH_COMMAND_CAPTURE_MAX_CHARS;
const METRIC_REGEX_TIMEOUT_MS = 250;
export const GIT_COMMAND_TIMEOUT_MS = 15_000;
/** Keep failed command diagnostics useful without turning the JSONL ledger into a copy of a
 *  multi-hour training log. The full 12k tail remains in the task log; this smaller excerpt is
 *  included in the experiment record that the next research round actually reads. */
export const COMMAND_FAILURE_OUTPUT_TAIL_CHARS = 2_000;
/** Resume attempts for a `run`-phase whose process was lost to a backend restart, not to a real
 *  command failure. After this many, treat it as an infra failure rather than retry forever. */
export const MAX_RUN_RESUME_ATTEMPTS = 2;

/**
 * Wall-clock cap for the preflight probe (see {@link QaapResearchRunner.ensurePreflightPassed}).
 * A trivial "reply READY" turn should settle in seconds; if the CLI is hung this bounds how long
 * a broken agent can block round 1 before the runner gives up and fails the goal.
 */
export const PREFLIGHT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Deliberately trivial and explicit: this only needs to prove the agent CLI can authenticate,
 * resolve the requested model, and produce a reply — not that it can plan or use tools. Real
 * incidents this catches (see the round-1 alternative, which burns a whole round discovering the
 * same thing): an expired CLI session ("Not logged in · Please run /login") and an invalid model
 * id (`model_not_found`).
 */
export const PREFLIGHT_PROMPT =
    'Preflight check. Reply with exactly the single word: READY. Do not use any tools, do not read files, do not plan.';

const METRIC_REGEX_WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
let value = null;
try {
    const match = new RegExp(workerData.pattern).exec(workerData.stdout);
    if (match) {
        const parsed = Number(match[1] ?? match[0]);
        if (Number.isFinite(parsed)) {
            value = parsed;
        }
    }
} catch {
    // Invalid expressions are rejected during goal normalization; still fail closed for legacy data.
}
parentPort.postMessage({ value });
`;

/** Path (relative to `goal.cwd`) of the runner-owned ledger file — never product of an experiment.
 *  Excluded from every round's diff AND from the round's commit, so it never contaminates
 *  `git diff --stat` (the anti-stall fallback reads it), `git status` (the repeat-config guard
 *  reads it, see {@link collectRealFileChanges}), or shows up on the `qaap/research/<goalId>`
 *  branch. See {@link roundDiffStat}. */
export const LEDGER_RELATIVE_PATH = '.qaap/experiments.jsonl';
export const LEDGER_PATHSPEC_EXCLUDE = `:(exclude)${LEDGER_RELATIVE_PATH}`;

export const REMINDER_MISSING_BLOCK =
    'Your previous reply did not include a parseable [QAAP experiment] JSON block, so the runner '
    + 'synthesized one from your file changes instead. End your NEXT reply with the marker and the '
    + 'fenced JSON block exactly as specified below — a missing block costs a whole round.';

export const REMINDER_NOOP_ROUND =
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
 * A metric command gets enough time for normal evaluation, but never inherits the multi-hour
 * training allowance. An explicit goal deadline remains the harder boundary.
 */
export function resolveResearchMeasureTimeoutMs(goal: ResearchGoal, now = Date.now()): number {
    const configured = Math.min(MAX_MEASURE_TIMEOUT_MS, Math.max(MIN_MEASURE_TIMEOUT_MS, goal.runTimeoutMs));
    if (goal.deadlineAt === undefined) {
        return configured;
    }
    return Math.max(1, Math.min(configured, goal.deadlineAt - now));
}

function parseMetricRegexWithTimeout(stdout: string, pattern: string): Promise<number | undefined> {
    return new Promise(resolve => {
        let worker: Worker;
        try {
            worker = new Worker(METRIC_REGEX_WORKER_SOURCE, {
                eval: true,
                workerData: { stdout, pattern },
            });
        } catch {
            resolve(undefined);
            return;
        }
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (value: number | undefined): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            void worker.terminate();
            resolve(value);
        };
        worker.once('message', (message: unknown) => {
            const candidate = typeof message === 'object' && message !== null
                ? (message as { value?: unknown }).value
                : undefined;
            settle(typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined);
        });
        worker.once('error', () => settle(undefined));
        worker.once('exit', () => settle(undefined));
        timer = setTimeout(() => settle(undefined), METRIC_REGEX_TIMEOUT_MS);
    });
}

/**
 * Parses bounded metric output. Regex extractors run in a worker so pathological backtracking
 * cannot block the backend event loop; JSON extractors fail closed when their document was cut.
 */
export async function parseResearchMetricFromStdout(stdout: string, spec: ResearchMetricSpec): Promise<number | undefined> {
    if (spec.metricJsonPath && stdout.length > RESEARCH_METRIC_PARSE_MAX_CHARS) {
        return undefined;
    }
    const parseInput = stdout.length > RESEARCH_METRIC_PARSE_MAX_CHARS
        ? stdout.slice(-RESEARCH_METRIC_PARSE_MAX_CHARS)
        : stdout;
    if (spec.metricRegex) {
        return parseMetricRegexWithTimeout(parseInput, spec.metricRegex);
    }
    return parseMetricFromStdout(parseInput, spec);
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


    /**
     * Starts a ledger write. Returns a Promise only for the real async store; sync test doubles
     * return `undefined` so callers can skip `await` and avoid an unconditional microtask yield.
     */
    protected beginLedgerWrite(cwd: string, record: ResearchExperimentRecord): undefined | Promise<void> {
        const pending = this.store.upsertRecord(cwd, record) as void | Promise<void>;
        return pending ? pending : undefined;
    }


    @postConstruct()
    protected init(): void {
        void this.reconcileOnBoot();
    }

    protected async reconcileOnBoot(): Promise<void> {
        return reconcileOnBootExtracted(this);
    }

    /** Starts a freshly created goal's loop. Called by the endpoint right after `store.create`. */
    start(goal: ResearchGoal): void {
        this.ensureLoop(goal.id);
    }

    cancel(goalId: string): ResearchGoal | undefined {
        return cancelExtracted(this, goalId);
    }

    protected ensureLoop(goalId: string): void {
        ensureLoopExtracted(this, goalId);
    }

    // ---- the loop --------------------------------------------------------

    protected async runLoop(goalId: string): Promise<void> {
        return runLoopExtracted(this, goalId);
    }

    /** The ledger, excluding the `round: 0` preflight-probe record (see {@link ensurePreflightPassed})
     *  — everything that counts rounds (round numbering, `maxRounds`, stagnation, and infra-failure
     *  streaks via `resolveTerminationReason`) must never see it. */
    protected readRoundLedger(goal: ResearchGoal): ResearchExperimentRecord[] {
        return this.store.readLedgerForGoal(goal).filter(record => !record.preflight);
    }

    protected async ensurePreflightPassed(goalId: string): Promise<boolean> {
        return ensurePreflightPassedExtracted(this, goalId);
    }

    protected async recordPreflightResult(goal: ResearchGoal, failureNote: string | undefined): Promise<void> {
        return recordPreflightResultExtracted(this, goal, failureNote);
    }

    protected terminate(goal: ResearchGoal, reason: TerminationReason): void {
        terminateExtracted(this, goal, reason);
    }

    protected isCancelled(goalId: string): boolean {
        return this.store.get(goalId)?.status !== 'running';
    }

    // ---- round orchestration ----------------------------------------------

    protected async startNewRound(goal: ResearchGoal, round: number): Promise<void> {
        return startNewRoundExtracted(this, goal, round);
    }

    protected async resumeRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        return resumeRoundExtracted(this, goal, record);
    }

    // ---- phase: propose -----------------------------------------------------

    protected async runPropose(goal: ResearchGoal, record: ResearchExperimentRecord, options: { readonly reminder?: string; readonly fingerprintRetried?: boolean; readonly noopRetried?: boolean },): Promise<void> {
        return runProposeExtracted(this, goal, record, options);
    }

    protected synthesizeFallbackProposal(diffStat: string): { readonly hypothesis: string; readonly symptom?: string; readonly lever?: string; readonly config: Record<string, unknown> } {
        return synthesizeFallbackProposalExtracted(this, diffStat);
    }

    protected roundDiffStat(cwd: string): string {
        return roundDiffStatExtracted(this, cwd);
    }

    protected collectRealFileChanges(cwd: string): RealFileChange[] {
        return collectRealFileChangesExtracted(this, cwd);
    }

    protected pushRealFileChange(changes: RealFileChange[], cwd: string, rawPath: string, deleted: boolean): void {
        pushRealFileChangeExtracted(this, changes, cwd, rawPath, deleted);
    }

    protected unquoteGitPath(rawPath: string): string {
        return unquoteGitPathExtracted(this, rawPath);
    }

    protected async finishAsNoop(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        return finishAsNoopExtracted(this, goal, record);
    }

    // ---- phase: commit (round → branch) --------------------------------------

    protected async commitRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        return commitRoundExtracted(this, goal, record);
    }

    protected commitRoundChanges(goal: ResearchGoal, record: ResearchExperimentRecord): {
        sha?: string;
        baselineSha?: string;
        adoptedAgentCommits?: number;
    } {
        return commitRoundChangesExtracted(this, goal, record);
    }

    protected async discardBrokenRound(goal: ResearchGoal, record: ResearchExperimentRecord, reason: string): Promise<void> {
        return discardBrokenRoundExtracted(this, goal, record, reason);
    }

    protected describeGateFailure(task: QaapAgentTask): string {
        return describeGateFailureExtracted(this, task);
    }

    // ---- phase: run (the long-running work) ----------------------------------

    protected async runRunPhase(goal: ResearchGoal, record: ResearchExperimentRecord, isResume: boolean): Promise<void> {
        return runRunPhaseExtracted(this, goal, record, isResume);
    }

    // ---- phase: measure -------------------------------------------------------

    protected async runMeasurePhase(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        return runMeasurePhaseExtracted(this, goal, record);
    }

    protected async finishAsInfraFailure(goal: ResearchGoal, record: ResearchExperimentRecord, reason: string, runAttempts: number | undefined): Promise<void> {
        return finishAsInfraFailureExtracted(this, goal, record, reason, runAttempts);
    }

    // ---- discard a regression --------------------------------------------------

    protected async revertRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        return revertRoundExtracted(this, goal, record);
    }

    // ---- small helpers ---------------------------------------------------------

    protected waitForTaskFinish(taskId: string): Promise<QaapAgentTask> {
        return waitForTaskFinishExtracted(this, taskId);
    }

    protected waitForTaskFinishOrTimeout(taskId: string, timeoutMs: number): Promise<QaapAgentTask | undefined> {
        return waitForTaskFinishOrTimeoutExtracted(this, taskId, timeoutMs);
    }

    protected appendNote(existing: string | undefined, note: string): string {
        return existing ? `${existing}\n${note}` : note;
    }

    protected describeCommandFailure(label: string, result: QaapGenericCommandResult): string {
        const reason = `${label} exited ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}.`;
        return this.appendCommandOutput(reason, result);
    }

    protected appendCommandOutput(reason: string, result: QaapGenericCommandResult): string {
        return appendCommandOutputExtracted(this, reason, result);
    }

    protected buildResearchCommandEnv(): NodeJS.ProcessEnv {
        return buildResearchCommandEnvExtracted(this);
    }

    protected runGit(cwd: string, args: readonly string[]): { readonly stdout: string; readonly ok: boolean } {
        return runGitExtracted(this, cwd, args);
    }

    /** POSIX single-quote escaping so a sha is passed as one safe shell argument. */
    protected shellQuote(value: string): string {
        return `'${value.split('\'').join('\'\\\'\'')}'`;
    }
}

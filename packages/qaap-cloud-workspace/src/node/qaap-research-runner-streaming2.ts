// Extracted from qaap-research-runner.ts
import type { QaapResearchRoundCommit, QaapResearchRunnerContext } from './qaap-research-runner-context';

import { spawnSync } from 'child_process';
import {
    DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
    type ResearchGoal,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import {
    evaluateVerdict,
    type ResearchExperimentRecord,
    type ResearchMetricValue,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';
import { isQaapAgentTaskFinished, type QaapAgentTask, type QaapAgentTaskEvent } from '../common/qaap-agent-task';
import { type QaapGenericCommandResult } from './qaap-agent-task-runner';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { COMMAND_FAILURE_OUTPUT_TAIL_CHARS, GIT_COMMAND_TIMEOUT_MS, LEDGER_PATHSPEC_EXCLUDE, MAX_RUN_RESUME_ATTEMPTS, RESEARCH_COMMAND_CAPTURE_MAX_CHARS } from './qaap-research-runner';
import { resolveResearchMeasureTimeoutMs } from './qaap-research-runner';
import { parseResearchMetricFromStdout } from './qaap-research-runner';

export async function finishAsNoopExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        const finished: ResearchExperimentRecord = {
            ...record,
            phase: 'done',
            // Explicit 'noop' verdict (not left `undefined`) so this round counts toward
            // stagnation — a stuck agent that never proposes anything usable IS a lack of
            // progress, and must not let an inert agent quietly exhaust the whole round budget
            // instead of tripping `stagnationRounds`. See {@link resolveTerminationReason}.
            verdict: 'noop',
            notes: ctx.appendNote(
                record.notes,
                'No-op round: no repo file changes and no parseable [QAAP experiment] block, even after a '
                + 'reminder. Skipped runCommand/measure entirely rather than burn a run on nothing.',
            ),
            finishedAt: Date.now(),
        };
        const pending = ctx.beginLedgerWrite(goal.cwd, finished);
        if (pending) {
            await pending;
        }
}

export async function commitRoundExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        const { sha, baselineSha, adoptedAgentCommits } = ctx.commitRoundChanges(goal, record);
        const committed: ResearchExperimentRecord = {
            ...record,
            sha,
            baselineSha,
            notes: adoptedAgentCommits
                ? ctx.appendNote(record.notes,
                    `Agent advanced HEAD by ${adoptedAgentCommits} commit(s); adopted the resulting HEAD as the round audit instead of creating a duplicate commit.`)
                : record.notes,
            phase: goal.runCommand ? 'run' : 'measure',
        };
        const pending = ctx.beginLedgerWrite(goal.cwd, committed);
        if (pending) {
            await pending;
        }
        if (goal.runCommand) {
            await ctx.runRunPhase(goal, committed, false);
        } else {
            await ctx.runMeasurePhase(goal, committed);
        }
}

export function commitRoundChangesExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord): QaapResearchRoundCommit {
        const branch = `qaap/research/${goal.id}`;
        const baselineSha = record.baselineSha ?? (ctx.runGit(goal.cwd, ['rev-parse', 'HEAD']).stdout || undefined);
        if (baselineSha) {
            const agentCommitCountResult = ctx.runGit(goal.cwd, ['rev-list', '--count', `${baselineSha}..HEAD`]);
            const agentCommitCount = agentCommitCountResult.ok && /^\d+$/.test(agentCommitCountResult.stdout)
                ? Number(agentCommitCountResult.stdout)
                : 0;
            if (agentCommitCount > 0) {
                // The agent violated the prompt and committed on its own. Preserve that history
                // as the round audit instead of stacking Qaap's otherwise-automatic commit on top
                // of it. This is deliberately non-destructive: no reset/rewrite of agent work.
                ctx.runGit(goal.cwd, ['checkout', '-B', branch]);
                const sha = ctx.runGit(goal.cwd, ['rev-parse', 'HEAD']).stdout || undefined;
                return { sha, baselineSha, adoptedAgentCommits: agentCommitCount };
            }
        }
        ctx.runGit(goal.cwd, ['checkout', '-B', branch]);
        // Exclude the ledger: it is runner state, not experiment content, and must never end up in
        // a round's commit on the research branch (see LEDGER_PATHSPEC_EXCLUDE).
        ctx.runGit(goal.cwd, ['add', '-A', '--', '.', LEDGER_PATHSPEC_EXCLUDE]);
        const message = `research(round ${record.round}): ${(record.lever ?? record.hypothesis).slice(0, 160)}`;
        // --allow-empty: a round whose proposal made no file changes must still get a placeholder
        // commit so `sha`/`baselineSha` stay a consistent per-round chain for revert to walk.
        ctx.runGit(goal.cwd, ['commit', '--allow-empty', '-m', message]);
        const sha = ctx.runGit(goal.cwd, ['rev-parse', 'HEAD']).stdout || undefined;
        return { sha, baselineSha };
}

export async function discardBrokenRoundExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord, reason: string): Promise<void> {
        const { sha, baselineSha, adoptedAgentCommits } = ctx.commitRoundChanges(goal, record);
        const failed: ResearchExperimentRecord = {
            ...record,
            sha,
            baselineSha,
            phase: 'done',
            verdict: 'failed',
            notes: ctx.appendNote(
                adoptedAgentCommits
                    ? ctx.appendNote(record.notes,
                        `Agent advanced HEAD by ${adoptedAgentCommits} commit(s); adopted the resulting HEAD as the round audit instead of creating a duplicate commit.`)
                    : record.notes,
                `Change-quality gate: ${reason} Skipped runCommand/measure; round committed and reverted.`,
            ),
            finishedAt: Date.now(),
        };
        const pending = ctx.beginLedgerWrite(goal.cwd, failed);
        if (pending) {
            await pending;
        }
        await ctx.revertRound(goal, failed);
}

export function describeGateFailureExtracted(ctx: QaapResearchRunnerContext, task: QaapAgentTask): string {
        if (task.verification?.status === 'failed') {
            return `verification stayed red after the fix-turn budget (${task.verification.command}): ${task.verification.summary}`;
        }
        if (task.review?.status === 'failed') {
            return `independent review rejected the change: ${task.review.reason || 'no reason given'}`;
        }
        return 'the task closed with warnings.';
}

export async function runRunPhaseExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord, isResume: boolean): Promise<void> {
        if (!goal.runCommand) {
            await ctx.runMeasurePhase(goal, record);
            return;
        }
        const runAttempts = (record.runAttempts ?? 0) + (isResume ? 1 : 0);
        if (isResume && runAttempts > MAX_RUN_RESUME_ATTEMPTS) {
            await ctx.finishAsInfraFailure(goal, record, `runCommand lost its process ${MAX_RUN_RESUME_ATTEMPTS} times across backend `
                + 'restarts; treating as an infra failure rather than retrying indefinitely.', runAttempts);
            return;
        }

        const taskId = record.id;
        ctx.activeExecutionId.set(goal.id, taskId);
        const result = await ctx.taskRunner.runGenericCommand(
            goal.runCommand,
            goal.cwd,
            ctx.buildResearchCommandEnv(ctx.store.ownerOf(goal.id)),
            taskId,
            goal.runTimeoutMs || DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
            {
                header: `\n[qaap-research] round ${record.round}: running ${goal.runCommand}\n`,
                tailOutput: true,
                maxCaptureChars: RESEARCH_COMMAND_CAPTURE_MAX_CHARS,
                ownerLogin: ctx.store.ownerOf(goal.id),
            },
        );
        ctx.activeExecutionId.delete(goal.id);
        if (ctx.isCancelled(goal.id)) {
            return;
        }
        if (result.exitCode !== 0) {
            await ctx.finishAsInfraFailure(
                goal,
                record,
                ctx.describeCommandFailure('runCommand', result),
                runAttempts,
            );
            return;
        }
        const advanced: ResearchExperimentRecord = { ...record, phase: 'measure', runAttempts };
        const pending = ctx.beginLedgerWrite(goal.cwd, advanced);
        if (pending) {
            await pending;
        }
        await ctx.runMeasurePhase(goal, advanced);
}

export async function runMeasurePhaseExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        const primary = goal.metrics.find(metric => metric.primary) ?? goal.metrics[0];
        const metrics: ResearchMetricValue[] = [];
        for (const spec of goal.metrics) {
            const taskId = `${record.id}:${spec.name}`;
            ctx.activeExecutionId.set(goal.id, taskId);
            const result = await ctx.taskRunner.runGenericCommand(
                spec.metricCommand,
                goal.cwd,
                ctx.buildResearchCommandEnv(ctx.store.ownerOf(goal.id)),
                taskId,
                resolveResearchMeasureTimeoutMs(goal),
                {
                    header: `\n[qaap-research] round ${record.round}: measuring ${spec.name}\n`,
                    tailOutput: true,
                    maxCaptureChars: RESEARCH_COMMAND_CAPTURE_MAX_CHARS,
                    ownerLogin: ctx.store.ownerOf(goal.id),
                },
            );
            ctx.activeExecutionId.delete(goal.id);
            if (ctx.isCancelled(goal.id)) {
                return;
            }
            const value = result.exitCode === 0 ? await parseResearchMetricFromStdout(result.stdout, spec) : undefined;
            if (value === undefined) {
                const reason = result.exitCode === 0
                    ? ctx.appendCommandOutput(`metricCommand for "${spec.name}" produced an unparseable value.`, result)
                    : ctx.describeCommandFailure(`metricCommand for "${spec.name}"`, result);
                await ctx.finishAsInfraFailure(goal, record, reason, record.runAttempts);
                return;
            }
            metrics.push({ name: spec.name, value, direction: spec.direction });
        }
        if (!primary) {
            await ctx.finishAsInfraFailure(goal, record, 'Goal has no metrics to evaluate.', record.runAttempts);
            return;
        }
        const primaryValue = metrics.find(metric => metric.name === primary.name)!.value;
        const best = ctx.store.bestSoFar(goal, primary);
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
        const pending = ctx.beginLedgerWrite(goal.cwd, measured);
        if (pending) {
            await pending;
        }
        if (verdict === 'regressed') {
            await ctx.revertRound(goal, measured);
        }
}

export async function finishAsInfraFailureExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord, reason: string, runAttempts: number | undefined): Promise<void> {
        const failed: ResearchExperimentRecord = {
            ...record,
            phase: 'done',
            verdict: 'failed',
            notes: ctx.appendNote(record.notes, reason),
            finishedAt: Date.now(),
            runAttempts,
        };
        const pending = ctx.beginLedgerWrite(goal.cwd, failed);
        if (pending) {
            await pending;
        }
}

export async function revertRoundExtracted(ctx: QaapResearchRunnerContext, goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        if (!record.sha) {
            return;
        }
        const taskId = `${record.id}:revert`;
        const result = await ctx.taskRunner.runGenericCommand(
            `git revert --no-edit ${ctx.shellQuote(record.sha)}`,
            goal.cwd,
            ctx.buildResearchCommandEnv(ctx.store.ownerOf(goal.id)),
            taskId,
            GIT_COMMAND_TIMEOUT_MS,
            {
                header: `\n[qaap-research] round ${record.round}: reverting regression\n`,
                tailOutput: true,
                maxCaptureChars: RESEARCH_COMMAND_CAPTURE_MAX_CHARS,
                ownerLogin: ctx.store.ownerOf(goal.id),
            },
        );
        if (result.exitCode === 0) {
            const pending = ctx.beginLedgerWrite(goal.cwd, { ...record, reverted: true });
            if (pending) {
                await pending;
            }
        } else {
            const pending = ctx.beginLedgerWrite(goal.cwd, {
                ...record,
                notes: ctx.appendNote(record.notes, `git revert failed (exit ${result.exitCode}); regression left in place — needs a human look.`),
            });
            if (pending) {
                await pending;
            }
        }
}

export function waitForTaskFinishExtracted(ctx: QaapResearchRunnerContext, taskId: string): Promise<QaapAgentTask> {
        return new Promise(resolve => {
            const disposable = ctx.taskRunner.onDidChangeTask((event: QaapAgentTaskEvent) => {
                if (event.task.id !== taskId || !isQaapAgentTaskFinished(event.task.state)) {
                    return;
                }
                disposable.dispose();
                resolve(event.task);
            });
        });
}

export function waitForTaskFinishOrTimeoutExtracted(ctx: QaapResearchRunnerContext, taskId: string, timeoutMs: number): Promise<QaapAgentTask | undefined> {
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(undefined);
            }, timeoutMs);
            ctx.waitForTaskFinish(taskId).then(task => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(task);
            });
        });
}

export function appendCommandOutputExtracted(ctx: QaapResearchRunnerContext, reason: string, result: QaapGenericCommandResult): string {
        const output = `${result.stdout}\n${result.stderr}`
            // Normalize terminal progress updates and remove ANSI control sequences before the
            // excerpt is persisted in JSONL and later embedded in an agent prompt.
            .replace(/\r/g, '\n')
            .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
            .trim();
        if (!output) {
            return reason;
        }
        const tail = output.length <= COMMAND_FAILURE_OUTPUT_TAIL_CHARS
            ? output
            : `...[truncated]...\n${output.slice(-COMMAND_FAILURE_OUTPUT_TAIL_CHARS)}`;
        return `${reason}\nCaptured output tail:\n${tail}`;
}

export function buildResearchCommandEnvExtracted(ctx: QaapResearchRunnerContext, ownerLogin?: string): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = { ...process.env };
        // Research commands are autonomous tenant work too. Never fall back to the
        // backend-wide helper token: the owner is resolved from the goal at every phase.
        ctx.taskRunner.applyHelperEnv(env, ownerLogin);
        return env;
}

export function runGitExtracted(ctx: QaapResearchRunnerContext, cwd: string, args: readonly string[]): { readonly stdout: string; readonly ok: boolean } {
        try {
            if (isQaapHostedEnvironment()) {
                if (!ctx.tenantSpawn) {
                    return { stdout: '', ok: false };
                }
                const wrapped = ctx.tenantSpawn.wrapGitForTenant(cwd, args);
                const baseEnv: NodeJS.ProcessEnv = {
                    GIT_CONFIG_NOSYSTEM: '1',
                    GIT_TERMINAL_PROMPT: '0',
                };
                for (const key of ['PATH', 'DOCKER_HOST', 'LANG', 'LC_ALL']) {
                    const value = process.env[key];
                    if (value) {
                        baseEnv[key] = value;
                    }
                }
                const result = spawnSync(wrapped.file, wrapped.args, {
                    cwd,
                    env: ctx.tenantSpawn.resolveProcessEnv(cwd, baseEnv),
                    encoding: 'utf8',
                    timeout: GIT_COMMAND_TIMEOUT_MS,
                });
                return { stdout: (result.stdout ?? '').trim(), ok: result.status === 0 };
            }
            const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
                cwd,
                encoding: 'utf8',
                timeout: GIT_COMMAND_TIMEOUT_MS,
            });
            return { stdout: (result.stdout ?? '').trim(), ok: result.status === 0 };
        } catch {
            return { stdout: '', ok: false };
        }
}


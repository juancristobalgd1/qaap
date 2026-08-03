// @ts-nocheck
// Extracted from qaap-research-runner.ts

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
import { LEDGER_PATHSPEC_EXCLUDE, LEDGER_RELATIVE_PATH, PREFLIGHT_PROMPT, PREFLIGHT_TIMEOUT_MS, REMINDER_MISSING_BLOCK, REMINDER_NOOP_ROUND } from './qaap-research-runner';

export async function reconcileOnBootExtracted(ctx: any): Promise<void> {
        for (const goal of ctx.store.listRunning()) {
            ctx.ensureLoop(goal.id);
        }
}

export function cancelExtracted(ctx: any, goalId: string): ResearchGoal | undefined {
        const cancelled = ctx.store.cancel(goalId);
        const activeId = ctx.activeExecutionId.get(goalId);
        if (activeId) {
            ctx.taskRunner.cancel(activeId);
        }
        return cancelled;
}

export function ensureLoopExtracted(ctx: any, goalId: string): void {
        if (ctx.loopRunning.has(goalId)) {
            return;
        }
        ctx.loopRunning.add(goalId);
        void ctx.runLoop(goalId).finally(() => ctx.loopRunning.delete(goalId));
}

export async function runLoopExtracted(ctx: any, goalId: string): Promise<void> {
        if (!(await ctx.ensurePreflightPassed(goalId))) {
            // Either the probe failed (goal already terminated as 'infra-broken') or the goal was
            // cancelled/vanished while the probe was in flight. Either way, round 1 must not start.
            return;
        }
        for (;;) {
            const goal = ctx.store.get(goalId);
            if (!goal || goal.status !== 'running') {
                return;
            }
            const records = ctx.readRoundLedger(goal);
            const last = records[records.length - 1];
            try {
                if (last && last.phase !== 'done') {
                    await ctx.resumeRound(goal, last);
                } else {
                    await ctx.startNewRound(goal, records.length + 1);
                }
            } catch (error) {
                console.error(`[qaap-research] round failed for goal ${goal.id}:`, error instanceof Error ? error.message : error);
                return;
            }
            const refreshed = ctx.store.get(goalId);
            if (!refreshed || refreshed.status !== 'running') {
                return;
            }
            const reason = resolveTerminationReason(refreshed, ctx.readRoundLedger(refreshed), Date.now());
            if (reason) {
                ctx.terminate(refreshed, reason);
                return;
            }
        }
}

export async function ensurePreflightPassedExtracted(ctx: any, goalId: string): Promise<boolean> {
        const goal = ctx.store.get(goalId);
        if (!goal || goal.status !== 'running') {
            return false;
        }
        if (ctx.store.readLedgerForGoal(goal).some(record => record.preflight)) {
            return true;
        }

        const task = ctx.taskRunner.create({
            cwd: goal.cwd,
            prompt: PREFLIGHT_PROMPT,
            agent: goal.agentId ?? ctx.taskRunner.defaultAgent(),
            title: `Research preflight: ${goal.description}`,
            autoApprove: true,
            agentModel: toAgentTaskModel(goal.agentModel),
        }, ctx.store.ownerOf(goal.id));
        ctx.activeExecutionId.set(goal.id, task.id);
        const finished = await ctx.waitForTaskFinishOrTimeout(task.id, PREFLIGHT_TIMEOUT_MS);
        ctx.activeExecutionId.delete(goal.id);
        if (ctx.isCancelled(goal.id)) {
            return false;
        }

        if (!finished) {
            // Timed out: the task may still be running server-side — cancel it so it does not leak.
            ctx.taskRunner.cancel(task.id);
            await ctx.recordPreflightResult(goal, `preflight failed: timed out after ${Math.round(PREFLIGHT_TIMEOUT_MS / 60_000)} minutes with no response.`);
            ctx.terminate(goal, 'infra-broken');
            return false;
        }

        const detail = await ctx.taskRunner.detail(finished.id);
        const stdout = detail?.log ?? '';
        // Same two-signal check as the propose phase (see the BUG 1 comment on `runPropose`): a
        // non-zero exit AND a stream-json `result` event with `is_error: true` while exiting 0
        // (e.g. an expired OAuth session) both mean the CLI itself is broken.
        const turnError = extractAgentTurnError(stdout);
        if (finished.state === 'failed' || turnError) {
            const reason = turnError
                ?? `agent task exited with a non-zero status${finished.exitCode !== undefined ? ` (exit code ${finished.exitCode})` : ''}.`;
            await ctx.recordPreflightResult(goal, `preflight failed: ${reason}`);
            ctx.terminate(goal, 'infra-broken');
            return false;
        }

        // No literal-"READY" requirement — any non-empty prose means the CLI authenticated,
        // resolved the model, and replied. An empty reply with no error signal at all is still
        // suspicious enough to fail fast on, rather than let round 1 discover it.
        const agentText = extractAgentTextFromLog(stdout).trim();
        if (!agentText) {
            await ctx.recordPreflightResult(goal, 'preflight failed: agent produced no text response.');
            ctx.terminate(goal, 'infra-broken');
            return false;
        }

        await ctx.recordPreflightResult(goal, undefined);
        return true;
}

export async function recordPreflightResultExtracted(ctx: any, goal: ResearchGoal, failureNote: string | undefined): Promise<void> {
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
        const pending = ctx.beginLedgerWrite(goal.cwd, record);
        if (pending) {
            await pending;
        }
}

export function terminateExtracted(ctx: any, goal: ResearchGoal, reason: TerminationReason): void {
        const status: ResearchGoalStatus = reason === 'infra-broken' ? 'failed'
            : reason === 'cancelled' ? 'cancelled'
                : 'completed';
        ctx.store.updateGoal(goal.id, { status, terminationReason: reason });
}

export async function startNewRoundExtracted(ctx: any, goal: ResearchGoal, round: number): Promise<void> {
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
            // Capture HEAD before the agent runs. Besides giving each round a truthful baseline,
            // this lets the commit phase detect an agent that ignored the prompt and committed
            // its proposal itself instead of leaving the change for Qaap's audit commit.
            baselineSha: ctx.runGit(goal.cwd, ['rev-parse', 'HEAD']).stdout || undefined,
        };
        const pending = ctx.beginLedgerWrite(goal.cwd, skeleton);
        if (pending) {
            await pending;
        }
        await ctx.runPropose(goal, skeleton, {});
}

export async function resumeRoundExtracted(ctx: any, goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        if (record.phase === 'propose') {
            // The propose task's process died with the backend. Idempotent to just re-run it: the
            // agent re-reads the ledger from scratch, so there is no partial state to reconcile.
            await ctx.runPropose(goal, record, {});
            return;
        }
        if (record.phase === 'run') {
            // The lever is already committed (record.sha is set) — only the long-running process
            // was lost, so re-run runCommand rather than starting the round over.
            await ctx.runRunPhase(goal, record, true);
            return;
        }
        if (record.phase === 'measure') {
            // run already succeeded; only the (cheap) metric command needs to happen again.
            await ctx.runMeasurePhase(goal, record);
        }
}

export async function runProposeExtracted(ctx: any, goal: ResearchGoal,
        record: ResearchExperimentRecord,
        options: { readonly reminder?: string; readonly fingerprintRetried?: boolean; readonly noopRetried?: boolean },): Promise<void> {
        const priorRecords = ctx.store.readLedgerForGoal(goal).filter(existing => existing.id !== record.id);
        let prompt = buildResearchRoundPrompt(goal, priorRecords);
        if (options.reminder) {
            prompt = `${options.reminder}\n\n${prompt}`;
        }
        // Autonomous loop: there is no human in front of this task to approve tool calls, so it
        // must run with skip-permissions on, regardless of any operator-level auto-approve default.
        const task = ctx.taskRunner.create({
            cwd: goal.cwd,
            prompt,
            agent: goal.agentId ?? ctx.taskRunner.defaultAgent(),
            title: `Research round ${record.round}: ${goal.description}`,
            autoApprove: true,
            agentModel: toAgentTaskModel(goal.agentModel),
        }, ctx.store.ownerOf(goal.id));
        ctx.activeExecutionId.set(goal.id, task.id);
        const finished = await ctx.waitForTaskFinish(task.id);
        ctx.activeExecutionId.delete(goal.id);
        if (ctx.isCancelled(goal.id)) {
            return;
        }

        const detail = await ctx.taskRunner.detail(finished.id);
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
            await ctx.finishAsInfraFailure(goal, record, `agent turn failed: ${reason}`, record.runAttempts);
            return;
        }

        // The log is stream-json for QAIQ/Claude Code agents: the agent's actual prose — and with
        // it the [QAAP experiment] block — is JSON-escaped inside `stream_event` envelopes, never
        // present as a literal fence in the raw log. Scrape it out first so the marker regex below
        // can actually match. Plain-text agent logs pass through this unchanged.
        const agentText = extractAgentTextFromLog(stdout);
        // Research propose turns are raw tasks (no conversation), so the store-side 'blocked'
        // reclassification never runs here — honor the blocked sentinel directly from the agent
        // text. An autonomous loop has nobody to answer the agent's question; counting it as an
        // infra failure lets the consecutive-failure termination stop a goal that keeps blocking.
        const blockedNeed = parseAgentBlockedSignal(agentText);
        if (blockedNeed !== undefined) {
            await ctx.finishAsInfraFailure(goal, record,
                `agent declared itself blocked on input only a human can provide: ${blockedNeed}`,
                record.runAttempts);
            return;
        }
        const proposal = parseExperimentProposal(agentText);
        const diffStat = ctx.roundDiffStat(goal.cwd);
        // Anti-stall fallback: a format miss must never cost a night of compute. Synthesize a
        // record from whatever the agent actually changed and keep the loop moving.
        const resolved = proposal ?? ctx.synthesizeFallbackProposal(diffStat);
        const notes = proposal ? record.notes : ctx.appendNote(record.notes, REMINDER_MISSING_BLOCK);
        // `declaredConfig`/`declaredConfigFingerprint`: the agent's own self-report. Kept for the
        // ledger/prompt ("what did the agent SAY it changed"), but UNVERIFIED — never the basis for
        // the repeat-config guard below. See the trust-boundary note on `ResearchExperimentRecord`.
        const declaredConfigFingerprint = configFingerprint(resolved.config);

        // The repeat-config guard must rest on what the runner can actually observe changed in the
        // repo, not on the agent's report of it — the same "the runner measures, the agent doesn't
        // self-report" principle already applied to the metric. See `qaap-research-realchange.ts`
        // for the real failure this fixes (declared configs that don't match reality, or the same
        // logical value serialized two different ways across rounds).
        const realChanges = ctx.collectRealFileChanges(goal.cwd);
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
            // Mirror the task-level change-quality gate (verification scripts + adversarial
            // review) onto the ledger row — the runner measures, the agent doesn't self-report.
            gateVerification: finished.verification?.status,
            gateReview: finished.review?.status,
            notes,
        };
        const pending = ctx.beginLedgerWrite(goal.cwd, proposed);
        if (pending) {
            await pending;
        }

        // The propose task already ran the change-quality gate inside the task runner (script
        // verification + its fix-turn budget, adversarial review). A round that STILL closes with
        // warnings is a broken lever: discard it cheaply instead of burning the (hours-long)
        // runCommand on a change that does not even pass the repo's own checks.
        if (finished.state === 'completed_with_warnings') {
            await ctx.discardBrokenRound(goal, proposed, ctx.describeGateFailure(finished));
            return;
        }

        // No-op guard: no repo changes (ledger excluded) AND no parseable proposal means the agent
        // did literally nothing this turn. Never spend an actual runCommand (hours) measuring
        // nothing — re-prompt once, exactly like the fingerprint guard below, then give up on the
        // round as a no-op rather than loop forever on a stubborn agent.
        const isNoop = !proposal && diffStat.trim().length === 0;
        if (isNoop && !options.noopRetried) {
            await ctx.runPropose(goal, proposed, {
                reminder: REMINDER_NOOP_ROUND,
                fingerprintRetried: options.fingerprintRetried,
                noopRetried: true,
            });
            return;
        }

        if (collidingRound !== undefined && !options.fingerprintRetried) {
            // The prompt is persuasion; the fingerprint is the guarantee — re-prompt exactly once,
            // then accept whatever comes back rather than loop forever on a stubborn agent.
            await ctx.runPropose(goal, proposed, {
                reminder: reminderRepeatedFingerprint(collidingRound),
                fingerprintRetried: true,
                noopRetried: options.noopRetried,
            });
            return;
        }

        if (isNoop) {
            await ctx.finishAsNoop(goal, proposed);
            return;
        }
        await ctx.commitRound(goal, proposed);
}

export function synthesizeFallbackProposalExtracted(ctx: any, diffStat: string): { readonly hypothesis: string; readonly symptom?: string; readonly lever?: string; readonly config: Record<string, unknown> } {
        return {
            hypothesis: '(not declared)',
            // The diff itself — not an empty object — so two different fallback rounds fingerprint
            // differently instead of colliding with each other on `{}` every time.
            config: { fallbackDiffStat: diffStat || '(no file changes detected)' },
        };
}

export function roundDiffStatExtracted(ctx: any, cwd: string): string {
        return ctx.runGit(cwd, ['diff', '--stat', '--', '.', LEDGER_PATHSPEC_EXCLUDE]).stdout
            || ctx.runGit(cwd, ['diff', '--cached', '--stat', '--', '.', LEDGER_PATHSPEC_EXCLUDE]).stdout
            || '';
}

export function collectRealFileChangesExtracted(ctx: any, cwd: string): RealFileChange[] {
        const status = ctx.runGit(cwd, ['status', '--porcelain', '--untracked-files=all']).stdout;
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
                ctx.pushRealFileChange(changes, cwd, rest.slice(0, arrowIndex), true);
                ctx.pushRealFileChange(changes, cwd, rest.slice(arrowIndex + 4), false);
                continue;
            }
            ctx.pushRealFileChange(changes, cwd, rest, codes.includes('D'));
        }
        return changes;
}

export function pushRealFileChangeExtracted(ctx: any, changes: RealFileChange[], cwd: string, rawPath: string, deleted: boolean): void {
        const relativePath = ctx.unquoteGitPath(rawPath);
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

export function unquoteGitPathExtracted(ctx: any, rawPath: string): string {
        const trimmed = rawPath.trim();
        if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
}


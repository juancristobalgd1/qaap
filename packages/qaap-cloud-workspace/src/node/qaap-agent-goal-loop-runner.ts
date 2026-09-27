// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapAgentMessage } from '../common/qaap-agent-conversation';
import {
    buildGoalLoopEvaluatorPrompt,
    buildGoalLoopGapsPrompt,
    buildGoalLoopTranscriptExcerpt,
    buildGoalLoopTurnFailedPrompt,
    buildGoalLoopVerifyFailedPrompt,
    createGoalLoopState,
    finishGoalLoop,
    isGoalLoopPhaseTerminal,
    isGoalLoopStateActive,
    mergeGoalLoopBudget,
    normalizeGoalLoopGoal,
    parseGoalLoopEvaluatorResponse,
    resolveGoalLoopBudgetStopBeforeEvaluator,
    resolveGoalLoopBudgetStopBeforeTurn,
    resolveGoalLoopDurationStop,
    resolveGoalLoopFallbackEvaluation,
    resolveGoalLoopStartRejection,
    type QaapAgentGoalLoopEvaluation,
    type QaapAgentGoalLoopState,
    type QaapAgentGoalLoopVerifyResult,
    type QaapStartAgentGoalLoopRequest,
} from '../common/qaap-agent-goal-loop';
import { isQaapAgentTaskFinished, type QaapAgentTask } from '../common/qaap-agent-task';
import { billableAgentDurationMs } from '../common/qaap-billing-agent-runtime';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapGoalLoopTurnSettlement } from './qaap-agent-conversation-store-constants';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QAAP_AGENT_VERIFY_WALL_CLOCK_MS } from './qaap-agent-task-runner-utils3';

/** Evaluator one-shot wall clock. */
export const QAAP_AGENT_GOAL_LOOP_EVALUATOR_TIMEOUT_MS = 3 * 60 * 1000;
/** Periodic sweep: wall-clock budget and loops whose turn never reported an outcome. */
export const QAAP_AGENT_GOAL_LOOP_SWEEP_INTERVAL_MS = 60 * 1000;
/** An `executing` loop with no live turn for this long lost its turn (restart, watchdog stop). */
export const QAAP_AGENT_GOAL_LOOP_STALE_EXECUTING_MS = 2 * 60 * 1000;

/** A route-level error with the HTTP status the endpoint should answer with. */
export class QaapAgentGoalLoopError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'QaapAgentGoalLoopError';
    }
}

/** Fired once when a loop reaches `completed`, `blocked` or `cancelled` (phase 2 Web Push hook). */
export interface QaapAgentGoalLoopTerminalEvent {
    readonly conversationId: string;
    readonly cwd: string;
    readonly title: string;
    readonly ownerLogin?: string;
    readonly goalLoop: QaapAgentGoalLoopState;
}

/**
 * Drives "Until done" goal loops over persistent conversations (`doc/qaap-agent-goal-loop.md`).
 *
 * The store reports every settled turn through {@link QaapAgentConversationStore.setGoalLoopHooks};
 * for a conversation with an active loop the runner then verifies (the task runner's own npm-script
 * verification), asks a read-only evaluator agent whether the goal is met, and either finishes the
 * loop or posts the next feedback turn. All state lives on the conversation (`goalLoop`), so it is
 * persisted and streamed with the rest of the conversation.
 */
@injectable()
export class QaapAgentGoalLoopRunner implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    protected readonly onDidReachTerminalPhaseEmitter = new Emitter<QaapAgentGoalLoopTerminalEvent>();
    /** Terminal-phase hook: phase 2 sends the Web Push from here (none for `cancelled`). */
    readonly onDidReachTerminalPhase: Event<QaapAgentGoalLoopTerminalEvent> = this.onDidReachTerminalPhaseEmitter.event;

    /** Conversations whose settled turn is being verified/evaluated right now. */
    protected readonly inFlight = new Set<string>();
    /** `conversationId:startedAt` of loops whose terminal event already fired. */
    protected readonly terminalFired = new Set<string>();
    protected sweepTimer: ReturnType<typeof setInterval> | undefined;

    @postConstruct()
    protected init(): void {
        this.store.setGoalLoopHooks({ onTurnSettled: settlement => this.onTurnSettled(settlement) });
        // The store ends a loop itself on composer Stop — surface that through the same hook.
        this.store.onDidChange(event => this.handleStoreEvent(event));
    }

    onStart(): void {
        this.store.whenReady().then(() => this.reconcileOnBoot()).catch(error => {
            console.warn('[qaap-agent-goal-loop] boot reconciliation failed:', error);
        });
        this.sweepTimer = setInterval(() => this.sweep(Date.now()), QAAP_AGENT_GOAL_LOOP_SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    onStop(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
    }

    status(conversationId: string): QaapAgentGoalLoopState | undefined {
        const conv = this.store.get(conversationId);
        if (!conv) {
            throw new QaapAgentGoalLoopError(404, 'Conversation not found.');
        }
        return conv.goalLoop;
    }

    /** Validates, posts the first turn and records the loop. Throws {@link QaapAgentGoalLoopError}. */
    start(conversationId: string, request: Partial<QaapStartAgentGoalLoopRequest>): QaapAgentGoalLoopState {
        const conv = this.store.get(conversationId);
        if (!conv) {
            throw new QaapAgentGoalLoopError(404, 'Conversation not found.');
        }
        const goal = normalizeGoalLoopGoal(request.goal);
        const rejection = resolveGoalLoopStartRejection(conv, goal);
        if (rejection || !goal) {
            throw new QaapAgentGoalLoopError(goal ? 409 : 400, rejection ?? 'A goal is required to start the loop.');
        }
        const budget = mergeGoalLoopBudget(request.budget);
        const prompt = normalizeGoalLoopGoal(request.initialPrompt) ?? goal;
        const lastTurn = this.latestUserMessage(conv);
        // Taken before posting so the anchor turn counts as started within the loop.
        const now = Date.now();
        const posted = this.postLoopTurn(conv, prompt, 1, lastTurn);
        const anchor = this.latestUserMessage(posted);
        let state = createGoalLoopState({ goal, budget, anchorUserMessageId: anchor?.id ?? '', now });
        if (posted.status !== 'streaming' || !anchor) {
            state = finishGoalLoop(state, 'blocked', this.turnStartFailure(anchor), now);
        }
        this.commit(conversationId, state);
        if (isGoalLoopPhaseTerminal(state.phase)) {
            this.emitTerminal(conversationId);
        }
        return state;
    }

    /** Ends the loop; the current agent turn, if any, keeps running (composer Stop cancels both). */
    cancel(conversationId: string, reason = 'Stopped by the user.'): QaapAgentGoalLoopState | undefined {
        const conv = this.store.get(conversationId);
        if (!conv) {
            throw new QaapAgentGoalLoopError(404, 'Conversation not found.');
        }
        if (!isGoalLoopStateActive(conv.goalLoop)) {
            return conv.goalLoop;
        }
        return this.finish(conversationId, conv.goalLoop, 'cancelled', reason);
    }

    protected onTurnSettled(settlement: QaapGoalLoopTurnSettlement): void {
        this.handleTurnSettled(settlement).catch(error => {
            console.warn('[qaap-agent-goal-loop] failed to advance the loop:', error);
            const loop = this.store.get(settlement.conversationId)?.goalLoop;
            if (isGoalLoopStateActive(loop)) {
                const message = error instanceof Error ? error.message : String(error);
                this.finish(settlement.conversationId, loop, 'blocked', `The loop stopped on an internal error: ${message}`);
            }
        });
    }

    /** @internal Exposed for specs. */
    async handleTurnSettled(settlement: QaapGoalLoopTurnSettlement): Promise<void> {
        const { conversationId } = settlement;
        const conv = this.store.get(conversationId);
        let loop = conv?.goalLoop;
        if (!conv || !isGoalLoopStateActive(loop) || loop.phase !== 'executing') {
            return;
        }
        const settledMessage = conv.messages.find(message => message.id === settlement.userMessageId && message.role === 'user');
        if (settledMessage && settledMessage.createdAt >= loop.startedAt) {
            loop = this.commit(conversationId, {
                ...loop,
                usage: { ...loop.usage, agentRuntimeMs: loop.usage.agentRuntimeMs + this.turnRuntimeMs(settlement.task) },
            });
        }
        // Only the newest turn drives the loop: an older peer run settling late, or the loop's own
        // turn when the user already queued a follow-up that started, is not the loop's to judge.
        if (this.latestUserMessage(conv)?.id !== settlement.userMessageId || this.inFlight.has(conversationId)) {
            return;
        }
        this.inFlight.add(conversationId);
        try {
            await this.advance(conversationId, { ...loop, currentTurnUserMessageId: settlement.userMessageId }, settlement);
        } finally {
            this.inFlight.delete(conversationId);
        }
    }

    protected async advance(conversationId: string, settledLoop: QaapAgentGoalLoopState, settlement: QaapGoalLoopTurnSettlement): Promise<void> {
        let loop = settledLoop;
        if (settlement.outcome === 'cancelled') {
            this.finish(conversationId, loop, 'cancelled', 'The loop turn was stopped.');
            return;
        }
        if (settlement.outcome === 'blocked') {
            this.finish(conversationId, loop, 'blocked', `The agent needs your input: ${settlement.detail?.trim() || 'see its last message.'}`);
            return;
        }
        if (settlement.outcome === 'failed') {
            this.nextIteration(conversationId, loop, settlement.userMessageId, buildGoalLoopTurnFailedPrompt(loop, settlement.detail));
            return;
        }
        loop = this.commit(conversationId, { ...loop, phase: 'verifying' });
        const conv = this.store.get(conversationId)!;
        const verify = await this.verify(conv.cwd, this.store.findTaskById(settlement.task.id) ?? settlement.task);
        const afterVerify = this.currentLoop(conversationId, loop);
        if (!afterVerify) {
            return;
        }
        loop = this.commit(conversationId, { ...afterVerify, lastVerify: verify });
        if (verify.status === 'failed') {
            this.nextIteration(conversationId, loop, settlement.userMessageId, buildGoalLoopVerifyFailedPrompt(loop, verify));
            return;
        }
        const evaluatorStop = resolveGoalLoopBudgetStopBeforeEvaluator(loop, Date.now());
        if (evaluatorStop) {
            this.finish(conversationId, loop, 'blocked', evaluatorStop);
            return;
        }
        loop = this.commit(conversationId, {
            ...loop,
            phase: 'evaluating',
            usage: { ...loop.usage, evaluatorCalls: loop.usage.evaluatorCalls + 1 },
        });
        const evaluation = await this.evaluate(this.store.get(conversationId) ?? conv, loop, verify);
        const afterEvaluation = this.currentLoop(conversationId, loop);
        if (!afterEvaluation) {
            return;
        }
        loop = this.commit(conversationId, { ...afterEvaluation, lastEvaluation: evaluation });
        if (evaluation.done) {
            this.finish(conversationId, loop, 'completed', evaluation.source === 'fallback'
                ? 'Checks passed; the evaluator gave no usable verdict.'
                : undefined);
            return;
        }
        if (evaluation.source === 'fallback') {
            this.finish(conversationId, loop, 'blocked', evaluation.reasoning);
            return;
        }
        this.nextIteration(conversationId, loop, settlement.userMessageId, buildGoalLoopGapsPrompt(loop, evaluation));
    }

    /** Starts the next agent turn, or stops the loop when a budget says no. */
    protected nextIteration(conversationId: string, loop: QaapAgentGoalLoopState, settledUserMessageId: string, prompt: string): void {
        const budgetStop = resolveGoalLoopBudgetStopBeforeTurn(loop, Date.now());
        if (budgetStop) {
            this.finish(conversationId, loop, 'blocked', budgetStop);
            return;
        }
        const conv = this.store.get(conversationId);
        if (!conv) {
            return;
        }
        const latest = this.latestUserMessage(conv);
        if (conv.status === 'streaming' || latest?.id !== settledUserMessageId || (conv.pendingUserMessages?.length ?? 0) > 0) {
            // The user sent a follow-up meanwhile: let their turn run; its settlement drives the
            // loop next (without counting as a loop iteration).
            this.commit(conversationId, { ...loop, phase: 'executing', currentTurnUserMessageId: undefined });
            return;
        }
        // Loop turns share the re-spawn ceiling with auto-continue and model fallback, charged to
        // the turn that triggered them (each loop turn is its own budget root, so this cannot cap
        // the loop below maxIterations — it stops a turn whose retries already burned the budget).
        const budgetKey = this.store.resolveLoopBudgetKey(conv, settledUserMessageId);
        if (!this.store.hasLoopSpawnBudget(budgetKey)) {
            this.finish(conversationId, loop, 'blocked', 'Re-spawn budget exhausted: the last turn already used every automatic retry.');
            return;
        }
        this.store.recordLoopSpawn(budgetKey);
        const iteration = loop.iteration + 1;
        const posted = this.postLoopTurn(conv, prompt, iteration, latest);
        const turn = this.latestUserMessage(posted);
        const next: QaapAgentGoalLoopState = {
            ...loop,
            phase: 'executing',
            iteration,
            currentTurnUserMessageId: turn?.id,
        };
        if (posted.status !== 'streaming' || !turn || turn.id === settledUserMessageId) {
            this.finish(conversationId, next, 'blocked', this.turnStartFailure(turn?.id === settledUserMessageId ? undefined : turn));
            return;
        }
        this.commit(conversationId, next);
    }

    protected postLoopTurn(conv: QaapAgentConversation, prompt: string, iteration: number, previousTurn: QaapAgentMessage | undefined): QaapAgentConversation {
        try {
            return this.store.postUserMessage(
                conv.id,
                prompt,
                // Keep the execution identity of the previous turn, like retry does.
                previousTurn?.turnAgentId,
                previousTurn?.turnAgentModel,
                conv.autoApprove,
                conv.interactionModeId,
                conv.approvalPolicyId,
                conv.toolApprovalRules,
                undefined,
                { goalLoopIteration: iteration },
            );
        } catch (error) {
            console.warn('[qaap-agent-goal-loop] could not post the loop turn:', error);
            return this.store.get(conv.id) ?? conv;
        }
    }

    /**
     * Reuses the task runner's npm-script verification: the turn's own verdict when it ran one
     * (with its fix turns), otherwise the same `typecheck/build/test/lint` scripts run here.
     */
    protected async verify(cwd: string, task: QaapAgentTask): Promise<QaapAgentGoalLoopVerifyResult> {
        const checkedAt = (): number => Date.now();
        if (task.verification?.status === 'passed') {
            return { status: 'passed', command: task.verification.command, checkedAt: checkedAt() };
        }
        if (task.verification?.status === 'failed') {
            return { status: 'failed', command: task.verification.command, summary: task.verification.summary, checkedAt: checkedAt() };
        }
        const scripts = await this.taskRunner.resolveVerificationScriptsForCwd(cwd);
        if (scripts.length === 0) {
            return { status: 'skipped', summary: 'no verification scripts in package.json', checkedAt: checkedAt() };
        }
        const env = this.taskRunner.buildChildEnv(task);
        const startedAt = Date.now();
        for (const script of scripts) {
            const command = `npm run ${script}`;
            const remaining = QAAP_AGENT_VERIFY_WALL_CLOCK_MS - (Date.now() - startedAt);
            if (remaining <= 0) {
                return { status: 'failed', command, summary: 'Verification timed out.', checkedAt: checkedAt() };
            }
            const result = await this.taskRunner.runGenericCommand(command, cwd, env, task.id, remaining, {
                header: `\n[qaap] Goal loop verifying: ${command}\n`,
                tailOutput: true,
            });
            if (result.exitCode !== 0 || result.timedOut) {
                return {
                    status: 'failed',
                    command,
                    summary: this.taskRunner.summarizeVerificationFailure(command, result),
                    checkedAt: checkedAt(),
                };
            }
        }
        return { status: 'passed', command: `npm run ${scripts[scripts.length - 1]}`, checkedAt: checkedAt() };
    }

    /** Read-only evaluator verdict; any failure degrades to the deterministic verify-only verdict. */
    protected async evaluate(
        conv: QaapAgentConversation,
        loop: QaapAgentGoalLoopState,
        verify: QaapAgentGoalLoopVerifyResult,
    ): Promise<QaapAgentGoalLoopEvaluation> {
        const prompt = buildGoalLoopEvaluatorPrompt({
            goal: loop.goal,
            verify,
            diffAdded: conv.gitDiffAdded,
            diffRemoved: conv.gitDiffRemoved,
            transcriptExcerpt: buildGoalLoopTranscriptExcerpt(conv.messages),
        });
        const agentId = this.latestUserMessage(conv)?.turnAgentId ?? conv.agentId;
        try {
            const raw = await this.taskRunner.runReadOnlyOneShotPrompt({
                prompt,
                agentId,
                cwd: conv.cwd,
                ownerLogin: conv.ownerLogin,
                // No explicit model: the owner's `review` routing picks it (their own keys).
                taskKind: 'review',
                timeoutMs: QAAP_AGENT_GOAL_LOOP_EVALUATOR_TIMEOUT_MS,
            });
            return parseGoalLoopEvaluatorResponse(raw, Date.now())
                ?? resolveGoalLoopFallbackEvaluation(verify, 'unparseable evaluator reply', Date.now());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return resolveGoalLoopFallbackEvaluation(verify, message, Date.now());
        }
    }

    /** The persisted loop if it is still the same, still active run the caller started from. */
    protected currentLoop(conversationId: string, expected: QaapAgentGoalLoopState): QaapAgentGoalLoopState | undefined {
        const loop = this.store.get(conversationId)?.goalLoop;
        if (!isGoalLoopStateActive(loop) || loop.startedAt !== expected.startedAt || loop.iteration !== expected.iteration) {
            return undefined;
        }
        return loop;
    }

    protected commit(conversationId: string, state: QaapAgentGoalLoopState): QaapAgentGoalLoopState {
        const next = isGoalLoopPhaseTerminal(state.phase) ? state : { ...state, updatedAt: Date.now() };
        this.store.setGoalLoop(conversationId, next);
        return next;
    }

    protected finish(
        conversationId: string,
        loop: QaapAgentGoalLoopState,
        phase: 'completed' | 'blocked' | 'cancelled',
        reason: string | undefined,
    ): QaapAgentGoalLoopState {
        const finished = this.commit(conversationId, finishGoalLoop(loop, phase, reason, Date.now()));
        this.emitTerminal(conversationId);
        return finished;
    }

    protected emitTerminal(conversationId: string): void {
        const conv = this.store.get(conversationId);
        const loop = conv?.goalLoop;
        if (!conv || !loop || !isGoalLoopPhaseTerminal(loop.phase)) {
            return;
        }
        const key = `${conversationId}:${loop.startedAt}`;
        if (this.terminalFired.has(key)) {
            return;
        }
        this.terminalFired.add(key);
        this.onDidReachTerminalPhaseEmitter.fire({
            conversationId,
            cwd: conv.cwd,
            title: conv.title,
            ...(conv.ownerLogin ? { ownerLogin: conv.ownerLogin } : {}),
            goalLoop: loop,
        });
    }

    protected handleStoreEvent(event: QaapAgentConversationEvent): void {
        if (event.type === 'goal_loop' && event.goalLoop && isGoalLoopPhaseTerminal(event.goalLoop.phase)) {
            this.emitTerminal(event.conversationId);
        }
    }

    /** Verify/evaluate work is in-memory only: a restart mid-phase cannot resume it honestly. */
    protected reconcileOnBoot(): void {
        for (const conv of [...this.store.conversations.values()]) {
            const loop = conv.goalLoop;
            if (isGoalLoopStateActive(loop) && (loop.phase === 'verifying' || loop.phase === 'evaluating')) {
                this.finish(conv.id, loop, 'blocked', `The backend restarted while the loop was ${loop.phase}.`);
            }
        }
    }

    /** @internal Exposed for specs. */
    sweep(now: number): void {
        for (const conv of [...this.store.conversations.values()]) {
            const loop = conv.goalLoop;
            if (!isGoalLoopStateActive(loop)) {
                continue;
            }
            const durationStop = resolveGoalLoopDurationStop(loop, now);
            if (durationStop) {
                this.finish(conv.id, loop, 'blocked', durationStop);
                continue;
            }
            if (loop.phase === 'executing'
                && !this.inFlight.has(conv.id)
                && conv.status !== 'streaming'
                && (conv.pendingUserMessages?.length ?? 0) === 0
                && this.store.getActiveTaskIdsForConversation(conv.id).length === 0
                && now - loop.updatedAt >= QAAP_AGENT_GOAL_LOOP_STALE_EXECUTING_MS) {
                this.finish(conv.id, loop, 'blocked', 'The loop turn ended without reporting an outcome (backend restart or watchdog stop).');
            }
        }
    }

    protected latestUserMessage(conv: QaapAgentConversation): QaapAgentMessage | undefined {
        for (let index = conv.messages.length - 1; index >= 0; index--) {
            if (conv.messages[index].role === 'user') {
                return conv.messages[index];
            }
        }
        return undefined;
    }

    protected turnStartFailure(turn: QaapAgentMessage | undefined): string {
        return turn?.error?.trim()
            ? `The loop turn could not start: ${turn.error.trim()}`
            : 'The loop turn could not start.';
    }

    /** Agent time of a settled turn, as billing counts it (spawn to finish). */
    protected turnRuntimeMs(task: QaapAgentTask): number {
        const billable = billableAgentDurationMs(task);
        if (billable > 0 || task.state === 'cancelled' || !isQaapAgentTaskFinished(task.state)) {
            return billable;
        }
        return task.startedAt !== undefined && task.finishedAt !== undefined && task.finishedAt > task.startedAt
            ? task.finishedAt - task.startedAt
            : 0;
    }
}

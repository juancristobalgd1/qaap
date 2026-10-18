// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { randomUUID } from 'crypto';
import { nls } from '@theia/core/lib/common/nls';
import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import {
    QaapTaskPlan,
    type QaapTaskPlanEditRequest,
    type QaapTaskPlanSubtask,
} from '@theia/qaap-shared-core/lib/common/qaap-task-plan';
import type {
    QaapAgentConversation,
    QaapAgentConversationEvent,
    QaapAgentMessage,
    QaapConversationCheckpoint,
    QaapCreateAgentConversationRequest,
} from '../common/qaap-agent-conversation';
import { canEnforceReadOnlyWorkspace } from '../common/qaap-agent-readonly-workspace';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapGoalLoopTurnOutcome, QaapGoalLoopTurnSettlement } from './qaap-agent-conversation-store-constants';
import type { QaapGitRunResult } from './qaap-agent-conversation-store-git';
import { QaapConversationWorktreeService } from './qaap-conversation-worktree';

/** `QAAP_TASK_FANOUT`: `off` never plans, `auto` plans explicit and clearly multi-step requests, `on` plans every eligible task. */
export type QaapTaskFanOutMode = 'off' | 'auto' | 'on';

export const QAAP_TASK_FANOUT_DEFAULT_AUTORUN_MS = 60_000;
export const QAAP_TASK_FANOUT_DEFAULT_MAX_PARALLEL = 4;
const EVALUATE_DEBOUNCE_MS = 200;
const GIT_IDENTITY = ['-c', 'user.email=qaap@local', '-c', 'user.name=Qaap'];

/** Thrown by the endpoint-facing methods; `status` is the HTTP status to answer with. */
export class QaapTaskPlanError extends Error {
    constructor(message: string, readonly status: number = 409) {
        super(message);
    }
}

/**
 * Drives a task's editable plan and its fan-out (roadmap H3.1, `doc/qaap-task-plan-fanout.md`):
 * planning turn (read-only) → plan awaiting approval (Run, auto-run timer) → one child conversation per
 * subtask, each in its own worktree and so its own per-task sandbox → once they all settled, an
 * integration turn in the parent whose workspace is prepared, right after its pre-turn checkpoint, with
 * the subtasks' results merged by `git merge-tree`. Verification, the adversarial reviewer and
 * {@link QaapTaskPullRequestService} then see the combined change as one ordinary turn and open one PR.
 *
 * All state lives on `conversation.taskPlan`, so a restart simply re-evaluates every active plan.
 */
@injectable()
export class QaapTaskPlanFanOutService implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapConversationWorktreeService) @optional()
    protected readonly worktrees: QaapConversationWorktreeService | undefined;

    protected readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    protected readonly autoRunTimers = new Map<string, ReturnType<typeof setTimeout>>();
    protected readonly chains = new Map<string, Promise<void>>();
    /** Outcome of each settled turn, by conversation then user message (cleared once consumed). */
    protected readonly outcomes = new Map<string, Map<string, { outcome: QaapGoalLoopTurnOutcome; detail?: string }>>();

    @postConstruct()
    protected init(): void {
        this.store.onDidChange(event => this.onConversationEvent(event));
        this.store.onDidSettleTurn(settlement => this.onTurnSettled(settlement));
        void this.store.whenReady().then(() => this.reconcileAll()).catch(error => {
            console.warn('[qaap-task-plan] reconcile after start failed:', error);
        });
    }

    /** Bound as a contribution only so it is instantiated (and subscribed) at startup. */
    initialize(): void {
        // The store subscriptions happen in init().
    }

    mode(env: NodeJS.ProcessEnv = process.env): QaapTaskFanOutMode {
        const value = env.QAAP_TASK_FANOUT?.trim().toLowerCase();
        if (value === 'on' || value === '1' || value === 'true' || value === 'always') {
            return 'on';
        }
        if (value === 'off' || value === '0' || value === 'false' || value === 'no') {
            return 'off';
        }
        // Default: plan the tasks that ask for it (fanOut) or are clearly multi-step; others stay one turn.
        return 'auto';
    }

    protected autoRunMs(): number {
        return this.readIntEnv('QAAP_TASK_FANOUT_AUTORUN_MS', QAAP_TASK_FANOUT_DEFAULT_AUTORUN_MS, 0);
    }

    protected maxParallel(): number {
        return this.readIntEnv('QAAP_TASK_FANOUT_MAX_PARALLEL', QAAP_TASK_FANOUT_DEFAULT_MAX_PARALLEL, 1);
    }

    protected readIntEnv(name: string, fallback: number, min: number): number {
        const configured = Number.parseInt(process.env[name]?.trim() ?? '', 10);
        return Number.isInteger(configured) && configured >= min ? configured : fallback;
    }

    /**
     * Whether a create request starts with a planning turn. Never for follow-ups, plan/ask modes, shell
     * agents or agents whose workspace cannot be made read-only; `fanOut: false` always opts out.
     */
    shouldPlan(
        request: Pick<QaapCreateAgentConversationRequest, 'message' | 'interactionModeId' | 'fanOut'>,
        agentId: string | undefined,
        cwd?: string,
    ): boolean {
        const mode = this.mode();
        if (mode === 'off' || request.fanOut === false || !request.message?.trim()) {
            return false;
        }
        // Subtasks run in git worktrees: a non-git project keeps the single-turn path.
        if (cwd !== undefined && !this.isGitWorkspace(cwd)) {
            return false;
        }
        const interaction = request.interactionModeId?.trim().toLowerCase();
        if (interaction && interaction !== 'agent') {
            return false;
        }
        if (!agentId || !canEnforceReadOnlyWorkspace(agentId)) {
            return false;
        }
        return mode === 'on' || request.fanOut === true || QaapTaskPlan.isMultiStepCandidate(request.message);
    }

    /** `cwd` is inside a git work tree (a `.git` directory or worktree file at it or above it). */
    isGitWorkspace(cwd: string): boolean {
        let dir = path.resolve(cwd);
        for (;;) {
            if (fs.existsSync(path.join(dir, '.git'))) {
                return true;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return false;
            }
            dir = parent;
        }
    }

    /** The initial plan stored on a conversation whose first turn plans the task. */
    createDraftPlan(now: number = Date.now()): QaapTaskPlan {
        return { id: randomUUID(), state: 'drafting', subtasks: [], autoRun: true, createdAt: now, updatedAt: now };
    }

    // ─── Endpoint actions ──────────────────────────────────────────────────────────────────────

    /** Replaces the subtasks of a plan awaiting approval; editing turns the auto-run timer off. */
    edit(conversationId: string, request: QaapTaskPlanEditRequest): QaapAgentConversation {
        const { plan } = this.requirePlan(conversationId, 'awaiting-approval');
        if (!Array.isArray(request.subtasks)) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorSubtasksArray', '"subtasks" must be an array.'), 400);
        }
        const draft = QaapTaskPlan.normalizeDraft({
            summary: typeof request.summary === 'string' ? request.summary : plan.summary,
            subtasks: request.subtasks.map(row => ({ title: String(row?.title ?? ''), prompt: String(row?.prompt ?? '') })),
        });
        if (draft.subtasks.length === 0) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorNoSubtask', 'A plan needs at least one subtask.'), 400);
        }
        const previous = new Map(plan.subtasks.map(subtask => [subtask.id, subtask]));
        const subtasks: QaapTaskPlanSubtask[] = draft.subtasks.map((row, index) => {
            const id = request.subtasks[index]?.id;
            const kept = id ? previous.get(id) : undefined;
            return { id: kept?.id ?? randomUUID(), title: row.title, prompt: row.prompt, state: 'pending' };
        });
        const subtasksChanged = JSON.stringify(subtasks.map(row => [row.title, row.prompt])) !== JSON.stringify(plan.subtasks.map(row => [row.title, row.prompt]));
        const next: QaapTaskPlan = {
            ...plan,
            ...(draft.summary ? { summary: draft.summary } : {}),
            subtasks,
            edited: plan.edited || subtasksChanged || draft.summary !== plan.summary,
            autoRun: request.autoRun === false || subtasksChanged ? false : plan.autoRun,
            ...(request.autoRun === false || subtasksChanged ? { autoRunAt: undefined } : {}),
            updatedAt: Date.now(),
        };
        if (!next.autoRun) {
            this.clearAutoRun(conversationId);
        }
        return this.save(conversationId, next);
    }

    /** Run: fan the subtasks out (or continue as one turn when there is only one). */
    run(conversationId: string): QaapAgentConversation {
        const { conv, plan } = this.requirePlan(conversationId, 'awaiting-approval');
        this.clearAutoRun(conversationId);
        if (plan.subtasks.length < 2) {
            return this.runSingle(conversationId);
        }
        if (!this.worktrees) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorNoWorktrees', 'Parallel subtasks need git worktrees, which this server does not provide.'), 503);
        }
        const running = this.save(conv.id, { ...plan, state: 'running', autoRunAt: undefined, updatedAt: Date.now() });
        this.scheduleEvaluate(conversationId);
        return running;
    }

    /** "Run as one task": today's single build turn, with the plan as context. */
    runSingle(conversationId: string): QaapAgentConversation {
        const { conv, plan } = this.requirePlan(conversationId, 'awaiting-approval');
        this.clearAutoRun(conversationId);
        return this.continueAsSingleTurn(conv, plan);
    }

    /** Cancels a plan that has not finished, and every subtask still running. */
    cancel(conversationId: string): QaapAgentConversation {
        const conv = this.store.get(conversationId);
        const plan = conv?.taskPlan;
        if (!conv || !plan) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorNoPlan', 'This conversation has no task plan.'), 404);
        }
        if (!QaapTaskPlan.isActive(plan)) {
            return conv;
        }
        this.clearAutoRun(conversationId);
        for (const subtask of plan.subtasks) {
            if (subtask.state === 'running' && subtask.conversationId) {
                this.store.cancel(subtask.conversationId);
            }
        }
        if (plan.state === 'integrating' || plan.state === 'drafting') {
            this.store.cancel(conversationId);
        }
        return this.save(conversationId, {
            ...plan,
            state: 'cancelled',
            autoRunAt: undefined,
            subtasks: plan.subtasks.map(subtask => QaapTaskPlan.isSubtaskSettled(subtask) ? subtask : { ...subtask, state: 'cancelled' }),
            updatedAt: Date.now(),
        }, plan.state === 'drafting' ? { interactionModeId: 'agent' } : {});
    }

    protected requirePlan(conversationId: string, state: QaapTaskPlan['state']): { conv: QaapAgentConversation; plan: QaapTaskPlan } {
        const conv = this.store.get(conversationId);
        const plan = conv?.taskPlan;
        if (!conv || !plan) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorNoPlan', 'This conversation has no task plan.'), 404);
        }
        if (plan.state !== state) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorWrongState', 'The task plan is {0}, not {1}.', plan.state, state));
        }
        return { conv, plan };
    }

    // ─── Events ────────────────────────────────────────────────────────────────────────────────

    protected onConversationEvent(event: QaapAgentConversationEvent): void {
        if (event.type === 'deleted') {
            this.clearAutoRun(event.conversationId);
            this.outcomes.delete(event.conversationId);
            return;
        }
        if (event.type !== 'updated' && event.type !== 'created') {
            return;
        }
        const summary = event.conversation;
        if (summary.taskPlan && QaapTaskPlan.isActive(summary.taskPlan)) {
            this.scheduleEvaluate(summary.id);
        }
        if (summary.parentConversationId) {
            this.scheduleEvaluate(summary.parentConversationId);
        }
    }

    protected onTurnSettled(settlement: QaapGoalLoopTurnSettlement): void {
        const conv = this.store.get(settlement.conversationId);
        if (!conv || (!conv.taskPlan && !conv.parentConversationId)) {
            return;
        }
        let byMessage = this.outcomes.get(settlement.conversationId);
        if (!byMessage) {
            byMessage = new Map();
            this.outcomes.set(settlement.conversationId, byMessage);
        }
        byMessage.set(settlement.userMessageId, { outcome: settlement.outcome, ...(settlement.detail ? { detail: settlement.detail } : {}) });
        this.scheduleEvaluate(conv.parentConversationId ?? conv.id);
    }

    protected reconcileAll(): void {
        for (const group of this.store.listAllGroupedByCwd()) {
            for (const summary of group.conversations) {
                if (summary.taskPlan && QaapTaskPlan.isActive(summary.taskPlan)) {
                    this.scheduleEvaluate(summary.id);
                }
            }
        }
    }

    scheduleEvaluate(conversationId: string): void {
        const existing = this.timers.get(conversationId);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            this.timers.delete(conversationId);
            void this.evaluate(conversationId);
        }, EVALUATE_DEBOUNCE_MS);
        timer.unref?.();
        this.timers.set(conversationId, timer);
    }

    /** Serialized per parent conversation; resolves once this evaluation (and earlier ones) finished. */
    evaluate(conversationId: string): Promise<void> {
        const previous = this.chains.get(conversationId) ?? Promise.resolve();
        const next = previous.then(() => this.evaluateNow(conversationId)).catch(error => {
            console.warn(`[qaap-task-plan] ${conversationId}: evaluation failed:`, error);
        });
        this.chains.set(conversationId, next);
        void next.finally(() => {
            if (this.chains.get(conversationId) === next) {
                this.chains.delete(conversationId);
            }
        });
        return next;
    }

    protected async evaluateNow(conversationId: string): Promise<void> {
        const conv = this.store.get(conversationId);
        const plan = conv?.taskPlan;
        if (!conv || !plan || !QaapTaskPlan.isActive(plan)) {
            return;
        }
        switch (plan.state) {
            case 'drafting':
                return this.evaluateDrafting(conv, plan);
            case 'awaiting-approval':
                this.armAutoRun(conv, plan);
                return;
            case 'running':
                return this.evaluateRunning(conv, plan);
            case 'integrating':
                return this.evaluateIntegrating(conv, plan);
        }
    }

    /** Idle, nothing queued, no live run. */
    protected isQuiescent(conv: QaapAgentConversation): boolean {
        return conv.status !== 'streaming'
            && (conv.pendingUserMessages?.length ?? 0) === 0
            && this.store.getActiveTaskIdsForConversation(conv.id).length === 0;
    }

    /**
     * How the latest turn for `userMessageId` settled: the store's settlement, else the persisted
     * verdict, else (restart, cancelled before a verdict) the message trail.
     */
    protected turnOutcome(conv: QaapAgentConversation, userMessageId: string | undefined): { outcome: QaapGoalLoopTurnOutcome; detail?: string } | undefined {
        if (!userMessageId) {
            return undefined;
        }
        const settled = this.outcomes.get(conv.id)?.get(userMessageId);
        if (settled) {
            return settled;
        }
        const user = conv.messages.find(message => message.id === userMessageId);
        const verdict = user?.turnVerdict;
        if (verdict) {
            const state = verdict.taskState;
            return state === 'completed' || state === 'completed_with_warnings'
                ? { outcome: 'success' }
                : state === 'blocked' ? { outcome: 'blocked', detail: verdict.blockedNeed }
                    : state === 'cancelled' ? { outcome: 'cancelled' } : { outcome: 'failed', detail: state };
        }
        const reply = this.replyAfter(conv, userMessageId);
        if (reply?.error?.trim()) {
            return { outcome: 'failed', detail: reply.error.trim() };
        }
        return this.isQuiescent(conv) ? { outcome: 'failed', detail: 'interrupted' } : undefined;
    }

    protected replyAfter(conv: QaapAgentConversation, userMessageId: string): QaapAgentMessage | undefined {
        const index = conv.messages.findIndex(message => message.id === userMessageId);
        if (index < 0) {
            return undefined;
        }
        const after = conv.messages.slice(index + 1);
        const nextUser = after.findIndex(message => message.role === 'user');
        return (nextUser < 0 ? after : after.slice(0, nextUser)).reverse().find(message => message.role === 'agent');
    }

    protected lastUserMessageId(conv: QaapAgentConversation): string | undefined {
        return [...conv.messages].reverse().find(message => message.role === 'user')?.id;
    }

    // ─── Phases ────────────────────────────────────────────────────────────────────────────────

    protected evaluateDrafting(conv: QaapAgentConversation, plan: QaapTaskPlan): void {
        if (!this.isQuiescent(conv)) {
            return;
        }
        const sourceId = plan.sourceMessageId ?? conv.messages.find(message => message.role === 'user')?.id;
        const outcome = this.turnOutcome(conv, sourceId);
        if (!sourceId || !outcome) {
            return;
        }
        const reply = this.replyAfter(conv, sourceId);
        if (outcome.outcome === 'cancelled') {
            this.save(conv.id, { ...plan, state: 'cancelled', updatedAt: Date.now() }, { interactionModeId: 'agent' });
            return;
        }
        if (outcome.outcome === 'failed' || !reply) {
            this.save(conv.id, { ...plan, state: 'failed', error: outcome.detail ?? 'The planning turn produced no plan.', updatedAt: Date.now() }, { interactionModeId: 'agent' });
            return;
        }
        const draft = QaapTaskPlan.parse(reply.content);
        const now = Date.now();
        const subtasks: QaapTaskPlanSubtask[] = (draft?.subtasks ?? []).map(row => ({ id: randomUUID(), title: row.title, prompt: row.prompt, state: 'pending' }));
        const ready: QaapTaskPlan = {
            ...plan,
            sourceMessageId: sourceId,
            ...(draft?.summary ? { summary: draft.summary } : {}),
            subtasks,
            updatedAt: now,
        };
        if (subtasks.length < 2) {
            // One step (or no parsable plan): continue exactly as a task without a plan would.
            this.continueAsSingleTurn(conv, ready);
            return;
        }
        const autoRunAt = ready.autoRun ? now + this.autoRunMs() : undefined;
        const saved = this.save(conv.id, { ...ready, state: 'awaiting-approval', ...(autoRunAt ? { autoRunAt } : {}) }, { interactionModeId: 'agent' });
        if (saved.taskPlan) {
            this.armAutoRun(saved, saved.taskPlan);
        }
    }

    protected continueAsSingleTurn(conv: QaapAgentConversation, plan: QaapTaskPlan): QaapAgentConversation {
        const source = conv.messages.find(message => message.id === plan.sourceMessageId);
        const lines = [
            'Implement the task now, following the plan above.',
            ...(plan.subtasks.length === 1 ? ['', `Plan: ${plan.subtasks[0].title}`, plan.subtasks[0].prompt] : []),
            ...(source?.content ? ['', 'Original request:', source.content] : []),
        ];
        this.save(conv.id, { ...plan, state: 'single', autoRunAt: undefined, updatedAt: Date.now() }, { interactionModeId: 'agent' });
        return this.store.postUserMessage(conv.id, lines.join('\n'), undefined, undefined, undefined, 'agent');
    }

    protected armAutoRun(conv: QaapAgentConversation, plan: QaapTaskPlan): void {
        if (!plan.autoRun || !plan.autoRunAt || this.autoRunTimers.has(conv.id)) {
            return;
        }
        const timer = setTimeout(() => {
            this.autoRunTimers.delete(conv.id);
            const current = this.store.get(conv.id)?.taskPlan;
            if (current?.id !== plan.id || current.state !== 'awaiting-approval' || !current.autoRun) {
                return;
            }
            try {
                this.run(conv.id);
            } catch (error) {
                console.warn(`[qaap-task-plan] ${conv.id}: auto-run failed:`, error);
            }
        }, Math.max(0, plan.autoRunAt - Date.now()));
        timer.unref?.();
        this.autoRunTimers.set(conv.id, timer);
    }

    protected clearAutoRun(conversationId: string): void {
        const timer = this.autoRunTimers.get(conversationId);
        if (timer) {
            clearTimeout(timer);
            this.autoRunTimers.delete(conversationId);
        }
    }

    protected async evaluateRunning(conv: QaapAgentConversation, plan: QaapTaskPlan): Promise<void> {
        // 1. Settle children that finished.
        for (const subtask of plan.subtasks) {
            if (subtask.state !== 'running' || !subtask.conversationId) {
                continue;
            }
            const settled = await this.settleChild(subtask);
            if (settled && !this.updateRunningSubtask(conv.id, plan.id, settled)) {
                return;
            }
        }
        // 2. Start pending ones while there is room; each start is saved at once, so a crash or a
        // cancel never orphans a child the plan does not know about.
        for (;;) {
            const current = this.runningPlan(conv.id, plan.id);
            if (!current) {
                return;
            }
            const running = current.subtasks.filter(subtask => subtask.state === 'running').length;
            const index = current.subtasks.findIndex(subtask => subtask.state === 'pending');
            if (index < 0 || running >= this.maxParallel()) {
                break;
            }
            const started = await this.startChild(this.store.get(conv.id) ?? conv, current, current.subtasks[index], index);
            if (!this.updateRunningSubtask(conv.id, plan.id, started)) {
                if (started.conversationId) {
                    // Cancelled while the child was being created.
                    this.store.cancel(started.conversationId);
                }
                return;
            }
        }
        const current = this.runningPlan(conv.id, plan.id);
        if (current && current.subtasks.every(QaapTaskPlan.isSubtaskSettled)) {
            await this.integrate(conv.id, current);
        }
    }

    /** The plan when it is still `planId` and still running. */
    protected runningPlan(conversationId: string, planId: string): QaapTaskPlan | undefined {
        const current = this.store.get(conversationId)?.taskPlan;
        return current?.id === planId && current.state === 'running' ? current : undefined;
    }

    /** Replaces one subtask of a running plan; `false` when the plan is no longer running. */
    protected updateRunningSubtask(conversationId: string, planId: string, subtask: QaapTaskPlanSubtask): boolean {
        const current = this.runningPlan(conversationId, planId);
        if (!current) {
            return false;
        }
        this.save(conversationId, {
            ...current,
            subtasks: current.subtasks.map(row => row.id === subtask.id ? subtask : row),
            updatedAt: Date.now(),
        });
        return true;
    }

    protected async startChild(parent: QaapAgentConversation, plan: QaapTaskPlan, subtask: QaapTaskPlanSubtask, index: number): Promise<QaapTaskPlanSubtask> {
        try {
            const worktree = await this.worktrees!.create(parent.cwd, parent.ownerLogin);
            const total = plan.subtasks.length;
            const child = this.store.create({
                cwd: worktree.worktreePath,
                parallelBaseCwd: parent.cwd,
                worktreeBranch: worktree.branch,
                agent: parent.agentId,
                title: `${index + 1}/${total} · ${subtask.title}`,
                message: this.subtaskPrompt(plan, subtask, index),
                ...(parent.agentModel ? { agentModel: parent.agentModel } : {}),
                ...(parent.autoApprove === false ? { autoApprove: false } : {}),
                ...(parent.contextPreamble ? { contextPreamble: parent.contextPreamble } : {}),
                ...(parent.approvalPolicyId ? { approvalPolicyId: parent.approvalPolicyId } : {}),
                ...(parent.toolApprovalRules ? { toolApprovalRules: parent.toolApprovalRules } : {}),
                interactionModeId: 'agent',
                parentConversationId: parent.id,
                taskPlanSubtaskId: subtask.id,
                taskPullRequestEnabled: false,
            }, parent.ownerLogin);
            // The first turn titles a conversation after its message; keep "k/N · title" (mission control reads it).
            this.store.rename(child.id, { title: `${index + 1}/${total} · ${subtask.title}` });
            return { ...subtask, state: 'running', conversationId: child.id, branch: worktree.branch };
        } catch (error) {
            return { ...subtask, state: 'failed', error: this.describe(error) };
        }
    }

    protected subtaskPrompt(plan: QaapTaskPlan, subtask: QaapTaskPlanSubtask, index: number): string {
        const others = plan.subtasks.filter(row => row.id !== subtask.id).map(row => `- ${row.title}`);
        return [
            subtask.prompt,
            '',
            `This is subtask ${index + 1} of ${plan.subtasks.length} of a larger task${plan.summary ? `: ${plan.summary}` : '.'}`,
            ...(others.length ? ['Other agents are doing these subtasks in parallel; do not do them and do not edit their files:', ...others] : []),
            'Do only your part, leave the changes uncommitted, and summarize what you changed.',
        ].join('\n');
    }

    /** The settled subtask once its child conversation is quiet, with its result committed on its branch. */
    protected async settleChild(subtask: QaapTaskPlanSubtask): Promise<QaapTaskPlanSubtask | undefined> {
        const child = subtask.conversationId ? this.store.get(subtask.conversationId) : undefined;
        if (!child) {
            return { ...subtask, state: 'failed', error: 'The subtask conversation was deleted.' };
        }
        if (!this.isQuiescent(child)) {
            return undefined;
        }
        const outcome = this.turnOutcome(child, this.lastUserMessageId(child));
        if (!outcome) {
            return undefined;
        }
        if (outcome.outcome === 'cancelled') {
            return { ...subtask, state: 'cancelled' };
        }
        if (outcome.outcome === 'failed') {
            return { ...subtask, state: 'failed', error: outcome.detail ?? 'The subtask failed.' };
        }
        try {
            const headSha = await this.store.runSerializedGit(child.cwd, () => this.commitChild(child.cwd, subtask.title));
            return {
                ...subtask,
                state: 'done',
                headSha,
                ...(outcome.outcome === 'blocked' ? { error: `Blocked: ${outcome.detail ?? 'the agent needs input'}` } : {}),
            };
        } catch (error) {
            return { ...subtask, state: 'failed', error: `Could not commit the subtask's result: ${this.describe(error)}` };
        }
    }

    /** Commits the child's worktree on its own branch (never into the base branch) and returns its head. */
    protected async commitChild(cwd: string, title: string): Promise<string> {
        const status = await this.git(cwd, ['status', '--porcelain']);
        if (status.trim()) {
            await this.git(cwd, ['add', '-A']);
            await this.git(cwd, [...GIT_IDENTITY, 'commit', '--no-verify', '-q', '-m', `qaap: subtask ${title}`.slice(0, 200)]);
        }
        return (await this.git(cwd, ['rev-parse', 'HEAD'])).trim();
    }

    protected async integrate(conversationId: string, plan: QaapTaskPlan): Promise<void> {
        const conv = this.store.get(conversationId);
        if (!conv) {
            return;
        }
        if (!plan.subtasks.some(subtask => subtask.state === 'done')) {
            this.save(conversationId, { ...plan, state: 'failed', error: 'No subtask finished successfully.', updatedAt: Date.now() });
            return;
        }
        if (!this.isQuiescent(conv)) {
            // The user is chatting in the parent; integrate once that turn settles.
            return;
        }
        const integrating: QaapTaskPlan = { ...plan, state: 'integrating', updatedAt: Date.now() };
        this.save(conversationId, integrating, { interactionModeId: 'agent' });
        const posted = this.store.postUserMessage(
            conversationId,
            this.integrationPrompt(plan),
            undefined, undefined, undefined, 'agent', undefined, undefined, undefined,
            { prepareWorkspace: (cwd, preTurn) => this.applySubtasks(conversationId, plan.id, cwd, preTurn) },
        );
        const integrationMessageId = this.lastUserMessageId(posted);
        const current = this.store.get(conversationId)?.taskPlan ?? integrating;
        this.save(conversationId, { ...current, ...(integrationMessageId ? { integrationMessageId } : {}), updatedAt: Date.now() });
    }

    protected integrationPrompt(plan: QaapTaskPlan): string {
        const lines = plan.subtasks.map((subtask, index) => {
            const label = `${index + 1}. ${subtask.title}`;
            switch (subtask.state) {
                case 'done':
                    return `${label} — done${subtask.error ? ` (${subtask.error})` : ''}`;
                case 'cancelled':
                    return `${label} — cancelled, not applied`;
                default:
                    return `${label} — failed, not applied: ${subtask.error ?? 'unknown error'}`;
            }
        });
        return [
            'Integrate the results of this task\'s parallel subtasks. Their changes are already applied to the working tree (uncommitted):',
            ...lines,
            '',
            'Check that the pieces fit together, fix integration problems, complete any part that failed or was left out, run the project\'s checks, and summarize the final change.',
        ].join('\n');
    }

    /**
     * Writes the merged result of the done subtasks into the parent's working tree, without committing
     * and without touching its index. Runs inside the integration turn's serialized git section, right
     * after its pre-turn checkpoint `preTurn` (the full working tree, the user's dirty files included):
     * `T = merge-tree(base = subtask's fork point, ours = preTurn, theirs = subtask head)` for each subtask
     * in order, then a temporary index moves the tree from `preTurn` to `T` (`read-tree -m -u`). A
     * subtask that conflicts is skipped and recorded as `conflict`.
     */
    protected async applySubtasks(conversationId: string, planId: string, cwd: string, preTurn: QaapConversationCheckpoint): Promise<void> {
        const plan = this.store.get(conversationId)?.taskPlan;
        if (!plan || plan.id !== planId || !preTurn.commit) {
            throw new Error('the task plan changed before its integration turn started');
        }
        try {
            const result = await this.composeSubtasks(cwd, preTurn.commit, plan.subtasks);
            await this.writeTree(cwd, preTurn.commit, result.tree);
            const latest = this.store.get(conversationId)?.taskPlan ?? plan;
            this.save(conversationId, {
                ...latest,
                subtasks: latest.subtasks.map(subtask => result.conflicts.has(subtask.id) ? { ...subtask, conflict: true } : subtask),
                updatedAt: Date.now(),
            });
        } catch (error) {
            const latest = this.store.get(conversationId)?.taskPlan ?? plan;
            this.save(conversationId, { ...latest, state: 'failed', error: `Merging the subtasks failed: ${this.describe(error)}`, updatedAt: Date.now() });
            throw error;
        }
    }

    /** Folds the done subtasks onto `startCommit`; returns the final tree and the conflicted subtask ids. */
    async composeSubtasks(cwd: string, startCommit: string, subtasks: readonly QaapTaskPlanSubtask[]): Promise<{ tree: string; conflicts: Set<string> }> {
        let ours = startCommit;
        let tree = (await this.git(cwd, ['rev-parse', `${startCommit}^{tree}`])).trim();
        const conflicts = new Set<string>();
        for (const subtask of subtasks) {
            if (subtask.state !== 'done' || !subtask.headSha) {
                continue;
            }
            const base = (await this.git(cwd, ['merge-base', subtask.headSha, 'HEAD'])).trim();
            const merged = await this.store.mutatingGit(cwd, ['merge-tree', '--write-tree', `--merge-base=${base}`, ours, subtask.headSha]);
            if (merged.status !== 0) {
                if (merged.status === 1) {
                    conflicts.add(subtask.id);
                    continue;
                }
                throw new Error(`git merge-tree failed: ${merged.stderr.trim().slice(0, 300)}`);
            }
            tree = merged.stdout.split('\n')[0].trim();
            ours = (await this.git(cwd, [...GIT_IDENTITY, 'commit-tree', tree, '-p', ours, '-m', `qaap: merge subtask ${subtask.title}`.slice(0, 200)])).trim();
        }
        return { tree, conflicts };
    }

    /** Moves the working tree from `fromCommit` (what it holds now) to `tree` through a throwaway index. */
    async writeTree(cwd: string, fromCommit: string, tree: string): Promise<void> {
        const top = (await this.git(cwd, ['rev-parse', '--show-toplevel'])).trim();
        const indexPath = path.resolve(top, (await this.git(top, ['rev-parse', '--git-path', 'qaap-task-plan-index'])).trim());
        const env = { ...process.env, GIT_INDEX_FILE: indexPath };
        try {
            await this.git(top, ['read-tree', fromCommit], env);
            await this.store.mutatingGit(top, ['update-index', '-q', '--refresh'], env);
            await this.git(top, ['read-tree', '-m', '-u', fromCommit, tree], env);
        } finally {
            try {
                fs.rmSync(indexPath, { force: true });
            } catch {
                // Tenant-owned and harmless if left behind; the next integration overwrites it.
            }
        }
    }

    protected evaluateIntegrating(conv: QaapAgentConversation, plan: QaapTaskPlan): void {
        if (!plan.integrationMessageId || !this.isQuiescent(conv)) {
            return;
        }
        const outcome = this.turnOutcome(conv, plan.integrationMessageId);
        if (!outcome) {
            return;
        }
        const state: QaapTaskPlan['state'] = outcome.outcome === 'cancelled' ? 'cancelled' : outcome.outcome === 'failed' ? 'failed' : 'done';
        this.save(conv.id, {
            ...plan,
            state,
            ...(state === 'failed' && !plan.error ? { error: outcome.detail ?? 'The integration turn failed.' } : {}),
            updatedAt: Date.now(),
        });
        this.outcomes.delete(conv.id);
        for (const subtask of plan.subtasks) {
            if (subtask.conversationId) {
                this.outcomes.delete(subtask.conversationId);
            }
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────────────────────

    protected save(conversationId: string, plan: QaapTaskPlan, patch: Pick<Partial<QaapAgentConversation>, 'interactionModeId'> = {}): QaapAgentConversation {
        const next = this.store.setTaskPlan(conversationId, plan, patch);
        if (!next) {
            throw new QaapTaskPlanError(nls.localize('qaap/taskPlan/errorNoConversation', 'Conversation not found.'), 404);
        }
        return next;
    }

    protected async git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
        const result: QaapGitRunResult = await this.store.mutatingGit(cwd, args, env);
        if (result.status !== 0) {
            throw new Error(`git ${args.find(arg => !arg.startsWith('-')) ?? ''} failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
        }
        return result.stdout;
    }

    protected describe(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return message.replace(/\s+/g, ' ').trim().slice(0, 400) || 'unknown error';
    }
}

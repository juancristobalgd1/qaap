// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import {
    assertGoalLoopCanStart,
    buildGoalLoopEvalGapPrompt,
    buildGoalLoopInitialPrompt,
    buildGoalLoopTurnFailurePrompt,
    buildGoalLoopVerifyFailurePrompt,
    excerptGoalLoopTranscript,
    isGoalLoopActive,
    isGoalLoopBudgetExceeded,
    mergeGoalLoopBudget,
    mergeGoalLoopVerify,
    type QaapAgentGoalLoopState,
    type QaapStartAgentGoalLoopRequest,
} from '../common/qaap-agent-goal-loop';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapGoalLoopLlmEvaluator } from './qaap-goal-loop-llm-evaluator';
import { QaapGoalLoopVerifyRunner } from './qaap-goal-loop-verify-runner';
import { QaapGithubPrEvidenceService } from './qaap-github-pr-evidence-service';
import { QaapWebPushService } from './qaap-web-push-service';

/** Backend closed loop: execute agent turns → verify → evaluate until done or blocked. */
@injectable()
export class QaapGoalLoopRunner {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapGoalLoopVerifyRunner)
    protected readonly verifyRunner: QaapGoalLoopVerifyRunner;

    @inject(QaapGoalLoopLlmEvaluator)
    protected readonly evaluator: QaapGoalLoopLlmEvaluator;

    @inject(QaapWebPushService)
    protected readonly webPush: QaapWebPushService;

    @inject(QaapGithubPrEvidenceService)
    protected readonly githubEvidence: QaapGithubPrEvidenceService;

    @postConstruct()
    protected init(): void {
        this.store.onTurnSettled(event => {
            void this.onTurnSettled(event.conversationId, event.conv, event.userMessageId);
        });
    }

    async start(conversationId: string, request: QaapStartAgentGoalLoopRequest): Promise<QaapAgentGoalLoopState> {
        const goal = request.goal?.trim();
        if (!goal) {
            throw new Error('"goal" must be a non-empty string.');
        }
        const conv = this.store.get(conversationId);
        if (!conv) {
            throw new Error('Conversation not found.');
        }
        assertGoalLoopCanStart(conv);
        if (conv.status === 'streaming') {
            throw new Error('Wait for the current turn to finish before starting a goal loop.');
        }

        const now = Date.now();
        const pending: QaapAgentGoalLoopState = {
            phase: 'executing',
            goal,
            startedAt: now,
            updatedAt: now,
            iteration: 0,
            budget: mergeGoalLoopBudget(request.budget),
            verify: mergeGoalLoopVerify(request.verify),
            anchorUserMessageId: '',
            evaluatorCalls: 0,
        };

        const prompt = buildGoalLoopInitialPrompt(goal, request.initialPrompt);
        const afterMessage = this.store.postUserMessage(
            conversationId,
            prompt,
            conv.agentId,
            conv.agentModel ?? conv.qaiqModel,
            conv.autoApprove,
            conv.interactionModeId,
            conv.approvalPolicyId,
            conv.toolApprovalRules,
        );
        const anchor = [...afterMessage.messages].reverse().find(message => message.role === 'user');
        if (!anchor) {
            throw new Error('Goal loop failed to create the anchor user message.');
        }
        const started: QaapAgentGoalLoopState = {
            ...pending,
            anchorUserMessageId: anchor.id,
            updatedAt: Date.now(),
        };
        this.store.patchGoalLoop(conversationId, started);
        return started;
    }

    async cancel(conversationId: string, reason = 'Cancelled by user.'): Promise<QaapAgentGoalLoopState | undefined> {
        const conv = this.store.get(conversationId);
        if (!conv?.goalLoop || !isGoalLoopActive(conv.goalLoop)) {
            return conv?.goalLoop;
        }
        const activeTaskId = this.store.getActiveTaskIdForConversation(conversationId);
        if (activeTaskId) {
            this.store.cancel(conversationId);
        }
        const next: QaapAgentGoalLoopState = {
            ...conv.goalLoop,
            phase: 'cancelled',
            stopReason: reason,
            updatedAt: Date.now(),
        };
        this.store.patchGoalLoop(conversationId, next);
        return next;
    }

    getState(conversationId: string): QaapAgentGoalLoopState | undefined {
        return this.store.get(conversationId)?.goalLoop;
    }

    /** Called when an agent turn settles — drives verify → evaluate → re-prompt. */
    async onTurnSettled(
        conversationId: string,
        conv: QaapAgentConversation,
        _userMessageId: string,
    ): Promise<void> {
        const goalLoop = conv.goalLoop;
        if (!goalLoop || goalLoop.phase !== 'executing') {
            return;
        }
        if (conv.status === 'streaming') {
            return;
        }

        if (conv.status === 'failed') {
            await this.handleFailedTurn(conversationId, conv);
            return;
        }

        if (conv.status !== 'idle') {
            return;
        }

        await this.runVerifyAndEvaluate(conversationId, conv);
    }

    protected async handleFailedTurn(conversationId: string, conv: QaapAgentConversation): Promise<void> {
        const goalLoop = conv.goalLoop;
        if (!goalLoop) {
            return;
        }
        const nextIteration = goalLoop.iteration + 1;
        const blocked = this.blockIfBudgetExceeded(conversationId, goalLoop, nextIteration, 'Agent turn failed repeatedly.');
        if (blocked) {
            return;
        }
        const failedUser = [...conv.messages].reverse().find(message => message.role === 'user' && message.error);
        const reason = failedUser?.error ?? 'Agent turn failed.';
        const prompt = buildGoalLoopTurnFailurePrompt(goalLoop.goal, reason);
        const patched: QaapAgentGoalLoopState = {
            ...goalLoop,
            iteration: nextIteration,
            phase: 'executing',
            updatedAt: Date.now(),
        };
        this.store.patchGoalLoop(conversationId, patched);
        this.store.postUserMessage(
            conversationId,
            prompt,
            conv.agentId,
            conv.agentModel ?? conv.qaiqModel,
            conv.autoApprove,
            conv.interactionModeId,
            conv.approvalPolicyId,
            conv.toolApprovalRules,
        );
    }

    protected async runVerifyAndEvaluate(conversationId: string, conv: QaapAgentConversation): Promise<void> {
        const goalLoop = conv.goalLoop;
        if (!goalLoop) {
            return;
        }

        this.store.patchGoalLoop(conversationId, {
            ...goalLoop,
            phase: 'verifying',
            updatedAt: Date.now(),
        });

        let snapshot;
        try {
            snapshot = await this.verifyRunner.runVerifyChecks(conv.cwd, goalLoop.verify);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.store.patchGoalLoop(conversationId, {
                ...goalLoop,
                phase: 'blocked',
                stopReason: message,
                updatedAt: Date.now(),
            });
            const blocked = this.store.get(conversationId);
            if (blocked?.goalLoop) {
                this.notifyGoalLoopTerminal(conversationId, blocked, blocked.goalLoop);
            }
            return;
        }

        const fresh = this.store.get(conversationId);
        if (!fresh?.goalLoop || !isGoalLoopActive(fresh.goalLoop)) {
            return;
        }

        if (goalLoop.verify.enabled && snapshot.results.length === 0) {
            this.store.patchGoalLoop(conversationId, {
                ...fresh.goalLoop,
                phase: 'blocked',
                lastVerify: snapshot,
                stopReason: 'No verify scripts found in package.json — add compile/build/test/lint or disable verify.',
                updatedAt: Date.now(),
            });
            this.notifyGoalLoopTerminal(conversationId, fresh, fresh.goalLoop!);
            return;
        }

        if (!snapshot.allGreen) {
            await this.handleVerifyFailure(conversationId, fresh, snapshot);
            return;
        }

        await this.runEvaluation(conversationId, fresh, snapshot);
    }

    protected async handleVerifyFailure(
        conversationId: string,
        conv: QaapAgentConversation,
        snapshot: NonNullable<QaapAgentGoalLoopState['lastVerify']>,
    ): Promise<void> {
        const goalLoop = conv.goalLoop;
        if (!goalLoop) {
            return;
        }
        const nextIteration = goalLoop.iteration + 1;
        const blocked = this.blockIfBudgetExceeded(
            conversationId,
            { ...goalLoop, lastVerify: snapshot },
            nextIteration,
            'Verify still failing after maximum iterations.',
        );
        if (blocked) {
            return;
        }
        const prompt = buildGoalLoopVerifyFailurePrompt(goalLoop.goal, snapshot);
        const patched: QaapAgentGoalLoopState = {
            ...goalLoop,
            iteration: nextIteration,
            phase: 'executing',
            lastVerify: snapshot,
            updatedAt: Date.now(),
        };
        this.store.patchGoalLoop(conversationId, patched);
        this.store.postUserMessage(
            conversationId,
            prompt,
            conv.agentId,
            conv.agentModel ?? conv.qaiqModel,
            conv.autoApprove,
            conv.interactionModeId,
            conv.approvalPolicyId,
            conv.toolApprovalRules,
        );
    }

    protected async runEvaluation(
        conversationId: string,
        conv: QaapAgentConversation,
        snapshot: NonNullable<QaapAgentGoalLoopState['lastVerify']>,
    ): Promise<void> {
        const goalLoop = conv.goalLoop;
        if (!goalLoop) {
            return;
        }

        const evaluating: QaapAgentGoalLoopState = {
            ...goalLoop,
            phase: 'evaluating',
            lastVerify: snapshot,
            updatedAt: Date.now(),
        };
        this.store.patchGoalLoop(conversationId, evaluating);

        const evaluation = await this.evaluator.evaluate({
            goal: goalLoop.goal,
            verify: snapshot,
            transcriptExcerpt: excerptGoalLoopTranscript(conv.messages),
            gitDiffSummary: conv.gitDiffAdded !== undefined
                ? { added: conv.gitDiffAdded, removed: conv.gitDiffRemoved ?? 0 }
                : undefined,
        }, conv.cwd);

        const evaluatorCalls = (goalLoop.evaluatorCalls ?? 0) + 1;
        if (evaluation.done) {
            const completed: QaapAgentGoalLoopState = {
                ...evaluating,
                phase: 'completed',
                lastEvaluation: evaluation,
                evaluatorCalls,
                stopReason: evaluation.reasoning,
                updatedAt: Date.now(),
            };
            this.store.patchGoalLoop(conversationId, completed);
            this.notifyGoalLoopTerminal(conversationId, conv, completed);
            return;
        }

        const nextIteration = goalLoop.iteration + 1;
        if (this.blockIfBudgetExceeded(conversationId, evaluating, nextIteration, evaluation.reasoning)) {
            const blocked = this.store.get(conversationId)?.goalLoop;
            if (blocked) {
                this.notifyGoalLoopTerminal(conversationId, conv, blocked);
            }
            return;
        }

        const prompt = buildGoalLoopEvalGapPrompt(goalLoop.goal, evaluation);
        const patched: QaapAgentGoalLoopState = {
            ...evaluating,
            iteration: nextIteration,
            phase: 'executing',
            lastEvaluation: evaluation,
            evaluatorCalls,
            updatedAt: Date.now(),
        };
        this.store.patchGoalLoop(conversationId, patched);
        const fresh = this.store.get(conversationId);
        if (!fresh) {
            return;
        }
        this.store.postUserMessage(
            conversationId,
            prompt,
            fresh.agentId,
            fresh.agentModel ?? fresh.qaiqModel,
            fresh.autoApprove,
            fresh.interactionModeId,
            fresh.approvalPolicyId,
            fresh.toolApprovalRules,
        );
    }

    protected notifyGoalLoopTerminal(
        conversationId: string,
        conv: QaapAgentConversation,
        state: QaapAgentGoalLoopState,
    ): void {
        if (state.phase !== 'completed' && state.phase !== 'blocked') {
            return;
        }
        const ok = state.phase === 'completed';
        const projectName = conv.cwd.split(/[/\\]/).filter(Boolean).pop() ?? conv.cwd;
        void this.webPush.notify({
            title: ok ? 'Goal completed' : 'Goal loop stopped',
            body: `${conv.title}: ${state.stopReason ?? state.goal}`,
            tag: `qaap-goal-loop-${conversationId}`,
            route: 'transcript',
            conversationId,
            agentId: conv.agentId,
            projectName,
        }).catch(() => undefined);
        void this.githubEvidence.notifyGoalLoopTerminal(conversationId, conv, state).catch(() => undefined);
    }

    protected blockIfBudgetExceeded(
        conversationId: string,
        goalLoop: QaapAgentGoalLoopState,
        nextIteration: number,
        reason: string,
    ): boolean {
        const probe: QaapAgentGoalLoopState = { ...goalLoop, iteration: nextIteration };
        if (!isGoalLoopBudgetExceeded(probe)) {
            return false;
        }
        this.store.patchGoalLoop(conversationId, {
            ...goalLoop,
            iteration: nextIteration,
            phase: 'blocked',
            stopReason: reason,
            updatedAt: Date.now(),
        });
        const conv = this.store.get(conversationId);
        if (conv?.goalLoop) {
            this.notifyGoalLoopTerminal(conversationId, conv, conv.goalLoop);
        }
        return true;
    }
}

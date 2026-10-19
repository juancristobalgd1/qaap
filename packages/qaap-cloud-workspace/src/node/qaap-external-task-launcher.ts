// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    buildExternalTaskFollowUp,
    buildExternalTaskPrompt,
    describeExternalTaskRefusal,
    type QaapExternalTaskIntakeRequest,
    type QaapExternalTaskOrigin,
    type QaapExternalTaskRefusal,
    type QaapExternalTaskStatus,
    type QaapExternalTaskTriggerEvent,
} from '../common/qaap-external-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapConversationWorktreeService } from './qaap-conversation-worktree';
import { QaapExternalTaskStore } from './qaap-external-task-store';
import { QaapGithubExternalTaskSource } from './qaap-github-external-task-source';
import { QaapTaskPlanFanOutService } from './qaap-task-plan-fanout-service';
import { QaapTaskPullRequestConsentStore } from './qaap-task-pull-request-consent-store';
import { QaapTaskPullRequestService } from './qaap-task-pull-request-service';
import { QaapWebPushService } from './qaap-web-push-service';

export type QaapExternalTaskLaunchResult =
    | { readonly status: 'started' | 'follow-up'; readonly conversationId: string }
    | { readonly status: 'duplicate' }
    | { readonly status: 'refused'; readonly reason: QaapExternalTaskRefusal };

/** `QAAP_EXTERNAL_TASKS_MAX_ACTIVE`: running external tasks per requester (default 3). */
export function resolveExternalTaskMaxActive(env: NodeJS.ProcessEnv = process.env): number {
    const configured = Number.parseInt(env.QAAP_EXTERNAL_TASKS_MAX_ACTIVE?.trim() ?? '', 10);
    return Number.isInteger(configured) && configured > 0 ? configured : 3;
}

/**
 * Starts (or continues) the conversation of a confirmed external trigger in the backend that owns the
 * requester's conversations (doc/qaap-external-task-inputs.md). The control plane already confirmed the
 * requester and the text with the GitHub API; this side checks what lives here: the repository opt-in, the
 * checkout, the delivery dedup and the issue → conversation binding.
 */
@injectable()
export class QaapExternalTaskLauncher {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapExternalTaskStore)
    protected readonly tasks: QaapExternalTaskStore;

    @inject(QaapTaskPullRequestConsentStore)
    protected readonly consents: QaapTaskPullRequestConsentStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapConversationWorktreeService)
    protected readonly worktrees: QaapConversationWorktreeService;

    @inject(QaapTaskPullRequestService)
    protected readonly pullRequests: QaapTaskPullRequestService;

    @inject(QaapGithubExternalTaskSource)
    protected readonly github: QaapGithubExternalTaskSource;

    @inject(QaapWebPushService) @optional()
    protected readonly push: QaapWebPushService | undefined;

    @inject(QaapTaskPlanFanOutService) @optional()
    protected readonly taskPlans: QaapTaskPlanFanOutService | undefined;

    async launch(request: QaapExternalTaskIntakeRequest): Promise<QaapExternalTaskLaunchResult> {
        const event = request.event;
        const login = request.requester;
        if (!this.tasks.claimDelivery(event.deliveryId)) {
            return { status: 'duplicate' };
        }
        if (request.kind === 'refused') {
            return this.refuse(login, event, request.reason);
        }
        if (!this.consents.isExternalGithubAllowed(login, event.owner, event.repo)) {
            return this.refuse(login, event, 'not-opted-in');
        }
        const existingId = this.tasks.conversationForIssue(event.source, event.repositoryId, event.issueNumber);
        const existing = existingId ? this.store.get(existingId) : undefined;
        if (existing && !existing.archived && existing.ownerLogin?.toLowerCase() === login.toLowerCase()) {
            return this.followUp(existing.id, login, event);
        }
        if (existingId) {
            this.tasks.unbindIssue(event.source, event.repositoryId, event.issueNumber);
        }
        if (this.activeExternalTasks(login) >= resolveExternalTaskMaxActive()) {
            return this.refuse(login, event, 'too-many-active');
        }
        const resolved = this.auth.resolveOwnedRepositoryCwdForLogin(login, `github:${event.owner}/${event.repo}`);
        if (resolved.kind !== 'ok') {
            return this.refuse(login, event, 'no-clone');
        }
        const origin: QaapExternalTaskOrigin = {
            source: event.source,
            owner: event.owner,
            repo: event.repo,
            repositoryId: event.repositoryId,
            issueNumber: event.issueNumber,
            issueUrl: event.issueUrl,
            requester: login,
            issueAuthor: event.issueAuthor,
            deliveryId: event.deliveryId,
            requestedAt: Date.now(),
        };
        try {
            // Always its own worktree: an issue must never edit the checkout the user may be working in.
            let cwd = resolved.cwd;
            let parallelBaseCwd: string | undefined;
            let worktreeBranch: string | undefined;
            try {
                const worktree = await this.worktrees.create(resolved.cwd, login);
                parallelBaseCwd = resolved.cwd;
                cwd = worktree.worktreePath;
                worktreeBranch = worktree.branch;
            } catch (error) {
                console.warn(`[qaap-external-task] worktree unavailable for ${event.owner}/${event.repo}, sharing the checkout:`, error);
            }
            const message = buildExternalTaskPrompt(event);
            const planTask = !!this.taskPlans && this.taskPlans.shouldPlan({ message }, undefined, cwd);
            // `QAAP_EXTERNAL_TASKS_AGENT` pins the agent of issue tasks; otherwise the user's default agent runs.
            const agent = process.env.QAAP_EXTERNAL_TASKS_AGENT?.trim() || undefined;
            const conversation = this.store.create({
                cwd,
                ...(agent ? { agent } : {}),
                ...(parallelBaseCwd ? { parallelBaseCwd } : {}),
                ...(worktreeBranch ? { worktreeBranch } : {}),
                title: `#${event.issueNumber} ${event.issueTitle}`.slice(0, 200),
                message,
                interactionModeId: 'agent',
                ...(planTask ? { interactionModeId: 'plan', taskPlan: this.taskPlans!.createDraftPlan() } : {}),
                externalTask: origin,
            }, login);
            this.tasks.bindIssue(event.source, event.repositoryId, event.issueNumber, conversation.id);
            this.tasks.markNotified(conversation.id, 'started');
            await this.postStatus(origin, { kind: 'started' });
            console.info(`[qaap-external-task] delivery ${event.deliveryId}: ${event.owner}/${event.repo}#${event.issueNumber} → conversation ${conversation.id}`);
            return { status: 'started', conversationId: conversation.id };
        } catch (error) {
            console.warn(`[qaap-external-task] could not start ${event.owner}/${event.repo}#${event.issueNumber}:`, error);
            return this.refuse(login, event, 'failed');
        }
    }

    protected async followUp(conversationId: string, login: string, event: QaapExternalTaskTriggerEvent): Promise<QaapExternalTaskLaunchResult> {
        const content = event.trigger === 'comment' ? buildExternalTaskFollowUp(event) : buildExternalTaskPrompt(event);
        try {
            this.store.postUserMessage(conversationId, content, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'queue');
        } catch (error) {
            console.warn(`[qaap-external-task] follow-up on ${conversationId} failed:`, error);
            return this.refuse(login, event, 'failed');
        }
        const conv = this.store.get(conversationId);
        if (conv?.externalTask) {
            await this.postStatus(conv.externalTask, { kind: 'follow-up' });
        }
        return { status: 'follow-up', conversationId };
    }

    /** Running (not idle) conversations of `login` started from outside the app. */
    protected activeExternalTasks(login: string): number {
        return this.store.list(undefined).filter(summary => !!summary.externalTask
            && summary.externalTask.requester.toLowerCase() === login.toLowerCase()
            && !summary.archived
            && summary.status === 'streaming').length;
    }

    /** Refusals go to the requester only (web push), never to the issue: a comment would tell anyone they use Qaap. */
    protected async refuse(login: string, event: QaapExternalTaskTriggerEvent, reason: QaapExternalTaskRefusal): Promise<QaapExternalTaskLaunchResult> {
        console.info(`[qaap-external-task] delivery ${event.deliveryId} for ${event.owner}/${event.repo}#${event.issueNumber} refused: ${reason}`);
        try {
            await this.push?.notify({
                title: `Qaap: ${event.owner}/${event.repo}#${event.issueNumber}`,
                body: describeExternalTaskRefusal(reason, `${event.owner}/${event.repo}`),
                tag: `qaap-external-task:${event.owner}/${event.repo}#${event.issueNumber}`,
                userLogin: login,
            });
        } catch (error) {
            console.warn('[qaap-external-task] push failed:', error);
        }
        return { status: 'refused', reason };
    }

    /** Posts a status back to the issue with the requester's token; a failure is logged, never fatal. */
    async postStatus(origin: QaapExternalTaskOrigin, status: QaapExternalTaskStatus): Promise<boolean> {
        const token = this.pullRequests.resolveOwnerToken(origin.requester);
        if (!token) {
            console.warn(`[qaap-external-task] no GitHub token for ${origin.requester}: ${status.kind} not posted to ${origin.owner}/${origin.repo}#${origin.issueNumber}`);
            return false;
        }
        try {
            await this.github.postStatus(origin, token, status);
            return true;
        } catch (error) {
            console.warn(`[qaap-external-task] could not comment on ${origin.owner}/${origin.repo}#${origin.issueNumber}:`, error);
            return false;
        }
    }
}

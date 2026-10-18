// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import { latestConversationTurnHasError, type QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import type { QaapExternalTaskOrigin, QaapExternalTaskStatus } from '../common/qaap-external-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { isQaapExternalTasksGithubEnabled } from './qaap-external-task-intake';
import { QaapExternalTaskLauncher } from './qaap-external-task-launcher';
import { QaapExternalTaskStore } from './qaap-external-task-store';
import { QaapTaskPullRequestService, type QaapTaskPullRequestSyncOutcome } from './qaap-task-pull-request-service';
import { QaapWebPushService } from './qaap-web-push-service';

/**
 * Tells the origin of an external task how it went (doc/qaap-external-task-inputs.md, "Aviso"): a comment on
 * the issue and a web push to the requester, once per status. Watches the conversations that carry
 * `externalTask` and the task pull request service's "nothing to push" outcomes.
 */
@injectable()
export class QaapExternalTaskNotifier implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapExternalTaskStore)
    protected readonly tasks: QaapExternalTaskStore;

    @inject(QaapExternalTaskLauncher)
    protected readonly launcher: QaapExternalTaskLauncher;

    @inject(QaapTaskPullRequestService)
    protected readonly pullRequests: QaapTaskPullRequestService;

    @inject(QaapWebPushService) @optional()
    protected readonly push: QaapWebPushService | undefined;

    /** Serializes the notifications of one conversation, so a status is never posted twice concurrently. */
    protected readonly chains = new Map<string, Promise<void>>();

    @postConstruct()
    protected init(): void {
        if (!isQaapExternalTasksGithubEnabled()) {
            return;
        }
        this.store.onDidChange(event => this.onConversationEvent(event));
        this.pullRequests.onDidSync(outcome => this.onPullRequestOutcome(outcome));
    }

    /** Bound as a contribution only so it is instantiated (and subscribed) at startup. */
    initialize(): void {
        // Subscriptions happen in init().
    }

    protected onConversationEvent(event: QaapAgentConversationEvent): void {
        if (event.type !== 'updated' || !event.conversation.externalTask) {
            return;
        }
        const conversationId = event.conversation.id;
        const conv = this.store.get(conversationId);
        if (!conv?.externalTask) {
            return;
        }
        const origin = conv.externalTask;
        const pr = conv.taskPullRequest;
        if (pr?.number && pr.url) {
            this.notify(conversationId, origin, `pr:${pr.number}`, {
                kind: 'pull-request', number: pr.number, url: pr.url, needsAttention: pr.state === 'draft-needs-attention',
            });
            return;
        }
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user');
        if (pr?.state === 'awaiting-consent' || pr?.state === 'needs-sign-in') {
            this.notify(conversationId, origin, `${pr.state}:${lastUser?.id ?? ''}`, { kind: pr.state });
            return;
        }
        if (conv.status !== 'streaming' && lastUser && latestConversationTurnHasError(conv.messages)) {
            this.notify(conversationId, origin, `failed:${lastUser.id}`, { kind: 'failed' });
        }
    }

    protected onPullRequestOutcome(outcome: QaapTaskPullRequestSyncOutcome): void {
        const conv = this.store.get(outcome.conversationId);
        if (!conv?.externalTask || conv.taskPullRequest?.number) {
            return;
        }
        // A failed turn is told as "failed" by onConversationEvent, not as "no changes".
        if (latestConversationTurnHasError(conv.messages)) {
            return;
        }
        this.notify(conv.id, conv.externalTask, `no-changes:${outcome.lastUserMessageId ?? ''}`, { kind: 'no-changes' });
    }

    protected notify(conversationId: string, origin: QaapExternalTaskOrigin, key: string, status: QaapExternalTaskStatus): void {
        const previous = this.chains.get(conversationId) ?? Promise.resolve();
        const next = previous.then(async () => {
            if (!this.tasks.markNotified(conversationId, key)) {
                return;
            }
            await this.launcher.postStatus(origin, status);
            await this.pushStatus(conversationId, origin, status);
        }).catch(error => console.warn('[qaap-external-task] notification failed:', error));
        this.chains.set(conversationId, next);
        void next.finally(() => {
            if (this.chains.get(conversationId) === next) {
                this.chains.delete(conversationId);
            }
        });
    }

    protected async pushStatus(conversationId: string, origin: QaapExternalTaskOrigin, status: QaapExternalTaskStatus): Promise<void> {
        const body = this.describePush(status);
        if (!body || !this.push) {
            return;
        }
        try {
            const conv = this.store.get(conversationId);
            await this.push.notify({
                title: `Qaap: ${origin.owner}/${origin.repo}#${origin.issueNumber}`,
                body,
                tag: `qaap-external-task:${conversationId}`,
                userLogin: origin.requester,
                route: 'conversation',
                conversationId,
                ...(conv ? { cwd: conv.parallelBaseCwd ?? conv.cwd } : {}),
            });
        } catch (error) {
            console.warn('[qaap-external-task] push failed:', error);
        }
    }

    protected describePush(status: QaapExternalTaskStatus): string | undefined {
        switch (status.kind) {
            case 'pull-request':
                return status.needsAttention ? `Draft PR #${status.number} opened: it needs attention.` : `PR #${status.number} opened.`;
            case 'no-changes': return 'Finished without changes: no pull request.';
            case 'failed': return 'The task failed. Open it to see why.';
            case 'needs-sign-in': return 'Sign in again so Qaap can open the pull request.';
            case 'awaiting-consent': return 'Allow Qaap to open pull requests on this repository.';
            default: return undefined;
        }
    }
}

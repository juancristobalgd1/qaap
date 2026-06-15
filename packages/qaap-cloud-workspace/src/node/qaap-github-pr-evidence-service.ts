// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { resolveMessagePreviewText } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-content';
import { resolveAgentLogDisplayText } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { postGithubIssueComment } from '@theia/qaap-mobile-shell/lib/node/qaap-github-api';
import { readQaapGithubOAuthConfig } from '@theia/qaap-mobile-shell/lib/node/qaap-github-oauth-config';
import { QaapGithubSessionStore } from '@theia/qaap-mobile-shell/lib/node/qaap-github-session-store';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { isGoalLoopActive, type QaapAgentGoalLoopState } from '../common/qaap-agent-goal-loop';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import {
    buildGithubTaskEvidenceComment,
    resolveGithubEvidenceTarget,
    wasGithubEvidencePostedForTask,
} from '../common/qaap-github-pr-evidence';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** Posts GitHub issue/PR comments when agent tasks complete (Issue 5 evidence handoff). */
@injectable()
export class QaapGithubPrEvidenceService {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    @inject(QaapGithubSessionStore)
    protected readonly githubSessions: QaapGithubSessionStore;

    @postConstruct()
    protected init(): void {
        this.store.onTurnSettled(event => {
            void this.onTurnSettled(event.conversationId, event.conv, event.userMessageId);
        });
    }

    /** Goal-loop terminal hook — one summary comment instead of per-turn spam. */
    async notifyGoalLoopTerminal(
        conversationId: string,
        conv: QaapAgentConversation,
        state: QaapAgentGoalLoopState,
    ): Promise<void> {
        if (state.phase !== 'completed' && state.phase !== 'blocked') {
            return;
        }
        const target = resolveGithubEvidenceTarget({
            githubEvidence: conv.githubEvidence,
            linkedPullRequest: conv.linkedPullRequest,
        });
        if (!target || conv.githubEvidence?.goalLoopPosted) {
            return;
        }
        const ok = state.phase === 'completed';
        const body = buildGithubTaskEvidenceComment({
            ok,
            title: conv.title,
            summary: this.extractLastAgentSummary(conv),
            linesAdded: conv.gitDiffAdded,
            linesRemoved: conv.gitDiffRemoved,
            workHubUrl: this.buildWorkHubUrl(conversationId),
            goalLoopStopReason: state.stopReason,
        });
        const posted = await this.postComment(target, body);
        if (posted) {
            this.store.patchGithubEvidencePosted(conversationId, { goalLoop: true });
        }
    }

    protected async onTurnSettled(
        conversationId: string,
        conv: QaapAgentConversation,
        userMessageId: string,
    ): Promise<void> {
        if (isGoalLoopActive(conv.goalLoop)) {
            return;
        }
        const target = resolveGithubEvidenceTarget({
            githubEvidence: conv.githubEvidence,
            linkedPullRequest: conv.linkedPullRequest,
        });
        if (!target) {
            return;
        }
        const userMessage = conv.messages.find(message => message.id === userMessageId);
        const taskId = userMessage?.taskId;
        if (!taskId) {
            return;
        }
        if (wasGithubEvidencePostedForTask(conv.githubEvidence, conv.githubEvidencePostedTaskIds, taskId)) {
            return;
        }
        const task = this.taskRunner.list().find(entry => entry.id === taskId);
        if (!task || !this.isTerminalTaskState(task.state)) {
            return;
        }
        await this.postTaskEvidence(conversationId, conv, task, target);
    }

    protected async postTaskEvidence(
        conversationId: string,
        conv: QaapAgentConversation,
        task: QaapAgentTask,
        target: { readonly owner: string; readonly repo: string; readonly issueNumber: number },
    ): Promise<void> {
        const detail = await this.taskRunner.detail(task.id);
        const log = (detail?.log ?? '').trim();
        const ok = task.state === 'completed' && conv.status !== 'failed';
        const body = buildGithubTaskEvidenceComment({
            ok,
            title: conv.title,
            summary: this.extractLastAgentSummary(conv) || conv.title,
            linesAdded: conv.gitDiffAdded,
            linesRemoved: conv.gitDiffRemoved,
            workHubUrl: this.buildWorkHubUrl(conversationId),
            logTail: ok ? undefined : (log ? resolveAgentLogDisplayText(conv.agentId, log) : undefined),
        });
        const posted = await this.postComment(target, body);
        if (posted) {
            this.store.patchGithubEvidencePosted(conversationId, { taskId: task.id });
        }
    }

    protected async postComment(
        target: { readonly owner: string; readonly repo: string; readonly issueNumber: number },
        body: string,
    ): Promise<boolean> {
        const session = this.githubSessions.getAnySession();
        if (!session) {
            return false;
        }
        try {
            await postGithubIssueComment(
                session.accessToken,
                target.owner,
                target.repo,
                target.issueNumber,
                body,
            );
            return true;
        } catch {
            return false;
        }
    }

    protected extractLastAgentSummary(conv: QaapAgentConversation): string | undefined {
        for (let index = conv.messages.length - 1; index >= 0; index -= 1) {
            const message = conv.messages[index];
            if (message.role !== 'agent') {
                continue;
            }
            const preview = resolveMessagePreviewText(message).replace(/\s+/g, ' ').trim();
            return preview || undefined;
        }
        return undefined;
    }

    protected buildWorkHubUrl(conversationId: string): string | undefined {
        const publicUrl = readQaapGithubOAuthConfig()?.publicUrl;
        if (!publicUrl) {
            return undefined;
        }
        const url = new URL(`${publicUrl}/`);
        url.searchParams.set('qaap_route', 'transcript');
        url.searchParams.set('qaap_conversation', conversationId);
        return url.toString();
    }

    protected isTerminalTaskState(state: QaapAgentTask['state']): boolean {
        return state === 'completed'
            || state === 'failed'
            || state === 'interrupted'
            || state === 'cancelled';
    }
}

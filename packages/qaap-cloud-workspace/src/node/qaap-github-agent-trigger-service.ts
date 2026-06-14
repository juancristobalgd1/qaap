// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { buildGithubIssueAgentPrompt } from '@theia/qaap-mobile-shell/lib/common/qaap-github-agent-trigger';
import { fetchGithubRepository } from '@theia/qaap-mobile-shell/lib/node/qaap-github-api';
import {
    type QaapGithubAgentTriggerBridge,
    type QaapGithubAgentTriggerRequest,
    type QaapGithubAgentTriggerResult,
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-agent-trigger-bridge';
import { ensureGithubRepositoryWorkspace } from '@theia/qaap-mobile-shell/lib/node/qaap-github-repo-workspace';
import { readQaapGithubOAuthConfig } from '@theia/qaap-mobile-shell/lib/node/qaap-github-oauth-config';
import { QaapGithubSessionStore } from '@theia/qaap-mobile-shell/lib/node/qaap-github-session-store';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

const TRIGGER_DEDUPE_TTL_MS = 60 * 60 * 1000;

/** Starts VPS agent conversations from GitHub `@qaap` issue/PR comments. */
@injectable()
export class QaapGithubAgentTriggerService implements QaapGithubAgentTriggerBridge {

    @inject(QaapAgentConversationStore)
    protected readonly conversations: QaapAgentConversationStore;

    @inject(QaapGithubSessionStore)
    protected readonly githubSessions: QaapGithubSessionStore;

    protected readonly recentCommentIds = new Map<number, { conversationId: string; at: number }>();

    async triggerFromGithubComment(request: QaapGithubAgentTriggerRequest): Promise<QaapGithubAgentTriggerResult> {
        if (request.commentId !== undefined) {
            const cached = this.recentCommentIds.get(request.commentId);
            if (cached && Date.now() - cached.at < TRIGGER_DEDUPE_TTL_MS) {
                return {
                    ok: true,
                    conversationId: cached.conversationId,
                    workHubUrl: this.buildWorkHubUrl(cached.conversationId),
                };
            }
        }
        const session = this.githubSessions.getAnySession();
        if (!session) {
            return { ok: false, error: 'No GitHub OAuth session — sign in to Qaap on the VPS first.' };
        }
        let cwd = this.conversations.findCwdForGithubRepo(request.owner, request.repo);
        if (!cwd) {
            try {
                const repository = await fetchGithubRepository(session.accessToken, request.owner, request.repo);
                cwd = await ensureGithubRepositoryWorkspace(repository, session.accessToken);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                return {
                    ok: false,
                    error: `Repository ${request.owner}/${request.repo} is not linked to Qaap yet (${detail}).`,
                };
            }
        }
        const message = buildGithubIssueAgentPrompt({
            prompt: request.prompt,
            issueNumber: request.issueNumber,
            commentAuthor: request.commentAuthor,
            htmlUrl: request.htmlUrl,
        });
        try {
            const conversation = this.conversations.create({
                cwd,
                title: request.prompt.slice(0, 120) || `GitHub #${request.issueNumber}`,
                message,
                autoApprove: true,
                githubEvidence: {
                    owner: request.owner,
                    repo: request.repo,
                    issueNumber: request.issueNumber,
                    ...(request.commentId !== undefined ? { triggerCommentId: request.commentId } : {}),
                },
            });
            if (request.commentId !== undefined) {
                this.pruneRecentCommentIds();
                this.recentCommentIds.set(request.commentId, {
                    conversationId: conversation.id,
                    at: Date.now(),
                });
            }
            return {
                ok: true,
                conversationId: conversation.id,
                workHubUrl: this.buildWorkHubUrl(conversation.id),
            };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
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

    protected pruneRecentCommentIds(): void {
        const cutoff = Date.now() - TRIGGER_DEDUPE_TTL_MS;
        for (const [commentId, entry] of this.recentCommentIds.entries()) {
            if (entry.at < cutoff) {
                this.recentCommentIds.delete(commentId);
            }
        }
    }
}

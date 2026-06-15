// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    QAAP_GITHUB_API_PATH,
    type QaapGithubPullRequestSummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    githubCommentTriggersAgent,
    isLikelyQaapAckComment,
    stripQaapMentionFromPrompt,
} from '../common/qaap-github-agent-trigger';
import { verifyGithubWebhookSignature } from '../common/qaap-github-webhook-signature';
import { readGithubWebhookPayload, useQaapJsonBodyParser } from './qaap-express-json-middleware';
import {
    QaapGithubAgentTriggerBridge,
    type QaapGithubAgentTriggerRequest,
} from './qaap-github-agent-trigger-bridge';
import { fetchGithubPullRequestFiles, postGithubIssueComment } from './qaap-github-api';
import { QaapGithubInboxHub } from './qaap-github-inbox-hub';
import { QaapGithubSessionStore } from './qaap-github-session-store';

const SSE_HEARTBEAT_MS = 25_000;

interface GithubWebhookRepository {
    owner?: { login?: string };
    name?: string;
}

interface GithubWebhookPullRequest {
    number: number;
    title: string;
    html_url: string;
    updated_at: string;
    state: string;
    user?: { login?: string | null } | null;
    head: { ref: string };
    base: { ref: string };
    changed_files?: number;
    additions?: number;
    deletions?: number;
    mergeable?: boolean | null;
}

interface GithubWebhookIssue {
    number: number;
    title?: string;
    body?: string;
    html_url?: string;
    labels?: Array<{ name?: string }>;
}

interface GithubWebhookComment {
    id: number;
    body?: string;
    html_url?: string;
    user?: { login?: string | null } | null;
}

interface GithubWebhookBody {
    action?: string;
    pull_request?: GithubWebhookPullRequest;
    issue?: GithubWebhookIssue;
    comment?: GithubWebhookComment;
    repository?: GithubWebhookRepository;
}

/** GitHub webhooks + SSE inbox stream for the Work Hub (lives in mobile-shell so browser apps always load it). */
@injectable()
export class QaapGithubInboxEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubInboxHub)
    protected readonly hub: QaapGithubInboxHub;

    @inject(QaapGithubSessionStore)
    protected readonly sessions: QaapGithubSessionStore;

    @inject(QaapGithubAgentTriggerBridge) @optional()
    protected readonly agentTrigger?: QaapGithubAgentTriggerBridge;

    configure(app: Application): void {
        useQaapJsonBodyParser(app);
        app.post(`${QAAP_GITHUB_API_PATH}/webhook`, (req, res) => {
            void this.handleWebhook(req, res);
        });
        app.get(`${QAAP_GITHUB_API_PATH}/inbox/stream`, (req, res) => {
            this.handleInboxStream(req, res);
        });
    }

    protected async handleWebhook(req: Request, res: Response): Promise<void> {
        const secret = process.env.QAAP_GITHUB_WEBHOOK_SECRET?.trim();
        if (secret && !this.verifyWebhookSignature(req, secret)) {
            res.status(401).json({ error: 'Invalid webhook signature.' });
            return;
        }
        const event = req.header('x-github-event')?.trim() ?? '';
        const body = (req.body ?? {}) as GithubWebhookBody;
        if (event === 'issue_comment') {
            await this.handleIssueCommentWebhook(body, res);
            return;
        }
        if (event === 'issues') {
            await this.handleIssuesWebhook(body, res);
            return;
        }
        if (body.pull_request && body.repository?.owner?.login && body.repository.name) {
            await this.handlePullRequestWebhook(body, res);
            return;
        }
        res.status(202).json({ ok: true, ignored: true });
    }

    protected async handlePullRequestWebhook(body: GithubWebhookBody, res: Response): Promise<void> {
        const action = body.action ?? 'unknown';
        const owner = body.repository!.owner!.login!;
        const repo = body.repository!.name!;
        const pull = body.pull_request!;
        const stored = this.sessions.getAnySession();
        let filesPreview: QaapGithubPullRequestSummary['filesPreview'] = [];
        if (stored && pull.state === 'open') {
            try {
                filesPreview = await fetchGithubPullRequestFiles(stored.accessToken, owner, repo, pull.number);
            } catch {
                filesPreview = [];
            }
        }
        const summary: QaapGithubPullRequestSummary = {
            owner,
            repo,
            number: pull.number,
            title: pull.title,
            branch: pull.head.ref,
            base: pull.base.ref,
            author: pull.user?.login || 'unknown',
            files: pull.changed_files ?? 0,
            adds: pull.additions ?? 0,
            dels: pull.deletions ?? 0,
            tests: 'unknown',
            htmlUrl: pull.html_url,
            mergeable: pull.mergeable ?? undefined,
            filesPreview,
            updatedAt: pull.updated_at,
        };
        this.hub.publishPullRequest(action, summary, 0);
        res.status(202).json({ ok: true });
    }

    protected async handleIssueCommentWebhook(body: GithubWebhookBody, res: Response): Promise<void> {
        const owner = body.repository?.owner?.login;
        const repo = body.repository?.name;
        const issue = body.issue;
        const comment = body.comment;
        if (!owner || !repo || !issue?.number || !comment) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        if (body.action !== 'created') {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        if (isLikelyQaapAckComment(comment.body, comment.user?.login ?? undefined)) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        if (!githubCommentTriggersAgent({
            body: comment.body,
            issueLabels: issue.labels,
        })) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        const prompt = stripQaapMentionFromPrompt(comment.body ?? '');
        if (!prompt) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        await this.dispatchAgentTrigger({
            owner,
            repo,
            issueNumber: issue.number,
            commentId: comment.id,
            commentAuthor: comment.user?.login ?? undefined,
            prompt,
            htmlUrl: comment.html_url ?? issue.html_url,
        }, res);
    }

    protected async handleIssuesWebhook(body: GithubWebhookBody, res: Response): Promise<void> {
        const owner = body.repository?.owner?.login;
        const repo = body.repository?.name;
        const issue = body.issue;
        if (!owner || !repo || !issue?.number) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        if (body.action !== 'opened' && body.action !== 'labeled') {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        if (!githubCommentTriggersAgent({
            body: issue.body,
            issueLabels: issue.labels,
        })) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        const prompt = stripQaapMentionFromPrompt(issue.body ?? issue.title ?? '');
        if (!prompt) {
            res.status(202).json({ ok: true, ignored: true });
            return;
        }
        await this.dispatchAgentTrigger({
            owner,
            repo,
            issueNumber: issue.number,
            prompt,
            htmlUrl: issue.html_url,
        }, res);
    }

    protected async dispatchAgentTrigger(
        request: QaapGithubAgentTriggerRequest,
        res: Response,
    ): Promise<void> {
        const session = this.sessions.getAnySession();
        if (!this.agentTrigger) {
            if (session) {
                await this.postAckComment(request, session.accessToken, {
                    ok: false,
                    error: 'Qaap cloud workspace is not loaded on this server.',
                });
            }
            res.status(503).json({ ok: false, error: 'Agent trigger bridge unavailable.' });
            return;
        }
        const result = await this.agentTrigger.triggerFromGithubComment(request);
        this.hub.publishAgentTriggered({
            owner: request.owner,
            repo: request.repo,
            issueNumber: request.issueNumber,
            conversationId: result.conversationId,
            ok: result.ok,
            error: result.error,
        });
        if (session) {
            await this.postAckComment(request, session.accessToken, result);
        }
        res.status(result.ok ? 202 : 422).json(result);
    }

    protected async postAckComment(
        request: QaapGithubAgentTriggerRequest,
        accessToken: string,
        result: { ok: boolean; conversationId?: string; workHubUrl?: string; error?: string },
    ): Promise<void> {
        const body = result.ok
            ? [
                'Qaap started a task on this thread.',
                result.workHubUrl ? `[Open in Qaap](${result.workHubUrl})` : undefined,
                result.conversationId ? `(conversation \`${result.conversationId}\`)` : undefined,
            ].filter(Boolean).join(' ')
            : result.error?.includes('not linked')
                ? 'This repository is not linked to Qaap yet. Open Qaap, sign in with GitHub, and add this repository first.'
                : `Qaap could not start a task: ${result.error ?? 'unknown error'}`;
        try {
            await postGithubIssueComment(
                accessToken,
                request.owner,
                request.repo,
                request.issueNumber,
                body,
            );
        } catch {
            /* ack failure must not fail the webhook */
        }
    }

    protected verifyWebhookSignature(req: Request, secret: string): boolean {
        return verifyGithubWebhookSignature(
            readGithubWebhookPayload(req),
            secret,
            req.header('x-hub-signature-256'),
        );
    }

    protected handleInboxStream(req: Request, res: Response): void {
        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        res.write(': qaap-github-inbox stream\n\n');

        const subscription = this.hub.onDidChange(event => {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), SSE_HEARTBEAT_MS);

        const cleanup = (): void => {
            clearInterval(heartbeat);
            subscription.dispose();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }
}

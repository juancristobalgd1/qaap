// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, named, optional } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { raw } from 'body-parser';
import { createHmac, timingSafeEqual } from 'crypto';
import {
    QAAP_GITHUB_API_PATH,
    type QaapGithubPullRequestSummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { fetchGithubPullRequestFiles, fetchGithubRepositories } from './qaap-github-api';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubInboxHub } from './qaap-github-inbox-hub';
import { QaapGithubSessionStore } from './qaap-github-session-store';
import { QaapGithubWebhookListener } from './qaap-github-webhook-listener';

const SSE_HEARTBEAT_MS = 25_000;
/** GitHub caps webhook payloads at 25 MB; issue and PR events are a few KB. */
const WEBHOOK_MAX_BODY = '1mb';

interface GithubWebhookPullRequest {
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    updated_at: string;
    state: string;
    draft?: boolean;
    merged?: boolean;
    user?: { login?: string | null } | null;
    head: { ref: string };
    base: { ref: string };
    changed_files?: number;
    additions?: number;
    deletions?: number;
    mergeable?: boolean | null;
}

interface GithubWebhookBody {
    action?: string;
    pull_request?: GithubWebhookPullRequest;
    repository?: {
        owner?: { login?: string };
        name?: string;
    };
}

/** GitHub webhooks + SSE inbox stream for the Work Hub (lives in mobile-shell so browser apps always load it). */
@injectable()
export class QaapGithubInboxEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubInboxHub)
    protected readonly hub: QaapGithubInboxHub;

    @inject(QaapGithubSessionStore)
    protected readonly sessions: QaapGithubSessionStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(ContributionProvider) @named(QaapGithubWebhookListener) @optional()
    protected readonly listeners: ContributionProvider<QaapGithubWebhookListener> | undefined;

    configure(app: Application): void {
        // The signature covers GitHub's exact bytes: this route parses its own raw body (any content type).
        app.post(`${QAAP_GITHUB_API_PATH}/webhook`, raw({ type: () => true, limit: WEBHOOK_MAX_BODY }), (req, res) => {
            void this.handleWebhook(req, res);
        });
        // Contributions configured earlier (upstream `@theia/filesystem`'s download endpoint) install a global
        // `json()` that would consume the stream first. The webhook route goes to the front of the router.
        this.moveLastRouteFirst(app);
        app.get(`${QAAP_GITHUB_API_PATH}/inbox/stream`, (req, res) => {
            void this.handleInboxStream(req, res);
        });
    }

    /**
     * Moves the layer just added ahead of every middleware, but after Express 4's own init layers (`query`,
     * `expressInit`: they give `req.header`, `res.status`, ...). Express 4 `_router`, Express 5 `router`.
     */
    protected moveLastRouteFirst(app: Application): void {
        const router = (app as unknown as { _router?: { stack?: { name?: string }[] }; router?: { stack?: { name?: string }[] } });
        const stack = router._router?.stack ?? router.router?.stack;
        if (Array.isArray(stack) && stack.length > 1) {
            const layer = stack.pop()!;
            // Bundlers may suffix function names (`query2`); `expressInit` comes right after `query` in Express 4
            // and does not exist in Express 5 (its init runs in app.handle).
            const init = stack.findIndex(candidate => /^expressInit\d*$/.test(candidate.name ?? ''));
            stack.splice(init + 1, 0, layer);
        } else {
            console.warn('[qaap-github-webhook] could not move the webhook route first; signed deliveries may be refused');
        }
    }

    protected async handleWebhook(req: Request, res: Response): Promise<void> {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
        if (!rawBody) {
            // Another parser consumed the stream first: the signed bytes are gone, so nothing can be verified.
            res.status(400).json({ error: 'Webhook body unavailable.' });
            return;
        }
        const secret = process.env.QAAP_GITHUB_WEBHOOK_SECRET?.trim();
        if (!secret) {
            // Fail closed: an unset secret means any caller could forge events. Only accept unsigned
            // webhooks under skip-auth (single-user/local dev).
            if (!this.auth.isSkipAuthEnabled()) {
                res.status(503).json({ error: 'Webhook secret not configured.' });
                return;
            }
        } else if (!this.verifyWebhookSignature(req.header('x-hub-signature-256'), rawBody, secret)) {
            res.status(401).json({ error: 'Invalid webhook signature.' });
            return;
        }
        let payload: unknown;
        try {
            payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        } catch {
            res.status(400).json({ error: 'Webhook body is not JSON.' });
            return;
        }
        const event = req.header('x-github-event')?.trim() ?? '';
        const deliveryId = req.header('x-github-delivery')?.trim() ?? '';
        res.status(202).json({ ok: true });
        this.notifyListeners({ event, deliveryId, payload });
        if (event === 'pull_request' || (!event && (payload as GithubWebhookBody)?.pull_request)) {
            await this.publishPullRequest(payload as GithubWebhookBody);
        }
    }

    protected notifyListeners(delivery: { event: string; deliveryId: string; payload: unknown }): void {
        for (const listener of this.listeners?.getContributions() ?? []) {
            Promise.resolve()
                .then(() => listener.onGithubWebhook(delivery))
                .catch(error => console.warn(`[qaap-github-webhook] listener failed for delivery ${delivery.deliveryId}:`, error));
        }
    }

    protected async publishPullRequest(body: GithubWebhookBody): Promise<void> {
        if (!body?.pull_request || !body.repository?.owner?.login || !body.repository.name) {
            return;
        }
        const action = body.action ?? 'unknown';
        const owner = body.repository.owner.login;
        const repo = body.repository.name;
        const pull = body.pull_request;
        let filesPreview: QaapGithubPullRequestSummary['filesPreview'] = [];
        if (pull.state === 'open') {
            const accessToken = await this.resolveWebhookAccessToken(owner, repo, pull.number);
            if (accessToken) {
                try {
                    filesPreview = await fetchGithubPullRequestFiles(accessToken, owner, repo, pull.number);
                } catch {
                    filesPreview = [];
                }
            }
        }
        const summary: QaapGithubPullRequestSummary = {
            owner,
            repo,
            number: pull.number,
            title: pull.title,
            description: pull.body ?? undefined,
            branch: pull.head.ref,
            base: pull.base.ref,
            author: pull.user?.login || 'unknown',
            files: pull.changed_files ?? 0,
            adds: pull.additions ?? 0,
            dels: pull.deletions ?? 0,
            tests: 'unknown',
            state: pull.merged === true ? 'merged' : pull.state === 'closed' ? 'closed' : 'open',
            draft: pull.draft === true,
            htmlUrl: pull.html_url,
            mergeable: pull.mergeable ?? undefined,
            filesPreview,
            updatedAt: pull.updated_at,
        };
        this.hub.publishPullRequest(action, summary, 0);
    }

    /** `sha256=<hex HMAC-SHA256 of the raw body>`, compared in constant time. */
    verifyWebhookSignature(signature: string | undefined, rawBody: Buffer, secret: string): boolean {
        if (!signature?.startsWith('sha256=')) {
            return false;
        }
        const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
        const received = Buffer.from(signature);
        return received.length === expected.length && timingSafeEqual(received, expected);
    }

    protected async handleInboxStream(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        if (auth.kind === 'skip') {
            res.status(200).set({
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.end();
            return;
        }
        const allowedRepos = new Set(
            (await fetchGithubRepositories(auth.session.accessToken).catch(() => []))
                .map(repo => repo.fullName.toLowerCase()),
        );
        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders?.();
        res.write(': qaap-github-inbox stream\n\n');

        const subscription = this.hub.onDidChange(event => {
            if (event.type === 'pull_request') {
                const fullName = `${event.pullRequest.owner}/${event.pullRequest.repo}`.toLowerCase();
                if (!allowedRepos.has(fullName)) {
                    return;
                }
            }
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

    /** Resolve a GitHub token that can read the webhook repository (org or user-owned). */
    protected async resolveWebhookAccessToken(owner: string, repo: string, prNumber: number): Promise<string | undefined> {
        for (const session of this.sessions.listSessions()) {
            if (session.user.login.toLowerCase() !== owner.toLowerCase()) {
                continue;
            }
            try {
                await fetchGithubPullRequestFiles(session.accessToken, owner, repo, prNumber);
                return session.accessToken;
            } catch {
                /* try next session */
            }
        }
        return undefined;
    }
}

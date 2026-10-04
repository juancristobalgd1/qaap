// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QAAP_AUTH_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QAAP_API_TOKEN_MAX_PER_USER, QaapApiTokenStore } from './qaap-api-token-store';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubSessionStore } from './qaap-github-session-store';

/** Under the auth prefix so the per-tenant proxy serves it from the control plane (token store). */
export const QAAP_API_TOKENS_PATH = `${QAAP_AUTH_API_PATH}/api-tokens`;

/**
 * Mint, list and revoke personal API tokens. Only a signed-in browser session may manage tokens:
 * a token can call the API (e.g. `/api/qaap/agent-tasks`) but never mint or list other tokens.
 */
@injectable()
export class QaapApiTokenEndpoint implements BackendApplicationContribution {

    @inject(QaapApiTokenStore)
    protected readonly tokens: QaapApiTokenStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapGithubSessionStore)
    protected readonly sessions: QaapGithubSessionStore;

    configure(app: Application): void {
        app.get(QAAP_API_TOKENS_PATH, (req, res) => this.handleList(req, res));
        app.post(QAAP_API_TOKENS_PATH, (req, res) => this.handleCreate(req, res));
        app.delete(`${QAAP_API_TOKENS_PATH}/:id`, (req, res) => this.handleRevoke(req, res));
    }

    protected handleList(req: Request, res: Response): void {
        const session = this.requireAuthenticatedBrowserSession(req, res);
        if (session) {
            res.set('Cache-Control', 'no-store').json({ tokens: this.tokens.list(session.login) });
        }
    }

    protected handleCreate(req: Request, res: Response): void {
        const session = this.requireAuthenticatedBrowserSession(req, res);
        if (!session) {
            return;
        }
        const body = (req.body ?? {}) as { label?: unknown; expiresInDays?: unknown };
        const created = this.tokens.create(session.login, session.sessionId, typeof body.label === 'string' ? body.label : '',
            typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined);
        if (!created) {
            res.status(409).json({ error: `At most ${QAAP_API_TOKEN_MAX_PER_USER} API tokens; revoke one first.` });
            return;
        }
        res.set('Cache-Control', 'no-store').status(201).json({ token: created.token, ...created.summary });
    }

    protected handleRevoke(req: Request, res: Response): void {
        const session = this.requireAuthenticatedBrowserSession(req, res);
        if (!session) {
            return;
        }
        if (!this.tokens.revoke(session.login, req.params.id)) {
            res.status(404).json({ error: 'Unknown token.' });
            return;
        }
        res.status(204).end();
    }

    protected requireAuthenticatedBrowserSession(req: Request, res: Response): { readonly login: string; readonly sessionId: string } | undefined {
        if (this.auth.hasBearerApiToken(req)) {
            res.status(403).json({ error: 'API tokens cannot manage API tokens; sign in with the browser.' });
            return undefined;
        }
        // Cookie-authenticated mutations come from the Qaap page itself. `same-site` is refused too:
        // sibling subdomains (e.g. previews of user apps) send the session cookie. Browsers always
        // send Sec-Fetch-Site; curl with a copied cookie does not. Older browsers (Safari < 16.4) do
        // not either, so a POST without it must be JSON: a cross-site page can only send that after
        // a CORS preflight, which this endpoint never grants. A form post is text/plain or urlencoded.
        const fetchSite = req.headers['sec-fetch-site'];
        if (req.method !== 'GET' && fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
            res.status(403).json({ error: 'Cross-site request refused.' });
            return undefined;
        }
        if (req.method === 'POST' && fetchSite === undefined && !/^application\/json\s*(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
            res.status(415).json({ error: 'Send the request as application/json.' });
            return undefined;
        }
        const session = this.auth.resolveGithubSession(req);
        if (!session) {
            res.status(401).json({ error: 'Sign in first.' });
            return undefined;
        }
        this.tokens.revokeWithoutSession(session.stored.user.login, sessionId => !!this.sessions.getSession(sessionId));
        return { login: session.stored.user.login, sessionId: session.sessionId };
    }
}

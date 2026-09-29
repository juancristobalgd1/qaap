// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    QaapGithubAuthGuard,
    type QaapGithubAuthContext,
} from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QAAP_AGENT_HOOKS_API_PATH, type QaapAgentHooksPendingResponse } from '../common/qaap-agent-hooks';
import { QaapAgentHookService } from './qaap-agent-hook-service';

/**
 * HTTP surface for agent hooks: `GET ?cwd=` lists user hooks, the workspace declaration with its
 * trust state and recent warnings; `POST /trust|/ignore {cwd,digest}` records a review decision
 * bound to the digest the user saw; `POST /revoke {cwd}` drops it.
 */
@injectable()
export class QaapAgentHookEndpoint implements BackendApplicationContribution {

    @inject(QaapAgentHookService)
    protected readonly hooks: QaapAgentHookService;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(`${QAAP_AGENT_HOOKS_API_PATH}/pending`, (req, res) => this.handlePending(req, res));
        app.get(QAAP_AGENT_HOOKS_API_PATH, (req, res) => this.handle(req, res, 'status'));
        app.post(`${QAAP_AGENT_HOOKS_API_PATH}/trust`, (req, res) => this.handle(req, res, 'trust'));
        app.post(`${QAAP_AGENT_HOOKS_API_PATH}/ignore`, (req, res) => this.handle(req, res, 'ignore'));
        app.post(`${QAAP_AGENT_HOOKS_API_PATH}/revoke`, (req, res) => this.handle(req, res, 'revoke'));
    }

    protected handle(req: Request, res: Response, action: 'status' | 'trust' | 'ignore' | 'revoke'): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as { cwd?: unknown; digest?: unknown };
        const rawCwd = action === 'status'
            ? (typeof req.query.cwd === 'string' ? req.query.cwd.trim() : '')
            : (typeof body.cwd === 'string' ? body.cwd.trim() : '');
        if (!rawCwd) {
            res.status(400).json({ ok: false, error: '"cwd" is required.' });
            return;
        }
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd);
        if (resolved.kind === 'needs-project') {
            res.status(400).json({ ok: false, error: 'Select a project first.' });
            return;
        }
        if (resolved.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'agent_conversation', { cwd: rawCwd });
            return;
        }
        const ownerLogin = this.ownerLogin(ctx);
        try {
            if (action === 'status') {
                res.json(this.hooks.status(resolved.cwd, ownerLogin));
                return;
            }
            if (action === 'revoke') {
                const revoked = this.hooks.revoke(resolved.cwd, ownerLogin);
                res.status(revoked.ok ? 200 : 400).json(revoked);
                return;
            }
            const digest = typeof body.digest === 'string' ? body.digest.trim() : '';
            if (!/^[a-f0-9]{64}$/.test(digest)) {
                res.status(400).json({ ok: false, error: '"digest" must be the sha256 shown in the review.' });
                return;
            }
            const result = action === 'trust'
                ? this.hooks.trust(resolved.cwd, ownerLogin, digest)
                : this.hooks.ignore(resolved.cwd, ownerLogin, digest);
            res.status(result.ok ? 200 : 409).json(result);
        } catch (error) {
            res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Workspaces the caller's agent turns found with hooks awaiting review. Only the caller's own
     * entries are listed, and each is re-checked against the caller's repository ownership.
     */
    protected handlePending(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        try {
            const workspaces = this.hooks.listPending(this.ownerLogin(ctx))
                .filter(workspace => this.auth.resolveOwnedRepositoryCwd(ctx, workspace.cwd).kind === 'ok');
            const response: QaapAgentHooksPendingResponse = { workspaces };
            res.json(response);
        } catch (error) {
            res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /** Same owner key the conversation/task endpoints stamp on `task.ownerLogin`. */
    protected ownerLogin(ctx: QaapGithubAuthContext): string | undefined {
        return this.auth.resolveUserLogin(ctx);
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ctx;
    }
}

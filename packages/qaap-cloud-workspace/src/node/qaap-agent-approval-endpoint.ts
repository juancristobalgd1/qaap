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
} from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { QAAP_AGENT_APPROVAL_API_PATH } from '../common/qaap-agent-approval';
import { QaapAgentApprovalStore } from './qaap-agent-approval-store';

/** HTTP surface for granular VPS agent tool / permission approvals. */
@injectable()
export class QaapAgentApprovalEndpoint implements BackendApplicationContribution {

    @inject(QaapAgentApprovalStore)
    protected readonly store: QaapAgentApprovalStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_AGENT_APPROVAL_API_PATH, (req, res) => {
            void this.handleList(req, res);
        });
        app.post(`${QAAP_AGENT_APPROVAL_API_PATH}/:id/approve`, (req, res) => {
            void this.handleApprove(req, res);
        });
        app.post(`${QAAP_AGENT_APPROVAL_API_PATH}/:id/reject`, (req, res) => {
            void this.handleReject(req, res);
        });
    }

    protected async handleList(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        try {
            const cwd = typeof req.query.cwd === 'string' ? req.query.cwd : undefined;
            if (cwd && !this.auth.ownsWorkspacePath(ctx, cwd)) {
                this.auth.denyForbidden(res, req, 'agent_conversation', { cwd });
                return;
            }
            const approvals = await this.store.list(ctx, cwd);
            res.json({ approvals });
        } catch (error) {
            res.status(500).json({ ok: false, error: this.errorMessage(error) });
        }
    }

    protected async handleApprove(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        try {
            const result = await this.store.approve(ctx, req.params.id);
            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            res.status(500).json({ ok: false, error: this.errorMessage(error) });
        }
    }

    protected async handleReject(req: Request, res: Response): Promise<void> {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        try {
            const result = await this.store.reject(ctx, req.params.id);
            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            res.status(500).json({ ok: false, error: this.errorMessage(error) });
        }
    }

    protected requireAuth(req: Request, res: Response): QaapGithubAuthContext | undefined {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        return ctx;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

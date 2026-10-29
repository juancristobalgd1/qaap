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
import {
    QAAP_PROJECT_FOLDER_TRUST_API_PATH,
    type QaapProjectFolderTrustStatus,
} from '@theia/qaap-shared-core/lib/common/qaap-project-folder-trust';
import { QaapProjectFolderTrustStore } from './qaap-project-folder-trust-store';

/**
 * HTTP surface for the per-project "Do you trust the files in this folder?" decision. `GET ?cwd=` reads the
 * caller's decision for one project; `PUT {cwd, trusted}` records it. Both are owner-scoped: the folder must
 * be a repository the caller owns, so one user can neither read nor set another user's decision.
 */
@injectable()
export class QaapProjectFolderTrustEndpoint implements BackendApplicationContribution {

    @inject(QaapProjectFolderTrustStore)
    protected readonly store: QaapProjectFolderTrustStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(QAAP_PROJECT_FOLDER_TRUST_API_PATH, (req, res) => this.handleStatus(req, res));
        app.put(QAAP_PROJECT_FOLDER_TRUST_API_PATH, (req, res) => this.handleSet(req, res));
    }

    protected handleStatus(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const rawCwd = typeof req.query.cwd === 'string' ? req.query.cwd.trim() : '';
        const resolved = this.resolveCwd(ctx, rawCwd, req, res);
        if (!resolved) {
            return;
        }
        const record = this.store.get(this.ownerLogin(ctx), resolved);
        const status: QaapProjectFolderTrustStatus = {
            cwd: resolved,
            decided: !!record,
            trusted: record?.trusted === true,
            ...(record ? { decidedAt: record.decidedAt } : {}),
        };
        res.json(status);
    }

    protected handleSet(req: Request, res: Response): void {
        const ctx = this.requireAuth(req, res);
        if (!ctx) {
            return;
        }
        const body = (req.body ?? {}) as { cwd?: unknown; trusted?: unknown };
        const rawCwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
        if (typeof body.trusted !== 'boolean') {
            res.status(400).json({ ok: false, error: '"trusted" must be a boolean.' });
            return;
        }
        const resolved = this.resolveCwd(ctx, rawCwd, req, res);
        if (!resolved) {
            return;
        }
        try {
            const record = this.store.record(this.ownerLogin(ctx), resolved, body.trusted);
            const status: QaapProjectFolderTrustStatus = {
                cwd: resolved,
                decided: true,
                trusted: record.trusted,
                decidedAt: record.decidedAt,
            };
            res.json(status);
        } catch (error) {
            res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }

    /** Owner-scoped folder check; answers the request and returns `undefined` when the folder is not the caller's. */
    protected resolveCwd(ctx: QaapGithubAuthContext, rawCwd: string, req: Request, res: Response): string | undefined {
        if (!rawCwd) {
            res.status(400).json({ ok: false, error: '"cwd" is required.' });
            return undefined;
        }
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd);
        if (resolved.kind === 'needs-project') {
            res.status(400).json({ ok: false, error: 'Select a project first.' });
            return undefined;
        }
        if (resolved.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'agent_conversation', { cwd: rawCwd });
            return undefined;
        }
        return resolved.cwd;
    }

    /** Same owner key the task endpoints stamp on `task.ownerLogin`. */
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

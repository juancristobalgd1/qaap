// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { json } from 'body-parser';
import {
    QAAP_EXTERNAL_SESSIONS_IMPORT_PATH,
    QAAP_EXTERNAL_SESSIONS_PATH,
    isQaapExternalSessionSource,
    type QaapExternalSessionListResponse,
    type QaapExternalSessionSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-external-session-protocol';
import { QaapGithubAuthGuard, type QaapGithubAuthContext } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QaapAsyncRoute } from '@theia/qaap-shared-core/lib/node/qaap-async-route';
import { isQaapHostedProductionRuntime } from '@theia/qaap-shared-core/lib/node/qaap-production-auth-readiness';
import { QAAP_BACKEND_ISOLATION_MODE } from '@theia/qaap-adapters/lib/common/qaap-backend-isolation';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapAgentConversationStore } from '../qaap-agent-conversation-store';
import { QaapExternalSessionService } from './qaap-external-session-service';

/**
 * Lists the sessions other agent CLIs logged for a project and imports one as a conversation.
 * Reads only the backend's own home directory, so on hosted runtimes only a per-tenant backend answers
 * (same rule as Usage). See `doc/qaap-external-session-import.md`.
 */
@injectable()
export class QaapExternalSessionEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapExternalSessionService)
    protected readonly sessions: QaapExternalSessionService;

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    configure(app: Application): void {
        app.get(QAAP_EXTERNAL_SESSIONS_PATH, QaapAsyncRoute.wrap('qaap-external-sessions', (req, res) => this.handleList(req, res)));
        app.post(QAAP_EXTERNAL_SESSIONS_IMPORT_PATH, json({ limit: '4kb' }),
            QaapAsyncRoute.wrap('qaap-external-sessions', (req, res) => this.handleImport(req, res)));
    }

    protected async handleList(req: Request, res: Response): Promise<void> {
        const scope = this.resolveScope(req, res, typeof req.query.cwd === 'string' ? req.query.cwd : undefined);
        if (!scope) {
            return;
        }
        const found = await this.sessions.list(scope.cwd);
        const sessions = found.map(({ source, header }): QaapExternalSessionSummaryDTO => {
            const imported = this.store.findImportedConversation(source, header.sessionId, scope.ownerLogin);
            return {
                source,
                sessionId: header.sessionId,
                cwd: header.cwd,
                title: header.title,
                firstUserMessage: header.firstUserMessage,
                startedAt: header.startedAt,
                updatedAt: header.updatedAt,
                ...(header.originator ? { originator: header.originator } : {}),
                ...(imported ? { importedConversationId: imported.id } : {}),
            };
        });
        const body: QaapExternalSessionListResponse = { sessions };
        res.json(body);
    }

    protected async handleImport(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { cwd?: unknown; source?: unknown; sessionId?: unknown };
        const scope = this.resolveScope(req, res, typeof body.cwd === 'string' ? body.cwd : undefined);
        if (!scope) {
            return;
        }
        if (!isQaapExternalSessionSource(body.source) || typeof body.sessionId !== 'string' || !body.sessionId.trim()) {
            res.status(400).json({ error: '"source" (claude, codex, opencode or pi) and "sessionId" are required.' });
            return;
        }
        const sessionId = body.sessionId.trim();
        const existing = this.store.findImportedConversation(body.source, sessionId, scope.ownerLogin);
        if (existing) {
            res.status(200).json(existing);
            return;
        }
        const transcript = await this.sessions.load(body.source, sessionId, scope.cwd);
        if (!transcript || transcript.messages.length === 0) {
            res.status(404).json({ error: 'That session was not found for this project, or it has no messages.' });
            return;
        }
        const { conversation, created } = this.store.importExternalConversation(
            { cwd: scope.cwd, source: body.source, transcript },
            scope.ownerLogin,
        );
        res.status(created ? 201 : 200).json(conversation);
    }

    /** Signed-in user, allowed backend and an owned repository cwd; answers the error itself otherwise. */
    protected resolveScope(req: Request, res: Response, rawCwd: string | undefined): { cwd: string; ownerLogin: string | undefined } | undefined {
        if (!this.allowedOnThisBackend(res)) {
            return undefined;
        }
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return undefined;
        }
        if (!rawCwd?.trim()) {
            res.status(400).json({ error: '"cwd" is required.' });
            return undefined;
        }
        const resolved = this.auth.resolveOwnedRepositoryCwd(ctx, rawCwd.trim());
        if (resolved.kind === 'needs-project') {
            res.status(400).json({ error: 'Select a project first.' });
            return undefined;
        }
        if (resolved.kind !== 'ok') {
            this.auth.denyForbidden(res, req, 'agent_conversation', { cwd: rawCwd });
            return undefined;
        }
        return { cwd: resolved.cwd, ownerLogin: this.ownerLogin(ctx) };
    }

    protected ownerLogin(ctx: QaapGithubAuthContext): string | undefined {
        return this.auth.resolveUserLogin(ctx);
    }

    /** A shared hosted backend's home directory belongs to the operator, never to the signed-in user. */
    protected allowedOnThisBackend(res: Response): boolean {
        const perTenant = QAAP_BACKEND_ISOLATION_MODE === 'per-tenant' && isQaapTenantBackendMode();
        if (isQaapHostedProductionRuntime() && !perTenant) {
            res.status(403).json({ error: 'Importing sessions is only available with per-tenant backends' });
            return false;
        }
        return true;
    }
}

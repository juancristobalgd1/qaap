// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { QAAP_CLIENT_ERROR_API_PATH } from '../common/qaap-client-error-report';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';

/** Per-login reports accepted per rolling minute; beyond this they are silently dropped. */
const MAX_REPORTS_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_FIELD_LENGTH = 600;

/**
 * Receives client-side failure breadcrumbs so `docker compose logs theia` tells the WHOLE story.
 * An entire class of production bugs (hung pre-create submit stages, rejected creates, dead
 * cancel targets) happened before any request reached the backend — the server was blind and
 * diagnosis depended on asking the user what their screen said. Reports land in the backend log
 * as one-line `[qaap-client-error]` JSON entries correlated with the user login and build SHA.
 *
 * Abuse surface is bounded: authentication required (or local skip-auth), fields are truncated,
 * and reports are rate-limited per login.
 */
@injectable()
export class QaapClientErrorEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    protected readonly reportWindows = new Map<string, { windowStart: number; count: number }>();

    configure(app: Application): void {
        app.post(QAAP_CLIENT_ERROR_API_PATH, json({ limit: '8kb' }), (req, res) => this.handleReport(req, res));
    }

    protected handleReport(req: Request, res: Response): void {
        const ctx = this.auth.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const login = ctx.kind === 'authenticated' ? ctx.session.user.login : '_dev';
        // Always 204: reporting is best-effort and must never create client-side noise loops.
        res.status(204).end();
        if (!this.admitReport(login)) {
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const clip = (value: unknown): string | undefined =>
            typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_FIELD_LENGTH) : undefined;
        console.warn(`[qaap-client-error] ${JSON.stringify({
            at: new Date().toISOString(),
            login,
            context: clip(body.context) ?? 'unknown',
            message: clip(body.message) ?? '',
            build: clip(body.build),
            path: clip(body.path),
        })}`);
    }

    /** Sliding-window per-login admission; overflow is dropped silently. */
    protected admitReport(login: string): boolean {
        const now = Date.now();
        const window = this.reportWindows.get(login);
        if (!window || now - window.windowStart >= RATE_WINDOW_MS) {
            this.reportWindows.set(login, { windowStart: now, count: 1 });
            return true;
        }
        if (window.count >= MAX_REPORTS_PER_MINUTE) {
            return false;
        }
        window.count++;
        return true;
    }
}

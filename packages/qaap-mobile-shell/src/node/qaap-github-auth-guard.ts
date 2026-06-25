// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { Request, Response } from '@theia/core/shared/express';
import {
    QAAP_AUTH_SESSION_COOKIE,
    QAAP_AUTH_SESSION_HEADER,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    isPathUnderUserWorkspace,
    QAAP_SKIP_AUTH_USER_LOGIN,
    resolveQaapReposRoot,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapGithubSessionStore, type QaapGithubStoredSession } from './qaap-github-session-store';

export type QaapGithubAuthContext =
    | { readonly kind: 'authenticated'; readonly session: QaapGithubStoredSession; readonly sessionId: string; readonly userLogin: string }
    | { readonly kind: 'skip'; readonly userLogin: string }
    | { readonly kind: 'unauthorized' };

export type QaapSecurityEventAction =
    | 'list_repositories'
    | 'open_repository'
    | 'clone_repository'
    | 'create_repository'
    | 'merge_pull_request'
    | 'list_pull_requests'
    | 'project_session'
    | 'git_review'
    | 'agent_conversation'
    | 'agent_task'
    | 'workspace_path';

/** Shared GitHub session resolution and multi-tenant ownership checks for Qaap HTTP endpoints. */
@injectable()
export class QaapGithubAuthGuard {

    @inject(QaapGithubSessionStore)
    protected readonly sessions: QaapGithubSessionStore;

    protected readonly reposRoot = resolveQaapReposRoot();

    authenticate(req: Request): QaapGithubAuthContext {
        const session = this.resolveGithubSession(req);
        if (session) {
            return {
                kind: 'authenticated',
                session: session.stored,
                sessionId: session.sessionId,
                userLogin: session.stored.user.login,
            };
        }
        if (this.isSkipAuthEnabled()) {
            return { kind: 'skip', userLogin: QAAP_SKIP_AUTH_USER_LOGIN };
        }
        return { kind: 'unauthorized' };
    }

    resolveUserLogin(ctx: QaapGithubAuthContext): string | undefined {
        if (ctx.kind === 'authenticated' || ctx.kind === 'skip') {
            return ctx.userLogin;
        }
        return undefined;
    }

    userWorkspaceRoot(ctx: QaapGithubAuthContext): string | undefined {
        const login = this.resolveUserLogin(ctx);
        return login ? resolveUserReposRoot(this.reposRoot, login) : undefined;
    }

    ownsWorkspacePath(ctx: QaapGithubAuthContext, targetPath: string): boolean {
        if (ctx.kind === 'skip') {
            return true;
        }
        if (ctx.kind === 'unauthorized') {
            return false;
        }
        return isPathUnderUserWorkspace(targetPath, this.reposRoot, ctx.userLogin);
    }

    /**
     * Ownership check for a known login without an HTTP session context — used by trusted
     * server-to-server callers (e.g. the agent helper CLI authenticated by a per-user token).
     * An undefined/empty login (shared/anonymous bucket) is treated as unscoped and allowed.
     */
    loginOwnsWorkspacePath(userLogin: string | undefined, targetPath: string): boolean {
        if (!userLogin?.trim()) {
            return true;
        }
        return isPathUnderUserWorkspace(targetPath, this.reposRoot, userLogin);
    }

    /** Returns false and sends 403 when the path is outside the user's workspace tree. */
    assertWorkspacePathOwned(req: Request, res: Response, targetPath: string, action: QaapSecurityEventAction): boolean {
        const ctx = this.authenticate(req);
        if (ctx.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return false;
        }
        if (ctx.kind === 'skip') {
            return true;
        }
        if (!isPathUnderUserWorkspace(targetPath, this.reposRoot, ctx.userLogin)) {
            this.logSecurityEvent('ownership_denied', {
                action,
                userLogin: ctx.userLogin,
                targetPath,
            });
            res.status(403).json({ error: 'Forbidden' });
            return false;
        }
        return true;
    }

    /** Returns false and sends 403 without leaking resource details. */
    denyForbidden(res: Response, req: Request, action: QaapSecurityEventAction, detail?: Record<string, unknown>): false {
        const ctx = this.authenticate(req);
        this.logSecurityEvent('ownership_denied', {
            action,
            userLogin: ctx.kind === 'authenticated' ? ctx.userLogin : undefined,
            ...detail,
        });
        res.status(403).json({ error: 'Forbidden' });
        return false;
    }

    logSecurityEvent(event: string, detail: Record<string, unknown>): void {
        console.warn('[qaap-security]', JSON.stringify({
            event,
            at: new Date().toISOString(),
            ...detail,
        }));
    }

    isSkipAuthEnabled(): boolean {
        return process.env.QAAP_SKIP_AUTH === 'true' || process.env.QAAP_SKIP_AUTH === '1';
    }

    /** Returns a persisted GitHub OAuth session, ignoring stale cookie/header ids. */
    resolveGithubSession(req: Request): { stored: QaapGithubStoredSession; sessionId: string } | undefined {
        const sessionId = this.resolveSessionId(req);
        if (!sessionId) {
            return undefined;
        }
        const stored = this.sessions.getSession(sessionId);
        return stored ? { stored, sessionId } : undefined;
    }

    resolveSessionId(req: Request): string | undefined {
        const cookieId = this.readSessionIdFromCookie(req);
        if (cookieId && this.sessions.getSession(cookieId)) {
            return cookieId;
        }
        const headerId = this.readSessionIdFromHeader(req);
        if (headerId && this.sessions.getSession(headerId)) {
            return headerId;
        }
        return undefined;
    }

    protected readSessionIdFromCookie(req: Request): string | undefined {
        const cookieHeader = req.headers.cookie;
        if (!cookieHeader || typeof cookieHeader !== 'string') {
            return undefined;
        }
        for (const part of cookieHeader.split(';')) {
            const trimmed = part.trim();
            const eq = trimmed.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            const name = trimmed.slice(0, eq);
            if (name === QAAP_AUTH_SESSION_COOKIE) {
                const value = trimmed.slice(eq + 1);
                if (value) {
                    return decodeURIComponent(value);
                }
            }
        }
        return undefined;
    }

    protected readSessionIdFromHeader(req: Request): string | undefined {
        const sessionHeader = req.headers[QAAP_AUTH_SESSION_HEADER];
        if (typeof sessionHeader === 'string' && sessionHeader.length > 0) {
            return sessionHeader;
        }
        return undefined;
    }
}

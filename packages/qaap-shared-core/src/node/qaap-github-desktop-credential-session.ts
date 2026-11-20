// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { createHash } from 'crypto';
import { QaapAuthSessionUser } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { fetchGithubUser } from './qaap-github-api';
import { QaapGithubAuthContext } from './qaap-github-auth-guard';
import { QaapGithubMcpCredentialResolver, QaapGithubMcpCredentialSource } from './qaap-github-mcp-credential-resolver';
import { QaapGithubStoredSession } from './qaap-github-session-store';

/** A GitHub session made from the desktop credential chain; `source` says where the token came from. */
export interface QaapGithubDesktopCredentialStoredSession extends QaapGithubStoredSession {
    readonly source: QaapGithubMcpCredentialSource;
}

/** How long the `GET /user` answer for a token is reused. */
const USER_TTL_MS = 10 * 60 * 1000;
/** After a failed lookup, how long requests fall back to "sign in required" before trying again. */
const MISS_RETRY_MS = 30 * 1000;

/**
 * The Work Hub's GitHub data (repository list, pull requests) on the desktop app when Qaap has no GitHub
 * session: the token from {@link QaapGithubMcpCredentialResolver} (`GH_TOKEN`, `GITHUB_TOKEN`, `gh auth
 * token`, a stored OAuth session) and the login GitHub reports for it.
 *
 * Only a skip-auth request on the desktop runtime gets one; a tenant, hosted, local web or unstated backend
 * never reads the environment or `gh` here. The token stays in the backend: it is used for GitHub API calls
 * only, never logged, and {@link describe} returns the source and login without it.
 */
@injectable()
export class QaapGithubDesktopCredentialSession {

    @inject(QaapGithubMcpCredentialResolver)
    protected readonly resolver: QaapGithubMcpCredentialResolver;

    /** `GET /user` answers per token hash (never the token itself). */
    protected readonly users = new Map<string, { at: number; user: QaapAuthSessionUser }>();
    protected missAt: number | undefined;

    /** Whether this backend may use the desktop credential chain at all. */
    isEnabled(): boolean {
        return this.resolver.mode() === 'desktop';
    }

    /**
     * The session for `auth`, or `undefined`: always for an authenticated or unauthorized request, for any
     * backend that is not the desktop app, and when no credential (or no GitHub user for it) is available.
     */
    async resolve(auth: QaapGithubAuthContext, now: number = Date.now()): Promise<QaapGithubDesktopCredentialStoredSession | undefined> {
        if (auth.kind !== 'skip' || !this.isEnabled()) {
            return undefined;
        }
        if (this.missAt !== undefined && now - this.missAt < MISS_RETRY_MS) {
            return undefined;
        }
        const credential = await this.resolver.resolve().catch(() => undefined);
        if (!credential) {
            this.missAt = now;
            return undefined;
        }
        const user = await this.lookupUser(credential.token, now);
        if (!user) {
            this.resolver.invalidate();
            this.missAt = now;
            return undefined;
        }
        this.missAt = undefined;
        return { accessToken: credential.token, user, source: credential.source };
    }

    /** GitHub rejected the token: forget it, so the next request reads the current credential. */
    reportRejected(token: string): void {
        this.users.delete(QaapGithubDesktopCredentialSession.tokenKey(token));
        this.resolver.invalidate();
    }

    /** The source and GitHub login for `auth`, never the token. */
    async describe(auth: QaapGithubAuthContext): Promise<{ source: QaapGithubMcpCredentialSource; user: QaapAuthSessionUser } | undefined> {
        const session = await this.resolve(auth);
        return session ? { source: session.source, user: session.user } : undefined;
    }

    protected async lookupUser(token: string, now: number): Promise<QaapAuthSessionUser | undefined> {
        const key = QaapGithubDesktopCredentialSession.tokenKey(token);
        const cached = this.users.get(key);
        if (cached && now - cached.at < USER_TTL_MS) {
            return cached.user;
        }
        const user = await this.fetchUser(token).catch(() => undefined);
        if (!user?.login) {
            this.users.delete(key);
            return undefined;
        }
        this.users.set(key, { at: now, user });
        return user;
    }

    /** `GET /user`; a seam for tests. Errors carry no token. */
    protected fetchUser(token: string): Promise<QaapAuthSessionUser> {
        return fetchGithubUser(token);
    }

    protected static tokenKey(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }
}

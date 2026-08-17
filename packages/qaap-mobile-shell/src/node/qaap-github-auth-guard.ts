// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Request, Response } from '@theia/core/shared/express';
import {
    QAAP_AUTH_SESSION_COOKIE,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    isPathUnderUserWorkspace,
    isUserWorkspaceContainerPath,
    QAAP_SKIP_AUTH_USER_LOGIN,
    QAAP_USER_REPOS_SEGMENT,
    resolveQaapReposRoot,
    resolveRepositoryWorkspacePath,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { QaapGithubSessionStore, type QaapGithubStoredSession } from './qaap-github-session-store';
import { isRealPathUnder } from './qaap-realpath-guard';

/**
 * Outcome of normalizing a client-supplied agent `cwd` to the authenticated user's per-user
 * repository tree. `ok` carries the canonical `/workspace/repos/users/{login}/{owner}/{repo}` path
 * to actually run in; `needs-project` means the path is a workspace container (no single repo) and
 * the client must pick a project (HTTP 400); `denied` means the path could not be resolved to an
 * owned repository (HTTP 403).
 */
export type QaapResolvedRepositoryCwd =
    | { readonly kind: 'ok'; readonly cwd: string }
    | { readonly kind: 'needs-project' }
    | { readonly kind: 'denied' };

export type QaapGithubAuthContext =
    | { readonly kind: 'authenticated'; readonly session: QaapGithubStoredSession; readonly sessionId: string; readonly userLogin: string }
    | { readonly kind: 'skip'; readonly userLogin: string }
    | { readonly kind: 'unauthorized' };

export type QaapSecurityEventAction =
    | 'list_repositories'
    | 'open_repository'
    | 'clone_repository'
    | 'create_repository'
    | 'delete_repository'
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
        if (this.pathBelongsToUser(ctx.userLogin, targetPath)) {
            return true;
        }
        // A legacy/flat (`.../repos/{owner}/{repo}`) or bare-name cwd that maps to an existing clone
        // inside the caller's own per-user tree is still theirs — accept it so pre-migration
        // conversations/tasks remain visible and resumable.
        return this.resolveOwnedRepositoryCwdForLogin(ctx.userLogin, targetPath).kind === 'ok';
    }

    /**
     * Normalize a client-supplied agent `cwd` to the authenticated user's canonical per-user
     * repository path, so agent turns run under `/workspace/repos/users/{login}/{owner}/{repo}` even
     * when the client sends the container root (`/workspace`), a bare repo name (`laaaaa`), a legacy
     * flat path (`/workspace/repos/{owner}/{repo}`), or a `github:owner/repo` key.
     *
     * SECURITY: the destination is ALWAYS rebuilt from the authenticated `login` — a caller can only
     * ever influence the `{owner}/{repo}` tail, never the tenant segment. A path pointing at another
     * user's tree rebuilds under the caller's own root and is rejected when that clone does not exist.
     * The candidate must exist on disk as a directory and pass the symlink-safe ownership check.
     */
    resolveOwnedRepositoryCwd(ctx: QaapGithubAuthContext, rawCwd: string | undefined): QaapResolvedRepositoryCwd {
        if (ctx.kind === 'skip') {
            const trimmed = rawCwd?.trim();
            if (!trimmed) {
                return { kind: 'denied' };
            }
            // Skip-auth (local dev) leaves paths unmanaged, but a managed container must still be
            // refused: an agent turn there would ingest every repository at once.
            return isQaapWorkspaceContainerPath(trimmed) ? { kind: 'needs-project' } : { kind: 'ok', cwd: trimmed };
        }
        if (ctx.kind === 'unauthorized') {
            return { kind: 'denied' };
        }
        return this.resolveOwnedRepositoryCwdForLogin(ctx.userLogin, rawCwd);
    }

    /** Login-scoped core of {@link resolveOwnedRepositoryCwd}, usable by token-authenticated callers. */
    resolveOwnedRepositoryCwdForLogin(userLogin: string | undefined, rawCwd: string | undefined): QaapResolvedRepositoryCwd {
        const login = userLogin?.trim();
        const trimmed = rawCwd?.trim();
        if (!login || !trimmed) {
            return { kind: 'denied' };
        }
        // 1. Already a concrete owned repository path (not a container level) — keep as-is.
        if (isPathUnderUserWorkspace(trimmed, this.reposRoot, login)
            && !isUserWorkspaceContainerPath(trimmed, this.reposRoot, login)) {
            return this.acceptOwnedRepositoryCwd(login, trimmed);
        }
        // 2. Derive {owner, repo} from a `github:` key or a legacy/new repository path.
        const derived = this.deriveOwnerRepoFromCwd(trimmed);
        if (derived) {
            const candidate = resolveRepositoryWorkspacePath(this.reposRoot, login, derived.owner, derived.repo);
            return this.acceptOwnedRepositoryCwd(login, candidate);
        }
        // 3. Bare repo name (no separators) — accept only a unique match under the caller's own root.
        if (!trimmed.includes('/') && !trimmed.includes('\\')) {
            const match = this.findUniqueOwnedRepoByName(resolveUserReposRoot(this.reposRoot, login), trimmed);
            if (match === 'ambiguous') {
                return { kind: 'needs-project' };
            }
            return match ? this.acceptOwnedRepositoryCwd(login, match) : { kind: 'denied' };
        }
        // 4. A workspace container (`/workspace`, repos root, user root, owner dir) — no single repo.
        return { kind: 'needs-project' };
    }

    /** Extract `{owner, repo}` from a cwd, PRESERVING case (disk lookups are case-sensitive on Linux). */
    protected deriveOwnerRepoFromCwd(rawCwd: string): { owner: string; repo: string } | undefined {
        const schemeMatch = /^github:([^/]+)\/(.+)$/.exec(rawCwd);
        if (schemeMatch) {
            return { owner: schemeMatch[1], repo: schemeMatch[2] };
        }
        const segments = rawCwd.replace(/\\/g, '/').split('/').filter(Boolean);
        const reposIndex = segments.lastIndexOf('repos');
        if (reposIndex < 0) {
            return undefined;
        }
        const after = segments.slice(reposIndex + 1);
        if (after[0] === QAAP_USER_REPOS_SEGMENT) {
            return after.length >= 4 ? { owner: after[2], repo: after[3] } : undefined;
        }
        return after.length >= 2 ? { owner: after[0], repo: after[1] } : undefined;
    }

    /** Find a single `{userRoot}/{owner}/{repoName}` directory; `'ambiguous'` when more than one owner has it. */
    protected findUniqueOwnedRepoByName(userRoot: string, repoName: string): string | 'ambiguous' | undefined {
        let ownerDirs: string[];
        try {
            ownerDirs = fs.readdirSync(userRoot, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
        } catch {
            return undefined;
        }
        const matches: string[] = [];
        for (const owner of ownerDirs) {
            const candidate = path.join(userRoot, owner, repoName);
            try {
                if (fs.statSync(candidate).isDirectory()) {
                    matches.push(candidate);
                }
            } catch {
                /* not a directory */
            }
        }
        if (matches.length > 1) {
            return 'ambiguous';
        }
        return matches[0];
    }

    /** Accept a candidate only when it exists on disk and passes the lexical + realpath ownership check. */
    protected acceptOwnedRepositoryCwd(userLogin: string, candidate: string): QaapResolvedRepositoryCwd {
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(candidate).isDirectory();
        } catch {
            isDirectory = false;
        }
        if (!isDirectory) {
            return { kind: 'denied' };
        }
        if (!this.pathBelongsToUser(userLogin, candidate)) {
            return { kind: 'denied' };
        }
        return { kind: 'ok', cwd: path.resolve(candidate) };
    }

    /**
     * Ownership check combining the fast lexical prefix test with a symlink-safe realpath test.
     * The lexical check alone can be defeated by a symlink planted inside the user's own workspace
     * (e.g. `.../alice/link -> .../bob/secret`): the string still starts with alice's root, but the
     * real target is bob's tree. Requiring BOTH closes that cross-tenant escape.
     */
    protected pathBelongsToUser(userLogin: string, targetPath: string): boolean {
        if (!isPathUnderUserWorkspace(targetPath, this.reposRoot, userLogin)) {
            return false;
        }
        const userRoot = resolveUserReposRoot(this.reposRoot, userLogin);
        if (!isRealPathUnder(targetPath, userRoot)) {
            this.logSecurityEvent('symlink_escape_denied', { userLogin, targetPath });
            return false;
        }
        return true;
    }

    /**
     * True when `targetPath` is a container level of the authenticated user's
     * workspace tree (the per-user root or an owner directory) rather than an
     * actual repository. Agent work must target a repository: a container cwd
     * would feed every repo at once to the agent. Always false in skip-auth
     * (local dev) deployments, where paths are unmanaged.
     */
    isWorkspaceContainerPath(ctx: QaapGithubAuthContext, targetPath: string): boolean {
        if (ctx.kind !== 'authenticated') {
            return false;
        }
        return isUserWorkspaceContainerPath(targetPath, this.reposRoot, ctx.userLogin);
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
        return this.pathBelongsToUser(userLogin, targetPath);
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
        if (!this.pathBelongsToUser(ctx.userLogin, targetPath)) {
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

    protected skipAuthInProductionWarned = false;

    /**
     * Skip-auth (no login, everyone becomes the shared `_dev` bucket) is a LOCAL-DEV-ONLY switch.
     * Honoring it in a production runtime would disable all multi-tenant isolation, so it is refused
     * there regardless of the env var — fail safe (auth stays ON) with a loud one-time warning.
     * An explicit `QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION=true` is required to override (e.g. a private
     * single-user box behind a separate auth proxy).
     */
    isSkipAuthEnabled(): boolean {
        const requested = process.env.QAAP_SKIP_AUTH === 'true' || process.env.QAAP_SKIP_AUTH === '1';
        if (!requested) {
            return false;
        }
        if (this.isProductionRuntime() && !this.isSkipAuthProductionOverride()) {
            if (!this.skipAuthInProductionWarned) {
                this.skipAuthInProductionWarned = true;
                console.error('[qaap-security] REFUSING QAAP_SKIP_AUTH in a production runtime — authentication stays ON. '
                    + 'Skip-auth is local-dev only; set QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION=true only if you fully understand the risk.');
            }
            return false;
        }
        return true;
    }

    /** True when this looks like a hosted/production deployment rather than local dev. */
    protected isProductionRuntime(): boolean {
        const cloudMode = process.env.QAAP_CLOUD_MODE?.trim().toLowerCase();
        return process.env.NODE_ENV === 'production' || (!!cloudMode && cloudMode !== 'local');
    }

    protected isSkipAuthProductionOverride(): boolean {
        const value = process.env.QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION?.trim().toLowerCase();
        return value === 'true' || value === '1';
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
        // Cookie-only: the legacy x-qaap-session-id header fallback was removed (July 2026)
        // so a session id exfiltrated from an old localStorage copy is no longer usable.
        const cookieId = this.readSessionIdFromCookie(req);
        if (cookieId && this.sessions.getSession(cookieId)) {
            return cookieId;
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

}

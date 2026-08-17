// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    QAAP_AUTH_API_PATH,
    QAAP_AUTH_SESSION_COOKIE,
    QAAP_GITHUB_API_PATH,
    QAAP_GITHUB_OAUTH_CALLBACK_PATH,
    QAAP_GITHUB_OAUTH_START_PATH,
    type QaapGithubCreateRepositoryRequest,
    type QaapGithubMergePullRequestRequest,
    type QaapGithubOpenRepositoryRequest,
    type QaapGithubRepositorySummary,
    type QaapProjectSessionSummary,
    type QaapProjectSessionUpsertRequest,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    QAAP_ANONYMOUS_USER_LOGIN,
    isPathUnderUserWorkspace,
    parseGithubFullNameFromWorkspacePath,
    resolveQaapReposRoot,
    resolveRepositoryWorkspacePath,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    createGithubRepository,
    exchangeGithubCode,
    fetchGithubPullRequests,
    fetchGithubRepositories,
    fetchGithubRepository,
    fetchGithubUser,
    mergeGithubPullRequest,
} from './qaap-github-api';
import { seedEmptyRepository } from './qaap-github-seed-empty-repository';
import { readQaapGithubOAuthConfig } from './qaap-github-oauth-config';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubSessionStore } from './qaap-github-session-store';
import { QaapProjectSessionStore } from './qaap-project-session-store';
import { evaluateQaapProductionAuthReadiness } from './qaap-production-auth-readiness';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_OAUTH_SCOPE = 'read:user repo';
const THEIA_EMPTY_WINDOW_HASH = '!empty';

/** Placeholder user returned by `/auth/session` when `QAAP_SKIP_AUTH` is enabled. */
const SKIP_AUTH_DEV_USER = {
    provider: 'gitlab' as const,
    login: 'dev',
    name: 'Dev User',
};

@injectable()
export class QaapGithubOauthEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubSessionStore)
    protected readonly sessions: QaapGithubSessionStore;

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapProjectSessionStore)
    protected readonly projectSessions: QaapProjectSessionStore;

    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    configure(app: Application): void {
        app.use(json());
        app.get(QAAP_GITHUB_OAUTH_START_PATH, (req, res) => this.handleOAuthStart(req, res));
        app.get(QAAP_GITHUB_OAUTH_CALLBACK_PATH, (req, res) => this.handleOAuthCallback(req, res));
        app.get(`${QAAP_AUTH_API_PATH}/config`, (req, res) => this.handleAuthConfig(req, res));
        app.get(`${QAAP_AUTH_API_PATH}/session`, (req, res) => this.handleAuthSession(req, res));
        app.post(`${QAAP_AUTH_API_PATH}/signout`, (req, res) => this.handleSignOut(req, res));
        app.get(`${QAAP_GITHUB_API_PATH}/repositories`, (req, res) => this.handleGithubRepositories(req, res));
        app.post(`${QAAP_GITHUB_API_PATH}/repositories`, (req, res) => this.handleCreateGithubRepository(req, res));
        app.post(`${QAAP_GITHUB_API_PATH}/repositories/open`, (req, res) => this.handleCloneGithubRepository(req, res));
        // POST, not GET: opening clones/pulls to disk, and SameSite=Lax only shields non-GET
        // requests from cross-site initiation (a top-level GET navigation would send the cookie).
        app.post(`${QAAP_GITHUB_API_PATH}/repositories/:owner/:repo/open`, (req, res) => this.handleOpenGithubRepository(req, res));
        app.get(`${QAAP_GITHUB_API_PATH}/pull-requests`, (req, res) => this.handleGithubPullRequests(req, res));
        app.post(`${QAAP_GITHUB_API_PATH}/pull-requests/merge`, (req, res) => this.handleMergeGithubPullRequest(req, res));
        app.get(`${QAAP_GITHUB_API_PATH}/project-sessions`, (req, res) => this.handleProjectSessions(req, res));
        app.post(`${QAAP_GITHUB_API_PATH}/project-sessions`, (req, res) => this.handleUpsertProjectSession(req, res));
    }

    protected handleProjectSessions(req: Request, res: Response): void {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const login = this.auth.resolveUserLogin(auth);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        res.json({
            sessions: this.mergeOnDiskGithubSessions(login, this.projectSessions.listForUser(login))
                .map(session => this.enrichSessionWithWorkspaceUri(login, session)),
        });
    }

    /**
     * Attach the owner's on-disk clone path (as a `file:` URI) to a `github:` session when the
     * repository is actually cloned. Derived at read time from the session owner + repoKey — never
     * persisted, so it can neither go stale nor leak across users. Hub entries need it because on
     * hosted deployments the open workspace is the multi-repo container, which is unusable as a
     * project path; without this the client had to re-derive the path from its own conversations.
     */
    protected enrichSessionWithWorkspaceUri(
        login: string,
        session: QaapProjectSessionSummary,
    ): QaapProjectSessionSummary {
        if (session.workspaceUri || !session.repoKey.startsWith('github:')) {
            return session;
        }
        const [owner, name] = session.repoKey.slice('github:'.length).split('/');
        if (!owner || !name) {
            return session;
        }
        const target = resolveRepositoryWorkspacePath(this.reposRoot, login, owner, name);
        if (!existsSync(target)) {
            return session; // not cloned yet — the client's prepare/clone flow handles it
        }
        return { ...session, workspaceUri: FileUri.create(target).toString() };
    }

    /**
     * Skip-auth (`_dev`) and authenticated clones live on disk even when the in-memory session
     * store was never upserted (API clone, restarted process, empty skip-auth GET). Hub entries
     * need those paths or the developer cannot switch to a cloned repository.
     */
    protected listOnDiskGithubCloneSessions(login: string): QaapProjectSessionSummary[] {
        const userRoot = resolveUserReposRoot(this.reposRoot, login);
        if (!existsSync(userRoot)) {
            return [];
        }
        let owners: Array<{ readonly name: string; isDirectory(): boolean }>;
        try {
            owners = readdirSync(userRoot, { withFileTypes: true });
        } catch {
            return [];
        }
        const sessions: QaapProjectSessionSummary[] = [];
        for (const ownerEnt of owners) {
            if (!ownerEnt.isDirectory() || ownerEnt.name.startsWith('.')) {
                continue;
            }
            const ownerDir = path.join(userRoot, ownerEnt.name);
            let repos: Array<{ readonly name: string; isDirectory(): boolean }>;
            try {
                repos = readdirSync(ownerDir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const repoEnt of repos) {
                if (!repoEnt.isDirectory() || repoEnt.name.startsWith('.')) {
                    continue;
                }
                const target = path.join(ownerDir, repoEnt.name);
                if (!existsSync(path.join(target, '.git'))) {
                    continue;
                }
                sessions.push({
                    repoKey: `github:${ownerEnt.name}/${repoEnt.name}`,
                    branch: 'main',
                });
            }
        }
        return sessions;
    }

    protected mergeOnDiskGithubSessions(
        login: string,
        stored: readonly QaapProjectSessionSummary[],
    ): QaapProjectSessionSummary[] {
        const byKey = new Map(stored.map(session => [session.repoKey, session]));
        for (const disk of this.listOnDiskGithubCloneSessions(login)) {
            if (!byKey.has(disk.repoKey)) {
                byKey.set(disk.repoKey, disk);
            }
        }
        return [...byKey.values()];
    }

    protected rememberGithubCloneSession(
        userLogin: string,
        repository: Pick<QaapGithubRepositorySummary, 'owner' | 'name' | 'fullName' | 'defaultBranch'>,
    ): void {
        const fullName = repository.fullName?.trim() || `${repository.owner}/${repository.name}`;
        this.projectSessions.upsertForUser(userLogin, {
            repoKey: `github:${fullName}`,
            branch: repository.defaultBranch,
        });
    }

    protected handleUpsertProjectSession(req: Request, res: Response): void {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const login = this.auth.resolveUserLogin(auth);
        if (!login) {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapProjectSessionUpsertRequest>;
        if (!body.repoKey || typeof body.repoKey !== 'string') {
            res.status(400).json({ error: 'repoKey is required' });
            return;
        }
        const session = this.projectSessions.upsertForUser(login, {
            repoKey: body.repoKey,
            branch: body.branch,
            tokens: body.tokens,
            cost: body.cost,
            agentState: body.agentState,
            lastTask: body.lastTask,
            previewUrl: body.previewUrl,
            bootstrapPhase: body.bootstrapPhase,
        });
        res.json({ session });
    }

    protected handleOAuthStart(_req: Request, res: Response): void {
        const config = readQaapGithubOAuthConfig();
        if (!config) {
            res.status(503).send('GitHub OAuth is not configured (QAAP_GITHUB_CLIENT_ID, QAAP_GITHUB_CLIENT_SECRET, QAAP_OAUTH_PUBLIC_URL).');
            return;
        }
        const state = this.sessions.createOAuthState();
        const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
        authorizeUrl.searchParams.set('client_id', config.clientId);
        authorizeUrl.searchParams.set('redirect_uri', config.callbackUrl);
        authorizeUrl.searchParams.set('scope', GITHUB_OAUTH_SCOPE);
        authorizeUrl.searchParams.set('state', state);
        res.redirect(302, authorizeUrl.toString());
    }

    protected async handleOAuthCallback(req: Request, res: Response): Promise<void> {
        const config = readQaapGithubOAuthConfig();
        if (!config) {
            res.status(503).send('GitHub OAuth is not configured.');
            return;
        }
        const error = typeof req.query.error === 'string' ? req.query.error : undefined;
        const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
        if (error) {
            console.error('[qaap-oauth] GitHub returned error on callback:', error, errorDescription ?? '');
            this.redirectAfterOAuth(res, config.publicUrl, false, errorDescription || error);
            return;
        }
        const code = typeof req.query.code === 'string' ? req.query.code : undefined;
        const state = typeof req.query.state === 'string' ? req.query.state : undefined;
        if (!code) {
            console.error('[qaap-oauth] Callback missing "code" query parameter');
            this.redirectAfterOAuth(res, config.publicUrl, false, 'missing_code');
            return;
        }
        if (!this.sessions.consumeOAuthState(state)) {
            console.error('[qaap-oauth] OAuth state is unknown or expired (backend likely restarted between /start and /callback). state=', state);
            this.redirectAfterOAuth(res, config.publicUrl, false, 'state_lost');
            return;
        }
        try {
            const accessToken = await exchangeGithubCode(config, code);
            const user = await fetchGithubUser(accessToken);
            const previousSessionId = this.auth.resolveSessionId(req);
            if (previousSessionId) {
                this.sessions.deleteSession(previousSessionId);
            }
            const sessionId = this.sessions.createSession({ accessToken, user });
            this.setSessionCookie(res, sessionId);
            console.info('[qaap-oauth] GitHub sign-in OK for user', user.login);
            this.redirectAfterOAuth(res, config.publicUrl, true);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[qaap-oauth] Token exchange or user fetch failed:', message);
            this.redirectAfterOAuth(res, config.publicUrl, false, message);
        }
    }

    protected handleAuthConfig(_req: Request, res: Response): void {
        const build = process.env.QAAP_BUILD_SHA?.trim();
        const readiness = evaluateQaapProductionAuthReadiness();
        res.json({
            githubOAuth: readiness.oauthConfigured,
            skipAuth: this.auth.isSkipAuthEnabled(),
            productionRuntime: readiness.productionRuntime,
            oauthConfigured: readiness.oauthConfigured,
            agentUidPerUser: readiness.agentUidPerUser,
            ...(process.env.QAAP_AGENT_UID?.trim() ? { agentUid: process.env.QAAP_AGENT_UID.trim() } : {}),
            // Deployed-build identity (short git SHA, baked into the image at build time).
            // Public by design: the repo is public, and this is the one signal that ends
            // "which build am I actually on?" during deploys — the post-deploy gate asserts
            // it matches the pushed commit.
            ...(build ? { build } : {}),
        });
    }

    protected handleAuthSession(req: Request, res: Response): void {
        const stored = this.auth.resolveGithubSession(req);
        if (stored) {
            // Never include the session id: the HttpOnly cookie is the only credential,
            // and echoing the id here would hand it to any XSS.
            res.json({
                signedIn: true,
                user: stored.stored.user,
            });
            return;
        }
        if (this.auth.isSkipAuthEnabled()) {
            res.json({ signedIn: true, user: SKIP_AUTH_DEV_USER });
            return;
        }
        res.json({ signedIn: false });
    }

    protected handleSignOut(req: Request, res: Response): void {
        this.sessions.deleteSession(this.auth.resolveSessionId(req));
        this.clearSessionCookie(res);
        res.json({ ok: true });
    }

    protected async handleGithubRepositories(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        if (auth.kind === 'skip') {
            res.json({ repositories: [] });
            return;
        }
        const stored = auth.session;
        try {
            const repositories = await fetchGithubRepositories(stored.accessToken);
            res.json({ repositories });
        } catch (err) {
            // A GitHub 401 means the stored token was revoked/expired. Return 401 (not a generic 502)
            // so the client clears its stale session and re-authenticates, instead of getting stuck
            // on "could not load repositories" with a still-signed-in UI. (ONB-5)
            if ((err as { status?: number }).status === 401) {
                res.status(401).json({ error: 'GitHub session expired', signedIn: false });
                return;
            }
            const message = err instanceof Error ? err.message : 'Failed to load repositories';
            res.status(502).json({ error: message });
        }
    }

    protected async handleGithubPullRequests(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in', signedIn: false, pullRequests: [] });
            return;
        }
        if (auth.kind === 'skip') {
            res.json({ pullRequests: [], signedIn: false });
            return;
        }
        const stored = auth.session;
        try {
            const hubRepositories = await this.filterAccessibleRepositories(
                stored.accessToken,
                this.parseGithubReposQuery(req.query.repos),
            );
            const repository = hubRepositories.length > 0
                ? undefined
                : await this.getCurrentWorkspaceRepository(stored.accessToken, auth.userLogin);
            const scanTargets = hubRepositories.length > 0
                ? hubRepositories
                : (repository ? [repository] : []);
            const pullRequests = scanTargets.length > 0
                ? await fetchGithubPullRequests(stored.accessToken, scanTargets)
                : [];
            res.json({ pullRequests, currentRepository: repository, signedIn: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load pull requests';
            res.status(502).json({ error: message, signedIn: true, pullRequests: [] });
        }
    }

    /** `repos=owner/name,owner2/name2` — Work Hub inbox scans multiple GitHub repositories. */
    protected parseGithubReposQuery(raw: unknown): QaapGithubRepositorySummary[] {
        if (typeof raw !== 'string' || !raw.trim()) {
            return [];
        }
        const now = new Date().toISOString();
        const repositories: QaapGithubRepositorySummary[] = [];
        for (const entry of raw.split(',')) {
            const trimmed = entry.trim();
            if (!trimmed) {
                continue;
            }
            const slash = trimmed.indexOf('/');
            if (slash <= 0 || slash >= trimmed.length - 1) {
                continue;
            }
            const owner = trimmed.slice(0, slash);
            const name = trimmed.slice(slash + 1);
            const fullName = `${owner}/${name}`;
            repositories.push({
                id: 0,
                fullName,
                owner,
                name,
                cloneUrl: `https://github.com/${fullName}.git`,
                htmlUrl: `https://github.com/${fullName}`,
                defaultBranch: 'main',
                private: false,
                updatedAt: now,
            });
        }
        return repositories;
    }

    protected async handleMergeGithubPullRequest(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        if (auth.kind === 'skip') {
            res.status(503).json({ error: 'GitHub sign-in required' });
            return;
        }
        const stored = auth.session;
        const body = (req.body ?? {}) as Partial<QaapGithubMergePullRequestRequest>;
        const owner = this.cleanGithubPathSegment(body.owner);
        const repo = this.cleanGithubPathSegment(body.repo);
        const number = typeof body.number === 'number' ? body.number : Number(body.number);
        if (!owner || !repo || !Number.isInteger(number) || number <= 0) {
            res.status(400).json({ error: 'Invalid pull request' });
            return;
        }
        try {
            const repository = await this.getCurrentWorkspaceRepository(stored.accessToken, auth.userLogin);
            if (!repository) {
                res.status(409).json({ error: 'Open a GitHub repository workspace before merging a pull request' });
                return;
            }
            if (
                repository.owner.toLowerCase() !== owner.toLowerCase()
                || repository.name.toLowerCase() !== repo.toLowerCase()
            ) {
                res.status(403).json({ error: 'Pull request does not belong to the open QAAP workspace repository' });
                return;
            }
            const result = await mergeGithubPullRequest(stored.accessToken, { owner, repo, number });
            res.json(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to merge pull request';
            res.status(502).json({ error: message });
        }
    }

    protected async handleOpenGithubRepository(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        if (auth.kind === 'skip') {
            res.status(503).json({ error: 'GitHub sign-in required' });
            return;
        }
        const stored = auth.session;
        const owner = this.cleanGithubPathSegment(req.params.owner);
        const repoName = this.cleanGithubPathSegment(req.params.repo);
        if (!owner || !repoName) {
            res.status(400).json({ error: 'Invalid repository path' });
            return;
        }
        try {
            const repository = await this.resolveAccessibleRepository(stored.accessToken, owner, repoName);
            if (!repository) {
                this.auth.logSecurityEvent('ownership_denied', {
                    action: 'open_repository',
                    userLogin: stored.user.login,
                    owner,
                    repo: repoName,
                });
                res.status(403).json({ error: 'Forbidden' });
                return;
            }
            const workspacePath = await this.ensureRepositoryWorkspace(repository, stored.accessToken, auth.userLogin);
            this.rememberGithubCloneSession(auth.userLogin, repository);
            res.json({
                repository,
                workspaceUri: FileUri.create(workspacePath).toString(),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to prepare repository workspace';
            res.status(502).json({ error: message });
        }
    }

    protected async handleCreateGithubRepository(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        if (auth.kind === 'skip') {
            res.status(503).json({ error: 'GitHub sign-in required' });
            return;
        }
        const stored = auth.session;
        const body = (req.body ?? {}) as Partial<QaapGithubCreateRepositoryRequest>;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!this.isValidRepositoryName(name)) {
            res.status(400).json({ error: 'Invalid repository name' });
            return;
        }
        try {
            const repository = await createGithubRepository(stored.accessToken, {
                name,
                private: body.private ?? true,
                description: typeof body.description === 'string' ? body.description.trim() : undefined,
            });
            const workspacePath = await this.ensureRepositoryWorkspace(repository, stored.accessToken, auth.userLogin);
            this.rememberGithubCloneSession(auth.userLogin, repository);
            res.json({
                repository,
                workspaceUri: FileUri.create(workspacePath).toString(),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create GitHub repository';
            res.status(502).json({ error: message });
        }
    }

    protected async handleCloneGithubRepository(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        const body = (req.body ?? {}) as Partial<QaapGithubOpenRepositoryRequest>;
        const parsed = this.parseGithubRepositoryInput(typeof body.repository === 'string' ? body.repository : '');
        if (!parsed) {
            res.status(400).json({ error: 'Enter a GitHub repository as owner/name or URL' });
            return;
        }
        try {
            let repository: QaapGithubRepositorySummary;
            let accessToken: string | undefined;
            let userLogin: string;
            if (auth.kind === 'authenticated') {
                accessToken = auth.session.accessToken;
                userLogin = auth.userLogin;
                const accessible = await this.resolveAccessibleRepository(accessToken, parsed.owner, parsed.name);
                if (!accessible) {
                    this.auth.logSecurityEvent('ownership_denied', {
                        action: 'clone_repository',
                        userLogin,
                        owner: parsed.owner,
                        repo: parsed.name,
                    });
                    res.status(403).json({ error: 'Forbidden' });
                    return;
                }
                repository = accessible;
            } else if (auth.kind === 'skip') {
                userLogin = auth.userLogin;
                repository = await fetchGithubRepository(undefined, parsed.owner, parsed.name);
            } else {
                repository = await fetchGithubRepository(undefined, parsed.owner, parsed.name);
                if (repository.private) {
                    res.status(401).json({ error: 'Sign in with GitHub to clone private repositories' });
                    return;
                }
                userLogin = QAAP_ANONYMOUS_USER_LOGIN;
            }
            const workspacePath = await this.ensureRepositoryWorkspace(repository, accessToken, userLogin);
            this.rememberGithubCloneSession(userLogin, repository);
            res.json({
                repository,
                workspaceUri: FileUri.create(workspacePath).toString(),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to clone GitHub repository';
            res.status(502).json({ error: message });
        }
    }

    protected cleanGithubPathSegment(value: string | undefined): string | undefined {
        const decoded = typeof value === 'string' ? decodeURIComponent(value).trim() : '';
        if (!/^[A-Za-z0-9_.-]+$/.test(decoded)) {
            return undefined;
        }
        return decoded;
    }

    protected isValidRepositoryName(value: string): boolean {
        return /^[A-Za-z0-9_.-]+$/.test(value) && !value.startsWith('.') && value.length <= 100;
    }

    protected parseGithubRepositoryInput(value: string): { owner: string; name: string } | undefined {
        const trimmed = value.trim().replace(/\.git$/, '');
        if (!trimmed) {
            return undefined;
        }
        const sshMatch = /^git@github\.com:([^/]+)\/(.+)$/i.exec(trimmed);
        if (sshMatch) {
            return this.parseGithubRepositoryInput(`${sshMatch[1]}/${sshMatch[2]}`);
        }
        let candidate = trimmed;
        try {
            const url = new URL(trimmed);
            if (url.hostname.toLowerCase() !== 'github.com') {
                return undefined;
            }
            candidate = url.pathname.replace(/^\/+/, '');
        } catch {
            /* owner/name input */
        }
        const [owner, name, ...rest] = candidate.split('/').filter(Boolean);
        if (rest.length > 0) {
            return undefined;
        }
        const cleanOwner = this.cleanGithubPathSegment(owner);
        const cleanName = this.cleanGithubPathSegment(name);
        if (!cleanOwner || !cleanName) {
            return undefined;
        }
        return { owner: cleanOwner, name: cleanName };
    }

    protected readonly reposRoot = resolveQaapReposRoot();

    protected async getCurrentWorkspaceRepository(
        accessToken: string,
        userLogin: string,
    ): Promise<QaapGithubRepositorySummary | undefined> {
        const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        if (!workspaceUri) {
            return undefined;
        }
        const workspacePath = FileUri.fsPath(workspaceUri);
        if (!isPathUnderUserWorkspace(workspacePath, this.reposRoot, userLogin)) {
            return undefined;
        }
        const parsedFullName = parseGithubFullNameFromWorkspacePath(workspacePath);
        if (parsedFullName) {
            const [owner, name] = parsedFullName.split('/');
            return this.resolveAccessibleRepository(accessToken, owner, name);
        }
        const gitRoot = await this.findGitRoot(workspacePath);
        if (!gitRoot) {
            return undefined;
        }
        const remoteUrl = await this.runGitOutput(['-C', gitRoot, 'remote', 'get-url', 'origin']).catch(() => undefined);
        const parsed = remoteUrl ? this.parseGithubRepositoryInput(remoteUrl) : undefined;
        if (!parsed) {
            return undefined;
        }
        return this.resolveAccessibleRepository(accessToken, parsed.owner, parsed.name);
    }

    protected async resolveAccessibleRepository(
        accessToken: string,
        owner: string,
        name: string,
    ): Promise<QaapGithubRepositorySummary | undefined> {
        const repositories = await fetchGithubRepositories(accessToken);
        return repositories.find(repo =>
            repo.owner.toLowerCase() === owner.toLowerCase()
            && repo.name.toLowerCase() === name.toLowerCase()
        );
    }

    protected async filterAccessibleRepositories(
        accessToken: string,
        candidates: QaapGithubRepositorySummary[],
    ): Promise<QaapGithubRepositorySummary[]> {
        if (candidates.length === 0) {
            return [];
        }
        const accessible = await fetchGithubRepositories(accessToken);
        const allowed = new Set(accessible.map(repo => repo.fullName.toLowerCase()));
        return candidates.filter(repo => allowed.has(repo.fullName.toLowerCase()));
    }

    protected async findGitRoot(workspacePath: string): Promise<string | undefined> {
        let candidate = workspacePath;
        try {
            const stat = await fs.stat(candidate);
            if (stat.isFile()) {
                candidate = path.dirname(candidate);
            }
        } catch {
            return undefined;
        }
        const output = await this.runGitOutput(['-C', candidate, 'rev-parse', '--show-toplevel']).catch(() => undefined);
        return output?.trim() || undefined;
    }

    protected async ensureRepositoryWorkspace(
        repository: Pick<QaapGithubRepositorySummary, 'owner' | 'name' | 'cloneUrl'>,
        accessToken: string | undefined,
        userLogin: string,
    ): Promise<string> {
        const target = resolveRepositoryWorkspacePath(this.reposRoot, userLogin, repository.owner, repository.name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (await this.isGitRepository(target)) {
            // SEC-1/C-3: `fetch` updates refs + downloads objects with NO checkout and NO filters, so it
            // is safe to run as the backend uid (root in prod). The former `pull --ff-only` here CHECKED
            // OUT into the tenant-writable repo as root — that runs a tenant-defined clean/smudge FILTER
            // (from the repo's own .git/config) as ROOT, i.e. a root-RCE. We deliberately do NOT check
            // out in the open flow: the working tree fast-forwards on the tenant's next git operation
            // (agent / terminal), which runs UNDER THE TENANT UID and is therefore safe. See SECURITY.md.
            await this.runGit(['-C', target, 'fetch', '--all', '--prune'], accessToken);
            return target;
        }
        if (await this.pathExists(target)) {
            const entries = await fs.readdir(target);
            if (entries.length > 0) {
                throw new Error(`Workspace path already exists and is not a Git repository: ${target}`);
            }
        }
        await this.runGit(['clone', repository.cloneUrl, target], accessToken);
        try {
            await seedEmptyRepository(target, repository.name, args => this.runGit(args, accessToken));
        } catch (err) {
            console.warn('[qaap-oauth] Failed to seed empty repository; workspace will rely on static detection:', err instanceof Error ? err.message : String(err));
        }
        return target;
    }

    protected safePathSegment(value: string): string {
        return value.replace(/[^A-Za-z0-9_.-]/g, '_');
    }

    protected async isGitRepository(target: string): Promise<boolean> {
        try {
            const stat = await fs.stat(path.join(target, '.git'));
            return stat.isDirectory() || stat.isFile();
        } catch {
            return false;
        }
    }

    protected async pathExists(target: string): Promise<boolean> {
        try {
            await fs.access(target);
            return true;
        } catch {
            return false;
        }
    }

    protected runGit(args: string[], accessToken: string | undefined): Promise<void> {
        // SEC-1/C-3 hardening: these clone/fetch/pull run as the backend uid (root in prod) over a repo
        // the tenant controls. `core.hooksPath=/dev/null` disables ALL git hooks so a `.git/hooks/*`
        // planted by the tenant cannot execute as root when `pull` fast-forwards. (Residual: a
        // tenant-defined clean/smudge FILTER in `.git/config` can still run during a `pull` checkout —
        // the complete fix is to run these under the tenant uid, which is blocked here by a package
        // dependency cycle to QaapTenantSpawnService; tracked for the staging pass. See SECURITY.md.)
        const hardening = ['-c', 'core.hooksPath=/dev/null'];
        const gitArgs = accessToken
            ? [
                ...hardening,
                '-c',
                `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${accessToken}`).toString('base64')
                }`,
                ...args,
            ]
            : [...hardening, ...args];
        return new Promise((resolve, reject) => {
            const child = spawn('git', gitArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', chunk => {
                stderr += String(chunk);
            });
            child.on('error', reject);
            child.on('close', code => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || `git exited with status ${code}`));
                }
            });
        });
    }

    protected runGitOutput(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => {
                stdout += String(chunk);
            });
            child.stderr.on('data', chunk => {
                stderr += String(chunk);
            });
            child.on('error', reject);
            child.on('close', code => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(stderr.trim() || `git exited with status ${code}`));
                }
            });
        });
    }

    protected redirectAfterOAuth(res: Response, publicUrl: string, success: boolean, reason?: string): void {
        const target = new URL(publicUrl + '/');
        if (success) {
            target.searchParams.set('qaap_oauth', 'github');
        } else {
            target.searchParams.set('qaap_oauth_error', '1');
            if (reason) {
                target.searchParams.set('qaap_oauth_reason', reason.slice(0, 200));
            }
        }
        // Theia restores the most recent workspace when there is no hash. Use
        // the explicit empty-window hash to avoid reopening a stale workspace.
        res.redirect(302, `${target.toString()}#${THEIA_EMPTY_WINDOW_HASH}`);
    }

    protected sessionCookieFlags(): string {
        const config = readQaapGithubOAuthConfig();
        const secure = config?.publicUrl.startsWith('https://') ? '; Secure' : '';
        return `Path=/; HttpOnly; SameSite=Lax${secure}`;
    }

    protected setSessionCookie(res: Response, sessionId: string): void {
        const maxAge = 30 * 24 * 60 * 60;
        res.setHeader(
            'Set-Cookie',
            `${QAAP_AUTH_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ${this.sessionCookieFlags()}; Max-Age=${maxAge}`
        );
    }

    protected clearSessionCookie(res: Response): void {
        res.setHeader(
            'Set-Cookie',
            `${QAAP_AUTH_SESSION_COOKIE}=; ${this.sessionCookieFlags()}; Max-Age=0`
        );
    }
}

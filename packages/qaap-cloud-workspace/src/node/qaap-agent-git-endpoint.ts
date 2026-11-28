// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { json } from 'body-parser';
import { QAAP_TENANT_LOGIN_ENV, isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { createGithubPullRequest, fetchGithubRepository } from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import { QaapGithubOwnerTokenCache } from '@theia/qaap-shared-core/lib/node/qaap-github-owner-token-cache';
import { QaapGithubSessionStore } from '@theia/qaap-shared-core/lib/node/qaap-github-session-store';
import { QaapHostedGitPush } from '@theia/qaap-shared-core/lib/node/qaap-hosted-git-push';
import { QaapHostedProjectResolver, type QaapHostedProject, type QaapHostedProjectGit } from '@theia/qaap-shared-core/lib/node/qaap-hosted-project-resolver';
import {
    QAAP_AGENT_GIT_API_PATH,
    QAAP_AGENT_GIT_ROUTES,
    QAAP_AGENT_GIT_TOKEN_HEADER,
    isProtectedDefaultBranch,
    isQaapAgentGitCliEnabled,
    parseQaapAgentGitPrRequest,
    type QaapAgentGitPrResponse,
    type QaapAgentGitPushResponse,
} from '../common/qaap-agent-git-protocol';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const BODY_LIMIT = '128kb';
const LOCAL_GIT_TIMEOUT_MS = 15_000;

export interface QaapAgentGitCaller {
    readonly taskId: string;
    readonly conversationId?: string;
    readonly ownerLogin: string;
    readonly cwd: string;
}

class QaapAgentGitError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

/**
 * Sealed backend endpoint for the `qaaq-git` agent CLI (`POST /qaap/api/agent-git/push` and
 * `POST /qaap/api/agent-git/pr`).
 *
 * Security boundary (doc/qaap-github-token-boundary.md):
 * - Agents present a per-task `git`-scoped token (0600 file), never a GitHub token.
 * - Repository destination is resolved strictly from backend state (`QaapHostedProjectResolver`),
 *   never from agent-writable `.git/config` or request parameters.
 * - Pushes refuse detached HEAD, `main`, `master`, or the repository's default branch, and never
 *   force-push (`force: false`).
 * - Read-only (`plan`) turns and one-shot calls are refused.
 */
@injectable()
export class QaapAgentGitEndpoint implements BackendApplicationContribution {

    @inject(QaapToolGateTokenService)
    protected readonly tokens: QaapToolGateTokenService;

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapHostedGitPush) @optional()
    protected readonly hostedPush: QaapHostedGitPush | undefined;

    @inject(QaapHostedProjectResolver) @optional()
    protected readonly projectResolver: QaapHostedProjectResolver | undefined;

    @inject(QaapGithubSessionStore) @optional()
    protected readonly sessions: QaapGithubSessionStore | undefined;

    @inject(QaapGithubOwnerTokenCache) @optional()
    protected readonly ownerTokens: QaapGithubOwnerTokenCache | undefined;

    configure(app: Application): void {
        app.post(`${QAAP_AGENT_GIT_API_PATH}${QAAP_AGENT_GIT_ROUTES.push}`, json({ limit: BODY_LIMIT }), (req, res) => {
            void this.handlePush(req, res).catch(error => this.sendError(res, error));
        });
        app.post(`${QAAP_AGENT_GIT_API_PATH}${QAAP_AGENT_GIT_ROUTES.pr}`, json({ limit: BODY_LIMIT }), (req, res) => {
            void this.handlePr(req, res).catch(error => this.sendError(res, error));
        });
    }

    protected async handlePush(req: Request, res: Response): Promise<void> {
        const caller = this.authenticateAgent(req);
        const { token, project, branch, sha, url } = await this.preparePush(caller);
        await this.executeSealedPush(caller, project, branch, sha, url, token);
        const payload: QaapAgentGitPushResponse = {
            ok: true,
            owner: project.owner,
            repo: project.repo,
            branch,
            sha,
            remoteUrl: url,
            pushedTo: `${project.owner}/${project.repo}@${branch}`,
        };
        res.json(payload);
    }

    protected async handlePr(req: Request, res: Response): Promise<void> {
        const caller = this.authenticateAgent(req);
        const parsed = parseQaapAgentGitPrRequest(req.body);
        if (!parsed.ok) {
            throw new QaapAgentGitError(400, parsed.message);
        }
        const { token, project, branch, sha, url, defaultBranch } = await this.preparePush(caller);
        const base = parsed.value.base ?? defaultBranch;
        if (!base) {
            throw new QaapAgentGitError(400, 'Could not determine the repository default branch. Pass --base <branch>.');
        }
        if (base.toLowerCase() === branch.toLowerCase()) {
            throw new QaapAgentGitError(400, `Cannot open a pull request from "${branch}" into itself.`);
        }
        if (parsed.value.push) {
            await this.executeSealedPush(caller, project, branch, sha, url, token);
        }
        let pr;
        try {
            pr = await this.createPullRequest(token, {
                owner: project.owner,
                repo: project.repo,
                title: parsed.value.title,
                head: branch,
                base,
                body: parsed.value.body,
                draft: parsed.value.draft,
            });
        } catch (error) {
            throw this.mapGithubError(caller.ownerLogin, error, 'Failed to create GitHub pull request');
        }
        if (caller.conversationId) {
            this.store.update(caller.conversationId, {
                linkedPullRequest: {
                    owner: project.owner,
                    repo: project.repo,
                    number: pr.number,
                    branch,
                    title: parsed.value.title,
                    state: 'open',
                    draft: pr.draft,
                },
            });
        }
        const payload: QaapAgentGitPrResponse = {
            ok: true,
            owner: project.owner,
            repo: project.repo,
            branch,
            base,
            number: pr.number,
            url: pr.url,
            title: parsed.value.title,
            draft: pr.draft,
        };
        res.json(payload);
    }

    protected authenticateAgent(req: Request): QaapAgentGitCaller {
        const env = this.env();
        if (!isQaapAgentGitCliEnabled(env)) {
            throw new QaapAgentGitError(404, 'Agent git helper is disabled on this server.');
        }
        let ownerCheck: { readonly expectedOwner: string | undefined } | undefined;
        if (isQaapTenantBackendMode(env)) {
            const tenantLogin = env[QAAP_TENANT_LOGIN_ENV]?.trim();
            if (!tenantLogin) {
                throw new QaapAgentGitError(403, 'This tenant backend does not know its tenant.');
            }
            ownerCheck = { expectedOwner: tenantLogin };
        }
        const auth = this.tokens.authorize(req.header(QAAP_AGENT_GIT_TOKEN_HEADER), 'git', ownerCheck);
        if (!auth.ok) {
            throw auth.reason === 'invalid'
                ? new QaapAgentGitError(401, 'Invalid or expired agent git token.')
                : new QaapAgentGitError(403, auth.reason === 'scope' ? 'This task does not have git push permission.' : 'Token belongs to another tenant.');
        }
        if (auth.grant.oneShot || !auth.grant.owner) {
            throw new QaapAgentGitError(403, 'Git push and PR creation require a signed-in user task.');
        }
        const task = this.store.findTaskById(auth.grant.taskId);
        if (!task) {
            throw new QaapAgentGitError(403, 'Git token is not attached to an active task.');
        }
        if (task.readOnlyWorkspace === true) {
            throw new QaapAgentGitError(403, 'Read-only (plan) turns cannot push branches or create pull requests.');
        }
        const turn = this.store.taskToConversation.get(auth.grant.taskId);
        return {
            taskId: auth.grant.taskId,
            conversationId: turn?.conversationId,
            ownerLogin: auth.grant.owner,
            cwd: task.cwd,
        };
    }

    protected async preparePush(caller: QaapAgentGitCaller): Promise<{
        readonly token: string;
        readonly project: QaapHostedProject;
        readonly branch: string;
        readonly sha: string;
        readonly url: string;
        readonly defaultBranch: string | undefined;
    }> {
        if (!this.hostedPush || !this.projectResolver) {
            throw new QaapAgentGitError(503, 'Sealed GitHub push is not configured on this server.');
        }
        const token = this.resolveOwnerToken(caller.ownerLogin);
        if (!token) {
            throw new QaapAgentGitError(401, 'GitHub sign-in required. Sign in with GitHub in Qaap to push branches or open pull requests.');
        }
        const git: QaapHostedProjectGit = (cwd, args) => this.runReadOnlyGit(cwd, args);
        const project = await this.projectResolver.resolve(caller.ownerLogin, caller.cwd, git);
        if (!project) {
            throw new QaapAgentGitError(403, 'Sealed push only targets the project\'s own GitHub repository clone or worktree.');
        }
        let branch: string;
        let sha: string;
        try {
            branch = (await this.runReadOnlyGit(caller.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
            sha = (await this.runReadOnlyGit(caller.cwd, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
        } catch {
            throw new QaapAgentGitError(400, 'Could not read current git branch or commit. Make a commit on a feature branch first.');
        }
        if (isProtectedDefaultBranch(branch)) {
            throw new QaapAgentGitError(400, `Direct push to "${branch}" is refused. Create and switch to a feature branch first.`);
        }
        let defaultBranch: string | undefined;
        try {
            const repoMeta = await this.fetchRepositoryMeta(token, project.owner, project.repo);
            defaultBranch = repoMeta.defaultBranch;
        } catch (error) {
            if ((error as { status?: number }).status === 401) {
                throw this.mapGithubError(caller.ownerLogin, error, 'GitHub sign-in required');
            }
            // Non-401 metadata errors fall back to the built-in main/master guard for push.
        }
        if (isProtectedDefaultBranch(branch, defaultBranch)) {
            throw new QaapAgentGitError(400, `Direct push to default branch "${branch}" is refused. Create and switch to a feature branch first.`);
        }
        const url = `https://github.com/${project.owner}/${project.repo}.git`;
        return { token, project, branch, sha, url, defaultBranch };
    }

    protected async executeSealedPush(
        caller: QaapAgentGitCaller,
        project: QaapHostedProject,
        branch: string,
        sha: string,
        url: string,
        token: string,
    ): Promise<void> {
        try {
            await this.hostedPush!.push({
                objectsDirectory: project.objectsDirectory,
                url,
                sha,
                ref: `refs/heads/${branch}`,
                token,
                force: false,
            });
        } catch (error) {
            throw this.mapGithubError(caller.ownerLogin, error, 'GitHub push failed');
        }
        // Keep local remote tracking ref in sync (best-effort, no token).
        await this.runReadOnlyGit(caller.cwd, ['update-ref', `refs/remotes/origin/${branch}`, sha]).catch(() => undefined);
    }

    protected resolveOwnerToken(ownerLogin: string): string | undefined {
        if (isQaapTenantBackendMode(this.env())) {
            return this.ownerTokens?.get(ownerLogin);
        }
        return this.sessions?.findAccessTokenForLogin(ownerLogin) ?? this.ownerTokens?.get(ownerLogin);
    }

    protected fetchRepositoryMeta(token: string, owner: string, repo: string): Promise<{ defaultBranch?: string }> {
        return fetchGithubRepository(token, owner, repo);
    }

    protected createPullRequest(
        token: string,
        input: { owner: string; repo: string; title: string; head: string; base: string; body: string; draft: boolean },
    ): ReturnType<typeof createGithubPullRequest> {
        return createGithubPullRequest(token, input);
    }

    protected runReadOnlyGit(cwd: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', ['-C', cwd, ...args], {
                timeout: LOCAL_GIT_TIMEOUT_MS,
                maxBuffer: 1024 * 1024,
                env: {
                    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
                    GIT_TERMINAL_PROMPT: '0',
                },
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error((stderr || error.message).trim()));
                    return;
                }
                resolve(stdout);
            });
        });
    }

    protected mapGithubError(ownerLogin: string, error: unknown, fallback: string): QaapAgentGitError {
        const status = (error as { status?: number })?.status;
        const message = error instanceof Error ? error.message : fallback;
        if (status === 401 || /authentication failed|bad credentials|401/i.test(message)) {
            this.ownerTokens?.forget(ownerLogin);
            return new QaapAgentGitError(401, 'GitHub session expired or rejected. Sign in with GitHub in Qaap and retry.');
        }
        if (status === 422 || status === 403 || status === 404) {
            return new QaapAgentGitError(status, message);
        }
        return new QaapAgentGitError(502, message || fallback);
    }

    protected sendError(res: Response, error: unknown): void {
        if (res.headersSent) {
            return;
        }
        if (error instanceof QaapAgentGitError) {
            res.status(error.status).json({ error: error.message });
            return;
        }
        const message = error instanceof Error ? error.message : 'Agent git operation failed.';
        res.status(500).json({ error: message });
    }

    protected env(): NodeJS.ProcessEnv {
        return process.env;
    }
}

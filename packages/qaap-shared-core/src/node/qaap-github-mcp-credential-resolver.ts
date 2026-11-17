// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { execFile } from 'child_process';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { readQaapTenantOwnerLogin } from '../common/qaap-secret-placeholder';
import { QaapGithubOwnerTokenCache } from './qaap-github-owner-token-cache';
import { QaapGithubSessionStore } from './qaap-github-session-store';

/**
 * Where the managed GitHub MCP server gets its token from.
 *
 * - `tenant`: a per-tenant backend; only the owner's token from the request-scoped owner cache.
 * - `none`: a shared hosted backend without an owner; nothing is registered and nothing is read.
 * - `desktop`: the local desktop app; environment variables, then the `gh` CLI, then a stored OAuth session.
 * - `local`: web development on a single machine; only a stored OAuth session of exactly one login.
 */
export type QaapGithubMcpCredentialMode = 'tenant' | 'none' | 'desktop' | 'local';

export type QaapGithubMcpCredentialSource = 'owner-token-cache' | 'env' | 'gh-cli' | 'oauth-session';

export interface QaapGithubMcpCredential {
    readonly token: string;
    readonly source: QaapGithubMcpCredentialSource;
}

/** Status that never carries the token value. */
/** `forgotten`: GitHub rejects the token too. `token-valid`: GitHub accepts it, so the endpoint refuses it (policy). */
export type QaapGithubMcpRejectionVerdict = 'forgotten' | 'token-valid' | 'not-checked';

export interface QaapGithubMcpCredentialStatus {
    readonly available: boolean;
    readonly source: QaapGithubMcpCredentialSource | undefined;
    readonly mode: QaapGithubMcpCredentialMode;
}

/** `gh` lookup order: PATH first, then the usual Homebrew locations a GUI app may not have on PATH. */
const GH_CANDIDATES: readonly string[] = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
const GH_TIMEOUT_MS = 5000;

/**
 * Resolves the GitHub credential for the managed GitHub MCP server.
 *
 * The token is returned only to the caller that connects the server (the backend's Authorization header).
 * It is never logged, never put in an environment variable, in a server description, in preferences, or
 * in an error message; a failing `gh` call is reduced to a short code.
 */
@injectable()
export class QaapGithubMcpCredentialResolver {

    @inject(QaapGithubOwnerTokenCache)
    protected readonly ownerTokenCache: QaapGithubOwnerTokenCache;

    @inject(QaapGithubSessionStore)
    protected readonly sessionStore: QaapGithubSessionStore;

    protected memo: Promise<QaapGithubMcpCredential | undefined> | undefined;

    /** The mode of this process, from its environment. */
    mode(): QaapGithubMcpCredentialMode {
        const env = this.env();
        if (readQaapTenantOwnerLogin(env)) {
            return 'tenant';
        }
        if (isQaapHostedEnvironment(env)) {
            return 'none';
        }
        if (isQaapDesktopRuntime(env)) {
            return 'desktop';
        }
        return 'local';
    }

    /**
     * The credential, or `undefined` when none is available in this mode.
     * A successful lookup is memoized until {@link invalidate}; a miss is retried on the next call.
     */
    resolve(): Promise<QaapGithubMcpCredential | undefined> {
        if (!this.memo) {
            const pending = this.lookup();
            this.memo = pending;
            pending.then(credential => {
                if (!credential && this.memo === pending) {
                    this.memo = undefined;
                }
            }, () => {
                if (this.memo === pending) {
                    this.memo = undefined;
                }
            });
        }
        return this.memo;
    }

    /** Status without the token value. */
    async describe(): Promise<QaapGithubMcpCredentialStatus> {
        const mode = this.mode();
        if (mode === 'none') {
            return { available: false, source: undefined, mode };
        }
        const credential = await this.resolve();
        return { available: !!credential, source: credential?.source, mode };
    }

    /** Forgets the memoized credential, for example after GitHub rejected it or the user signed in again. */
    invalidate(): void {
        this.memo = undefined;
    }

    /**
     * The MCP endpoint answered 401 for `token`. The memo is always cleared. Only a tenant backend forgets
     * the owner's cached token, and only after `GET /user` confirms GitHub rejects it too: a 401 from the
     * Copilot endpoint alone can be a policy or OAuth-app restriction on a valid token.
     */
    async reportRejected(token: string): Promise<QaapGithubMcpRejectionVerdict> {
        this.invalidate();
        const owner = readQaapTenantOwnerLogin(this.env());
        if (!owner) {
            return 'not-checked';
        }
        const verdict = await this.checkUser(token);
        if (verdict === 'rejected') {
            this.ownerTokenCache.forget(owner, token);
            return 'forgotten';
        }
        return verdict === 'accepted' ? 'token-valid' : 'not-checked';
    }

    /** `GET /user` with the token; the token is sent to GitHub only and never logged. */
    protected async checkUser(token: string): Promise<'rejected' | 'accepted' | 'unknown'> {
        try {
            const response = await fetch('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
                signal: AbortSignal.timeout(GH_TIMEOUT_MS),
            });
            if (response.status === 401) {
                return 'rejected';
            }
            return response.ok ? 'accepted' : 'unknown';
        } catch {
            return 'unknown';
        }
    }

    protected async lookup(): Promise<QaapGithubMcpCredential | undefined> {
        const env = this.env();
        const owner = readQaapTenantOwnerLogin(env);
        if (owner) {
            const token = this.ownerTokenCache.get(owner);
            return token ? { token, source: 'owner-token-cache' } : undefined;
        }
        if (isQaapHostedEnvironment(env)) {
            return undefined;
        }
        if (isQaapDesktopRuntime(env)) {
            for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) {
                const token = env[name]?.trim();
                if (token) {
                    return { token, source: 'env' };
                }
            }
            const ghToken = await this.readGhToken();
            if (ghToken) {
                return { token: ghToken, source: 'gh-cli' };
            }
            return this.sessionToken(true);
        }
        return this.sessionToken(false);
    }

    /** The most recent stored session. Desktop accepts any login; local development needs exactly one. */
    protected sessionToken(anyLogin: boolean): QaapGithubMcpCredential | undefined {
        const sessions = this.sessionStore.listSessions().filter(session => !!session.accessToken);
        if (sessions.length === 0 || (!anyLogin && sessions.length !== 1)) {
            return undefined;
        }
        const token = sessions[sessions.length - 1].accessToken;
        return { token, source: 'oauth-session' };
    }

    /** Runs `gh auth token` for github.com. Any failure is a miss; no output or error text is kept. */
    protected async readGhToken(): Promise<string | undefined> {
        for (const command of GH_CANDIDATES) {
            const outcome = await this.runGh(command);
            if (outcome.kind === 'missing') {
                continue;
            }
            return outcome.kind === 'token' ? outcome.token : undefined;
        }
        return undefined;
    }

    protected runGh(command: string): Promise<{ kind: 'token'; token: string } | { kind: 'missing' } | { kind: 'failed' }> {
        return new Promise(resolve => {
            try {
                execFile(command, ['auth', 'token', '--hostname', 'github.com'], {
                    timeout: GH_TIMEOUT_MS,
                    shell: false,
                    windowsHide: true,
                    env: { ...this.env(), GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
                }, (error, stdout) => {
                    if (error) {
                        resolve({ kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'failed' });
                        return;
                    }
                    const token = String(stdout ?? '').trim();
                    resolve(token && !/\s/.test(token) ? { kind: 'token', token } : { kind: 'failed' });
                });
            } catch {
                resolve({ kind: 'missing' });
            }
        });
    }

    /** The process environment; a seam for tests. */
    protected env(): NodeJS.ProcessEnv {
        return process.env;
    }
}

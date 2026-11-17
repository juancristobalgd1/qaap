// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isQaapDesktopRuntime } from '@theia/qaap-adapters/lib/common/qaap-desktop-runtime';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import { isQaapTenantBackendMode } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { readQaapTenantOwnerLogin } from '../common/qaap-secret-placeholder';
import { QaapGithubOwnerTokenCache } from './qaap-github-owner-token-cache';
import { QaapGithubSessionStore } from './qaap-github-session-store';

/**
 * Where the managed GitHub MCP server gets its token from.
 *
 * - `tenant`: a per-tenant backend; only the owner's token from the request-scoped owner cache.
 * - `desktop`: the local desktop app (`QAAP_DESKTOP=1`, never on a hosted backend); environment variables,
 *   then the `gh` CLI, then a stored OAuth session.
 * - `local`: explicit local web development (`QAAP_LOCAL_DEV=1`, set by `npm run start:browser`, or
 *   `QAAP_CLOUD_MODE=local`); only a stored OAuth session of exactly one login.
 * - `none`: everything else, in particular a hosted backend without an owner or a backend whose runtime is
 *   not stated explicitly; nothing is registered and nothing is read (fail closed).
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

/** The usual install locations a GUI app may not have on PATH, tried after the absolute PATH entries. */
const GH_FALLBACK_DIRS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin'];
const GH_TIMEOUT_MS = 5000;
/** At most one `GET /user` check per token in this window; later 401s reuse the verdict. */
const USER_CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Environment variables of the `gh` call that change where gh reads its config or which host it asks. */
const GH_ENV_KEPT = new Set(['GH_PROMPT_DISABLED']);

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

    /** Last `GET /user` verdict per token hash (never the token itself), see {@link USER_CHECK_INTERVAL_MS}. */
    protected readonly userCheckVerdicts = new Map<string, { at: number; verdict: 'rejected' | 'accepted' | 'unknown' }>();

    /** The mode of this process, from its environment. Anything not stated explicitly is `none`. */
    mode(): QaapGithubMcpCredentialMode {
        const env = this.env();
        if (readQaapTenantOwnerLogin(env)) {
            return 'tenant';
        }
        if (isQaapTenantBackendMode(env) || isQaapHostedEnvironment(env)) {
            return 'none';
        }
        if (isQaapDesktopRuntime(env)) {
            return 'desktop';
        }
        if (/^(1|true)$/i.test(env.QAAP_LOCAL_DEV?.trim() ?? '') || env.QAAP_CLOUD_MODE?.trim().toLowerCase() === 'local') {
            return 'local';
        }
        return 'none';
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
        const verdict = await this.checkUserLimited(token);
        if (verdict === 'rejected') {
            this.ownerTokenCache.forget(owner, token);
            return 'forgotten';
        }
        return verdict === 'accepted' ? 'token-valid' : 'not-checked';
    }

    /** {@link checkUser}, at most once per token per {@link USER_CHECK_INTERVAL_MS}; an `unknown` verdict is not cached. */
    protected async checkUserLimited(token: string, now: number = Date.now()): Promise<'rejected' | 'accepted' | 'unknown'> {
        const key = createHash('sha256').update(token).digest('hex');
        const cached = this.userCheckVerdicts.get(key);
        if (cached && now - cached.at < USER_CHECK_INTERVAL_MS) {
            return cached.verdict;
        }
        const verdict = await this.checkUser(token);
        for (const [entryKey, entry] of this.userCheckVerdicts) {
            if (now - entry.at >= USER_CHECK_INTERVAL_MS) {
                this.userCheckVerdicts.delete(entryKey);
            }
        }
        if (verdict !== 'unknown') {
            this.userCheckVerdicts.set(key, { at: now, verdict });
        }
        return verdict;
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
        switch (this.mode()) {
            case 'tenant': {
                const token = this.ownerTokenCache.get(readQaapTenantOwnerLogin(env));
                return token ? { token, source: 'owner-token-cache' } : undefined;
            }
            case 'desktop': {
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
            case 'local':
                return this.sessionToken(false);
            default:
                return undefined;
        }
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
        for (const command of this.ghCandidates()) {
            const outcome = await this.runGh(command);
            if (outcome.kind === 'missing') {
                continue;
            }
            return outcome.kind === 'token' ? outcome.token : undefined;
        }
        return undefined;
    }

    /**
     * Absolute paths of existing `gh` executables: the absolute entries of the backend's own PATH, then the
     * usual Homebrew locations. Relative PATH entries (`.`, empty) are skipped and the bare name `gh` is never
     * run, so the working directory is never searched (Windows would otherwise look there first).
     */
    protected ghCandidates(): string[] {
        const isWindows = process.platform === 'win32';
        const names = isWindows ? ['gh.exe'] : ['gh'];
        const dirs = [...(this.env().PATH ?? this.env().Path ?? '').split(path.delimiter), ...(isWindows ? [] : GH_FALLBACK_DIRS)];
        const found: string[] = [];
        for (const dir of dirs) {
            if (!dir || !path.isAbsolute(dir)) {
                continue;
            }
            for (const name of names) {
                const candidate = path.join(dir, name);
                if (!found.includes(candidate) && this.isExecutableFile(candidate)) {
                    found.push(candidate);
                }
            }
        }
        return found;
    }

    protected isExecutableFile(candidate: string): boolean {
        try {
            fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
            return fs.statSync(candidate).isFile();
        } catch {
            return false;
        }
    }

    /** The environment of the `gh` call: the backend's own, without `GH_*` overrides (config dir, host, token). */
    protected ghEnv(): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const [key, value] of Object.entries(this.env())) {
            if (!key.toUpperCase().startsWith('GH_') || GH_ENV_KEPT.has(key)) {
                env[key] = value;
            }
        }
        return { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };
    }

    protected runGh(command: string): Promise<{ kind: 'token'; token: string } | { kind: 'missing' } | { kind: 'failed' }> {
        return new Promise(resolve => {
            try {
                execFile(command, ['auth', 'token', '--hostname', 'github.com'], {
                    timeout: GH_TIMEOUT_MS,
                    shell: false,
                    windowsHide: true,
                    env: this.ghEnv(),
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

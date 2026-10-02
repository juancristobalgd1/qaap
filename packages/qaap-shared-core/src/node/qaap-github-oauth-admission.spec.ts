// *****************************************************************************
// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QAAP_AUTH_SESSION_COOKIE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapBetaAccessPolicy } from './qaap-beta-access-policy';
import { QaapGithubSessionStore, type QaapGithubStoredSession } from './qaap-github-session-store';

class AllowlistedTestSessionStore extends QaapGithubSessionStore {
    protected override readonly betaAccess: QaapBetaAccessPolicy;

    constructor(env: NodeJS.ProcessEnv) {
        super();
        this.betaAccess = new QaapBetaAccessPolicy(env);
    }

    protected override schedulePersist(): void {
        // Keep the mocked OAuth test entirely in memory; it must never write real login state.
    }
}

class TestAuthGuard extends QaapGithubAuthGuard {
    constructor(store: QaapGithubSessionStore) {
        super();
        Object.assign(this, { sessions: store });
    }

    override isSkipAuthEnabled(): boolean {
        return false;
    }
}

class TestOAuthResponse {
    statusCode = 200;
    body: unknown;
    location: string | undefined;
    readonly headers = new Map<string, string>();

    status(code: number): this {
        this.statusCode = code;
        return this;
    }

    send(body: unknown): this {
        this.body = body;
        return this;
    }

    json(body: unknown): this {
        this.body = body;
        return this;
    }

    redirect(statusOrUrl: number | string, url?: string): this {
        if (typeof statusOrUrl === 'number') {
            this.statusCode = statusOrUrl;
            this.location = url;
        } else {
            this.location = statusOrUrl;
        }
        return this;
    }

    setHeader(name: string, value: string): this {
        this.headers.set(name.toLowerCase(), value);
        return this;
    }
}

class TestOAuthEndpoint extends QaapGithubOauthEndpoint {
    constructor(store: QaapGithubSessionStore) {
        super();
        Object.assign(this, { sessions: store, auth: new TestAuthGuard(store) });
    }

    start(): TestOAuthResponse {
        const response = new TestOAuthResponse();
        this.handleOAuthStart({} as Request, response as unknown as Response);
        return response;
    }

    async callback(code: string, state: string): Promise<TestOAuthResponse> {
        const response = new TestOAuthResponse();
        await this.handleOAuthCallback({ query: { code, state }, headers: {} } as unknown as Request, response as unknown as Response);
        return response;
    }

    session(cookie: string): TestOAuthResponse {
        const response = new TestOAuthResponse();
        this.handleAuthSession({ headers: { cookie } } as unknown as Request, response as unknown as Response);
        return response;
    }
}

describe('Qaap GitHub OAuth beta admission', () => {
    it('completes fresh mocked OAuth logins for both allowlisted test accounts', async () => {
        const envKeys = [
            'NODE_ENV',
            'QAAP_BETA_ALLOWED_LOGINS',
            'QAAP_GITHUB_CLIENT_ID',
            'QAAP_GITHUB_CLIENT_SECRET',
            'QAAP_OAUTH_PUBLIC_URL',
            'QAAP_SKIP_AUTH',
        ] as const;
        const previousEnv = new Map(envKeys.map(key => [key, process.env[key]]));
        const previousFetch = globalThis.fetch;
        process.env.NODE_ENV = 'production';
        process.env.QAAP_BETA_ALLOWED_LOGINS = 'alice,bob';
        process.env.QAAP_GITHUB_CLIENT_ID = 'test-client-id';
        process.env.QAAP_GITHUB_CLIENT_SECRET = 'test-client-secret';
        process.env.QAAP_OAUTH_PUBLIC_URL = 'https://qaap.test';
        delete process.env.QAAP_SKIP_AUTH;
        globalThis.fetch = async (input, init) => {
            const url = String(input);
            if (url === 'https://github.com/login/oauth/access_token') {
                const code = new URLSearchParams(String(init?.body ?? '')).get('code');
                return new Response(JSON.stringify({ access_token: `test-token-${code}` }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url === 'https://api.github.com/user') {
                const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer\s+/i, '');
                const login = token?.replace(/^test-token-/, '');
                return new Response(JSON.stringify({ login, name: login?.toUpperCase() }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error(`Unexpected OAuth test request: ${url}`);
        };

        try {
            const store = new AllowlistedTestSessionStore(process.env);
            const endpoint = new TestOAuthEndpoint(store);
            for (const login of ['alice', 'bob']) {
                const start = endpoint.start();
                expect(start.statusCode).to.equal(302);
                const authorizeUrl = new URL(start.location!);
                expect(authorizeUrl.hostname).to.equal('github.com');
                const state = authorizeUrl.searchParams.get('state')!;

                const callback = await endpoint.callback(login, state);
                expect(callback.statusCode).to.equal(302);
                expect(callback.location).to.contain('qaap_oauth=github');
                const setCookie = callback.headers.get('set-cookie')!;
                const cookie = setCookie.split(';', 1)[0];
                const sessionId = decodeURIComponent(cookie.slice(`${QAAP_AUTH_SESSION_COOKIE}=`.length));
                const stored: QaapGithubStoredSession | undefined = store.getSession(sessionId);
                expect(stored?.user.login).to.equal(login);

                const sessionResponse = endpoint.session(cookie);
                expect(sessionResponse.body).to.deep.equal({ signedIn: true, user: stored?.user });
            }
            expect(store.listSessions().map(session => session.user.login).sort()).to.deep.equal(['alice', 'bob']);
        } finally {
            globalThis.fetch = previousFetch;
            for (const key of envKeys) {
                const value = previousEnv.get(key);
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });
});

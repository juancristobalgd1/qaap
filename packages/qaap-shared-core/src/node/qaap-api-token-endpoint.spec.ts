// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_TENANT_BACKEND_ASSERTION_HEADER,
    QAAP_TENANT_BACKEND_MODE_ENV,
    QAAP_TENANT_BACKEND_SECRET_ENV,
    QAAP_TENANT_LOGIN_ENV,
    createQaapTenantBackendAssertion,
} from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapApiTokenEndpoint } from './qaap-api-token-endpoint';
import { QAAP_API_TOKEN_MAX_PER_USER, QaapApiTokenStore } from './qaap-api-token-store';
import { buildQaapPreviewUpstreamHeaders } from './qaap-dev-preview-forward-headers';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapGithubSessionStore } from './qaap-github-session-store';

interface RecordedResponse {
    statusCode: number;
    body: unknown;
}

function fakeResponse(recorded: RecordedResponse): Response {
    const res = {
        set: () => res,
        status: (code: number) => {
            recorded.statusCode = code;
            return res;
        },
        json: (body: unknown) => {
            recorded.body = body;
            return res;
        },
        end: () => res,
    };
    return res as unknown as Response;
}

describe('QaapApiTokenEndpoint (personal API tokens)', () => {
    const storeEnvKeys = ['QAAP_AUTH_STORE_PATH', 'QAAP_SQLITE_STORE_PATH'] as const;
    const savedStoreEnv: Partial<Record<typeof storeEnvKeys[number], string>> = {};
    let authStoreDir: string;
    let sessions: QaapGithubSessionStore;
    let guard: QaapGithubAuthGuard;
    let tokens: QaapApiTokenStore;
    let endpoint: QaapApiTokenEndpoint;
    let aliceSession: string;

    before(() => {
        for (const key of storeEnvKeys) {
            savedStoreEnv[key] = process.env[key];
        }
    });
    beforeEach(() => {
        authStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-api-tokens-'));
        process.env.QAAP_AUTH_STORE_PATH = path.join(authStoreDir, 'sessions.json');
        delete process.env.QAAP_SQLITE_STORE_PATH;
        sessions = new QaapGithubSessionStore();
        tokens = new QaapApiTokenStore();
        guard = new QaapGithubAuthGuard();
        Object.assign(guard, { sessions, apiTokens: tokens });
        endpoint = new QaapApiTokenEndpoint();
        Object.assign(endpoint, { tokens, auth: guard, sessions });
        aliceSession = sessions.createSession({
            accessToken: 'gh-alice',
            user: { provider: 'github', login: 'alice', name: 'Alice' },
        });
    });
    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(authStoreDir);
        fs.rmSync(authStoreDir, { recursive: true, force: true });
    });
    after(() => {
        for (const key of storeEnvKeys) {
            if (savedStoreEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedStoreEnv[key];
            }
        }
    });

    const cookie = (sessionId: string): Record<string, string> => ({ cookie: `qaap_sid=${encodeURIComponent(sessionId)}` });
    const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
    const taskRequest = (token: string, url = '/qaap/api/agent-tasks', method = 'GET'): { headers: Record<string, string>; url: string; method: string } =>
        ({ headers: bearer(token), url, method });

    function mint(headers: Record<string, string>, label = 'ci', contentType = 'application/json'): RecordedResponse {
        const recorded: RecordedResponse = { statusCode: 200, body: undefined };
        const allHeaders = contentType ? { 'content-type': contentType, ...headers } : headers;
        endpoint['handleCreate']({ method: 'POST', headers: allHeaders, body: { label } } as unknown as Request, fakeResponse(recorded));
        return recorded;
    }

    it('lets a headless caller act as the token owner without a browser session', () => {
        const created = mint(cookie(aliceSession));
        expect(created.statusCode).to.equal(201);
        const token = (created.body as { token: string }).token;
        expect(token).to.match(/^qaap_pat_/);

        const ctx = guard.authenticate(taskRequest(token));
        expect(ctx.kind).to.equal('authenticated');
        expect(guard.resolveUserLogin(ctx)).to.equal('alice');
        // The secret is never persisted, only its hash.
        const database = fs.readdirSync(authStoreDir).map(file => fs.readFileSync(path.join(authStoreDir, file)).toString('latin1')).join('');
        expect(database).to.not.contain(token);
    });

    it('rejects unknown, revoked and signed-out tokens', () => {
        expect(guard.authenticate(taskRequest('qaap_pat_unknown')).kind).to.equal('unauthorized');

        const token = (mint(cookie(aliceSession)).body as { token: string; id: string });
        const recorded: RecordedResponse = { statusCode: 200, body: undefined };
        endpoint['handleRevoke']({ method: 'DELETE', headers: cookie(aliceSession), params: { id: token.id } } as unknown as Request, fakeResponse(recorded));
        expect(recorded.statusCode).to.equal(204);
        expect(guard.authenticate(taskRequest(token.token)).kind).to.equal('unauthorized');

        const second = (mint(cookie(aliceSession)).body as { token: string }).token;
        sessions.deleteSession(aliceSession);
        expect(guard.authenticate(taskRequest(second)).kind).to.equal('unauthorized');
    });

    it('never lets a token mint tokens, and refuses cross-site or anonymous minting', () => {
        const token = (mint(cookie(aliceSession)).body as { token: string }).token;
        expect(mint(bearer(token)).statusCode).to.equal(403);
        expect(mint({ ...cookie(aliceSession), 'sec-fetch-site': 'cross-site' }).statusCode).to.equal(403);
        // A sibling subdomain (e.g. a user app preview) is same-site and carries the cookie.
        expect(mint({ ...cookie(aliceSession), 'sec-fetch-site': 'same-site' }).statusCode).to.equal(403);
        expect(mint({ ...cookie(aliceSession), 'sec-fetch-site': 'same-origin' }).statusCode).to.equal(201);
        expect(mint({}).statusCode).to.equal(401);
    });

    it('refuses a non-JSON mint from a browser that sends no Sec-Fetch-Site (cross-site form post)', () => {
        // Safari < 16.4: a cross-site <form enctype="text/plain"> carries the cookie and no Sec-Fetch-Site.
        expect(mint(cookie(aliceSession), 'csrf', 'text/plain').statusCode).to.equal(415);
        expect(mint(cookie(aliceSession), 'csrf', 'application/x-www-form-urlencoded').statusCode).to.equal(415);
        expect(mint(cookie(aliceSession), 'csrf', '').statusCode).to.equal(415);
        expect(mint(cookie(aliceSession), 'curl', 'application/json; charset=utf-8').statusCode).to.equal(201);
        // A modern browser on the Qaap page itself sends Sec-Fetch-Site: same-origin.
        expect(mint({ ...cookie(aliceSession), 'sec-fetch-site': 'same-origin' }, 'page', 'text/plain').statusCode).to.equal(201);
    });

    it('only authenticates create, list, read and cancel of agent tasks', () => {
        const token = (mint(cookie(aliceSession)).body as { token: string }).token;
        const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
        for (const [method, url] of [
            ['GET', '/qaap/api/agent-tasks'],
            ['POST', '/qaap/api/agent-tasks'],
            ['GET', `/qaap/api/agent-tasks/${id}?x=1`],
            ['POST', `/qaap/api/agent-tasks/${id}/cancel`],
        ]) {
            expect(guard.authenticate(taskRequest(token, url, method)).kind, `${method} ${url}`).to.equal('authenticated');
        }
        for (const [method, url] of [
            // The rest of the agent-task API runs CLIs, warms or deletes the project, or streams everything.
            ['POST', '/qaap/api/agent-tasks/cli-updates/codex'],
            ['GET', '/qaap/api/agent-tasks/cli-updates'],
            ['POST', '/qaap/api/agent-tasks/warm'],
            ['DELETE', '/qaap/api/agent-tasks/project'],
            ['GET', '/qaap/api/agent-tasks/stream'],
            ['GET', '/qaap/api/agent-tasks/all'],
            ['GET', '/qaap/api/agent-tasks/harness-status'],
            ['POST', `/qaap/api/agent-tasks/${id}/retry`],
            ['POST', `/qaap/api/agent-tasks/${id}/resume`],
            ['POST', `/qaap/api/agent-tasks/${id}/reorder`],
            ['DELETE', `/qaap/api/agent-tasks/${id}`],
            ['HEAD', '/qaap/api/agent-tasks'],
            ['GET', '/qaap/api/agent-tasks/'],
            ['GET', '/QAAP/api/agent-tasks'],
            ['GET', '/services'],
            ['GET', '/qaap/api/auth/api-tokens'],
            ['GET', '/qaap/api/github/repos'],
            ['GET', '/qaap/api/agent-tasks-evil'],
            ['GET', '/qaap/api/agent-tasks/../github/repos'],
            ['GET', '/qaap/api/agent-tasks/%2e%2e/github'],
            ['GET', ''],
        ]) {
            expect(guard.authenticate(taskRequest(token, url, method)).kind, `${method} ${url}`).to.equal('unauthorized');
        }
        expect(guard.authenticate({ headers: bearer(token) }).kind).to.equal('unauthorized');
        expect(guard.authenticate({ headers: { ...bearer(token), upgrade: 'websocket' }, method: 'GET', url: '/qaap/api/agent-tasks' }).kind)
            .to.equal('unauthorized');
        // The browser session keeps its full scope.
        expect(guard.authenticate({ headers: cookie(aliceSession), url: '/services' }).kind).to.equal('authenticated');
    });

    it('expires tokens (30 days by default, at most 90) and caps live tokens per user', () => {
        const tokens = new QaapApiTokenStore();
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const created = tokens.create('alice', aliceSession, 'short', 2, now)!;
        expect(created.summary.expiresAt).to.equal(now + 2 * day);
        expect(tokens.resolve(created.token, now + day)?.ownerLogin).to.equal('alice');
        expect(tokens.resolve(created.token, now + 2 * day)).to.equal(undefined);
        expect(tokens.resolve(created.token, now)).to.equal(undefined); // deleted on expiry
        expect(tokens.create('alice', aliceSession, 'default', undefined, now)!.summary.expiresAt).to.equal(now + 30 * day);
        expect(tokens.create('alice', aliceSession, 'long', 400, now)!.summary.expiresAt).to.equal(now + 90 * day);

        for (let i = tokens.list('alice', now).length; i < QAAP_API_TOKEN_MAX_PER_USER; i++) {
            expect(tokens.create('alice', aliceSession, `t${i}`, undefined, now)).to.not.equal(undefined);
        }
        expect(tokens.create('alice', aliceSession, 'one too many', undefined, now)).to.equal(undefined);
        expect(mint(cookie(aliceSession)).statusCode).to.equal(409);
        expect(tokens.create('bob', 'bob-session', 'other user', undefined, now)).to.not.equal(undefined);
    });

    it('never forwards a token to a previewed dev server', () => {
        const forwarded = buildQaapPreviewUpstreamHeaders({ authorization: 'Bearer qaap_pat_secret', accept: 'text/html' }, 'localhost:5173');
        expect(forwarded.authorization).to.equal(undefined);
        expect(buildQaapPreviewUpstreamHeaders({ authorization: 'Bearer app-own-jwt' }, 'localhost:5173').authorization).to.equal('Bearer app-own-jwt');
    });

    it('in a tenant backend, accepts only the control-plane assertion, never a cookie or API token', () => {
        const token = (mint(cookie(aliceSession)).body as { token: string }).token;
        const keys = [QAAP_TENANT_BACKEND_MODE_ENV, QAAP_TENANT_BACKEND_SECRET_ENV, QAAP_TENANT_LOGIN_ENV] as const;
        const saved = keys.map(key => process.env[key]);
        const secret = 's'.repeat(40);
        process.env[QAAP_TENANT_BACKEND_MODE_ENV] = '1';
        process.env[QAAP_TENANT_BACKEND_SECRET_ENV] = secret;
        process.env[QAAP_TENANT_LOGIN_ENV] = 'alice';
        try {
            // Both resolve against the tenant-local stores, which code inside the tenant can write.
            expect(guard.authenticate({ headers: cookie(aliceSession), method: 'GET', url: '/qaap/api/agent-tasks' }).kind).to.equal('unauthorized');
            expect(guard.authenticate(taskRequest(token)).kind).to.equal('unauthorized');
            expect(guard.resolveGithubSession({ headers: cookie(aliceSession) })).to.equal(undefined);
            const assertion = createQaapTenantBackendAssertion({
                tenantLogin: 'alice',
                user: { provider: 'github', login: 'alice', name: 'Alice' },
                githubAccessToken: 'gh-alice',
            }, secret);
            expect(guard.authenticate({ headers: { [QAAP_TENANT_BACKEND_ASSERTION_HEADER]: assertion } }).kind).to.equal('authenticated');
        } finally {
            keys.forEach((key, index) => {
                if (saved[index] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = saved[index];
                }
            });
        }
    });

    it('lists and revokes only the caller\'s own tokens', () => {
        const bobSession = sessions.createSession({ accessToken: 'gh-bob', user: { provider: 'github', login: 'bob', name: 'Bob' } });
        const aliceToken = mint(cookie(aliceSession), 'alice laptop').body as { id: string };
        mint(cookie(bobSession), 'bob ci');

        const listed: RecordedResponse = { statusCode: 200, body: undefined };
        endpoint['handleList']({ method: 'GET', headers: cookie(bobSession) } as unknown as Request, fakeResponse(listed));
        expect((listed.body as { tokens: Array<{ label: string }> }).tokens.map(entry => entry.label)).to.deep.equal(['bob ci']);

        const revoked: RecordedResponse = { statusCode: 200, body: undefined };
        endpoint['handleRevoke']({ method: 'DELETE', headers: cookie(bobSession), params: { id: aliceToken.id } } as unknown as Request, fakeResponse(revoked));
        expect(revoked.statusCode).to.equal(404);
    });

    it('deletes a session\'s tokens on sign-out and drops dead ones from the list and the cap', () => {
        const listLabels = (sessionId: string): string[] => {
            const listed: RecordedResponse = { statusCode: 200, body: undefined };
            endpoint['handleList']({ method: 'GET', headers: cookie(sessionId) } as unknown as Request, fakeResponse(listed));
            return (listed.body as { tokens: Array<{ label: string }> }).tokens.map(entry => entry.label);
        };
        const laptop = sessions.createSession({ accessToken: 'gh-alice-2', user: { provider: 'github', login: 'alice', name: 'Alice' } });
        mint(cookie(aliceSession), 'from browser A');
        mint(cookie(laptop), 'from laptop');

        // Sign-out of the laptop deletes its token, not just the session it pointed to.
        const oauth = new QaapGithubOauthEndpoint();
        Object.assign(oauth, { sessions, auth: guard, apiTokens: tokens });
        oauth['handleSignOut']({ headers: cookie(laptop) } as unknown as Request,
            { setHeader: () => undefined, json: () => undefined } as unknown as Response);
        expect(tokens.list('alice').map(entry => entry.label)).to.deep.equal(['from browser A']);

        // A session removed another way (other backend, expiry): its tokens are pruned when the owner manages tokens.
        const tablet = sessions.createSession({ accessToken: 'gh-alice-3', user: { provider: 'github', login: 'alice', name: 'Alice' } });
        for (let i = tokens.list('alice').length; i < QAAP_API_TOKEN_MAX_PER_USER; i++) {
            mint(cookie(tablet), `tablet ${i}`);
        }
        expect(mint(cookie(aliceSession)).statusCode).to.equal(409);
        sessions.deleteSession(tablet);
        expect(listLabels(aliceSession)).to.deep.equal(['from browser A']);
        expect(mint(cookie(aliceSession), 'after prune').statusCode).to.equal(201);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapApiTokenEndpoint } from './qaap-api-token-endpoint';
import { QaapApiTokenStore } from './qaap-api-token-store';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
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
        const tokens = new QaapApiTokenStore();
        guard = new QaapGithubAuthGuard();
        Object.assign(guard, { sessions, apiTokens: tokens });
        endpoint = new QaapApiTokenEndpoint();
        Object.assign(endpoint, { tokens, auth: guard });
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

    function mint(headers: Record<string, string>, label = 'ci'): RecordedResponse {
        const recorded: RecordedResponse = { statusCode: 200, body: undefined };
        endpoint['handleCreate']({ method: 'POST', headers, body: { label } } as unknown as Request, fakeResponse(recorded));
        return recorded;
    }

    it('lets a headless caller act as the token owner without a browser session', () => {
        const created = mint(cookie(aliceSession));
        expect(created.statusCode).to.equal(201);
        const token = (created.body as { token: string }).token;
        expect(token).to.match(/^qaap_pat_/);

        const ctx = guard.authenticate({ headers: bearer(token) });
        expect(ctx.kind).to.equal('authenticated');
        expect(guard.resolveUserLogin(ctx)).to.equal('alice');
        // The secret is never persisted, only its hash.
        const database = fs.readdirSync(authStoreDir).map(file => fs.readFileSync(path.join(authStoreDir, file)).toString('latin1')).join('');
        expect(database).to.not.contain(token);
    });

    it('rejects unknown, revoked and signed-out tokens', () => {
        expect(guard.authenticate({ headers: bearer('qaap_pat_unknown') }).kind).to.equal('unauthorized');

        const token = (mint(cookie(aliceSession)).body as { token: string; id: string });
        const recorded: RecordedResponse = { statusCode: 200, body: undefined };
        endpoint['handleRevoke']({ method: 'DELETE', headers: cookie(aliceSession), params: { id: token.id } } as unknown as Request, fakeResponse(recorded));
        expect(recorded.statusCode).to.equal(204);
        expect(guard.authenticate({ headers: bearer(token.token) }).kind).to.equal('unauthorized');

        const second = (mint(cookie(aliceSession)).body as { token: string }).token;
        sessions.deleteSession(aliceSession);
        expect(guard.authenticate({ headers: bearer(second) }).kind).to.equal('unauthorized');
    });

    it('never lets a token mint tokens, and refuses cross-site or anonymous minting', () => {
        const token = (mint(cookie(aliceSession)).body as { token: string }).token;
        expect(mint(bearer(token)).statusCode).to.equal(403);
        expect(mint({ ...cookie(aliceSession), 'sec-fetch-site': 'cross-site' }).statusCode).to.equal(403);
        expect(mint({}).statusCode).to.equal(401);
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
});

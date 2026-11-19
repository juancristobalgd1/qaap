// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAuthSessionUser } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapGithubAuthContext } from './qaap-github-auth-guard';
import { QaapGithubDesktopCredentialSession } from './qaap-github-desktop-credential-session';
import { QaapGithubMcpCredentialResolver } from './qaap-github-mcp-credential-resolver';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapGithubOwnerTokenCache } from './qaap-github-owner-token-cache';
import { QaapGithubSessionStore, QaapGithubStoredSession } from './qaap-github-session-store';

type GhOutcome = { kind: 'token'; token: string } | { kind: 'missing' } | { kind: 'failed' };

const GH_TOKEN_VALUE = 'gho_desktopSpecToken';

class FakeResolver extends QaapGithubMcpCredentialResolver {
    fakeEnv: NodeJS.ProcessEnv = {};
    ghOutcome: GhOutcome = { kind: 'token', token: GH_TOKEN_VALUE };
    ghCalls = 0;

    constructor(sessions: QaapGithubStoredSession[] = []) {
        super();
        const injected = this as unknown as { ownerTokenCache: QaapGithubOwnerTokenCache; sessionStore: QaapGithubSessionStore };
        injected.ownerTokenCache = new QaapGithubOwnerTokenCache();
        injected.sessionStore = { listSessions: (): QaapGithubStoredSession[] => sessions } as unknown as QaapGithubSessionStore;
    }

    protected override env(): NodeJS.ProcessEnv {
        return this.fakeEnv;
    }

    protected override ghCandidates(): string[] {
        return ['/fake/bin/gh'];
    }

    protected override runGh(): Promise<GhOutcome> {
        this.ghCalls++;
        return Promise.resolve(this.ghOutcome);
    }
}

class TestDesktopSession extends QaapGithubDesktopCredentialSession {
    userLookups: string[] = [];
    userAnswer: QaapAuthSessionUser | Error = { provider: 'github', login: 'octo', name: 'Octo Cat' };

    constructor(resolver: FakeResolver) {
        super();
        (this as unknown as { resolver: QaapGithubMcpCredentialResolver }).resolver = resolver;
    }

    protected override fetchUser(token: string): Promise<QaapAuthSessionUser> {
        this.userLookups.push(token);
        return this.userAnswer instanceof Error ? Promise.reject(this.userAnswer) : Promise.resolve(this.userAnswer);
    }
}

const skip: QaapGithubAuthContext = { kind: 'skip', userLogin: '_dev' };

const setup = (env: NodeJS.ProcessEnv): { resolver: FakeResolver; session: TestDesktopSession } => {
    const resolver = new FakeResolver();
    resolver.fakeEnv = env;
    return { resolver, session: new TestDesktopSession(resolver) };
};

describe('QaapGithubDesktopCredentialSession', () => {

    it('gives a skip-auth desktop request the gh credential and the GitHub login', async () => {
        const { session } = setup({ QAAP_DESKTOP: '1' });
        const resolved = await session.resolve(skip);
        expect(resolved?.accessToken).to.equal(GH_TOKEN_VALUE);
        expect(resolved?.source).to.equal('gh-cli');
        expect(resolved?.user.login).to.equal('octo');
    });

    // The policy this pins: env variables and gh are read only by the desktop app, never on a shared server.
    for (const [label, env] of [
        ['a tenant backend', { QAAP_DESKTOP: '1', QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice', GH_TOKEN: 'ghp_x' }],
        ['a tenant backend mode without owner', { QAAP_DESKTOP: '1', QAAP_TENANT_BACKEND_MODE: '1', GH_TOKEN: 'ghp_x' }],
        ['a hosted backend', { QAAP_DESKTOP: '1', QAAP_CLOUD_MODE: 'docker', GH_TOKEN: 'ghp_x' }],
        ['a production backend', { QAAP_DESKTOP: '1', NODE_ENV: 'production', GH_TOKEN: 'ghp_x' }],
        ['local web development', { QAAP_LOCAL_DEV: '1', GH_TOKEN: 'ghp_x' }],
        ['an unstated runtime', { GH_TOKEN: 'ghp_x' }],
    ] as const) {
        it(`never reads a credential on ${label}`, async () => {
            const { resolver, session } = setup({ ...env });
            expect(session.isEnabled()).to.equal(false);
            expect(await session.resolve(skip)).to.equal(undefined);
            expect(resolver.ghCalls).to.equal(0);
            expect(session.userLookups).to.deep.equal([]);
        });
    }

    it('leaves authenticated and unauthorized requests alone', async () => {
        const { resolver, session } = setup({ QAAP_DESKTOP: '1' });
        const authenticated: QaapGithubAuthContext = {
            kind: 'authenticated', sessionId: 's', userLogin: 'alice',
            session: { accessToken: 'gho_oauth', user: { provider: 'github', login: 'alice', name: 'alice' } },
        };
        expect(await session.resolve(authenticated)).to.equal(undefined);
        expect(await session.resolve({ kind: 'unauthorized' })).to.equal(undefined);
        expect(resolver.ghCalls).to.equal(0);
    });

    it('has nothing without a credential, and retries only after the miss window', async () => {
        const { resolver, session } = setup({ QAAP_DESKTOP: '1' });
        resolver.ghOutcome = { kind: 'failed' };
        expect(await session.resolve(skip, 1000)).to.equal(undefined);
        expect(await session.resolve(skip, 2000)).to.equal(undefined);
        expect(resolver.ghCalls).to.equal(1);
        resolver.ghOutcome = { kind: 'token', token: GH_TOKEN_VALUE };
        expect((await session.resolve(skip, 1000 + 31_000))?.source).to.equal('gh-cli');
    });

    it('drops a credential GitHub does not answer GET /user for', async () => {
        const { resolver, session } = setup({ QAAP_DESKTOP: '1' });
        session.userAnswer = new Error('GitHub user API failed (401)');
        expect(await session.resolve(skip, 0)).to.equal(undefined);
        session.userAnswer = { provider: 'github', login: 'octo', name: 'octo' };
        expect((await session.resolve(skip, 31_000))?.user.login).to.equal('octo');
        expect(resolver.ghCalls).to.equal(2);
    });

    it('asks GET /user once per token while the answer is fresh', async () => {
        const { session } = setup({ QAAP_DESKTOP: '1' });
        await session.resolve(skip, 0);
        await session.resolve(skip, 1000);
        expect(session.userLookups).to.have.length(1);
    });

    it('forgets a rejected token, so the next request reads the current credential', async () => {
        const { resolver, session } = setup({ QAAP_DESKTOP: '1' });
        await session.resolve(skip, 0);
        session.reportRejected(GH_TOKEN_VALUE);
        resolver.ghOutcome = { kind: 'token', token: 'gho_rotated' };
        expect((await session.resolve(skip, 1))?.accessToken).to.equal('gho_rotated');
    });

    it('describes the source and the GitHub user without the token', async () => {
        const { session } = setup({ QAAP_DESKTOP: '1' });
        const described = await session.describe(skip);
        expect(described?.source).to.equal('gh-cli');
        expect(JSON.stringify(described)).not.to.contain(GH_TOKEN_VALUE);
    });
});

interface FakeResponse {
    statusCode?: number;
    body?: unknown;
    headersSent: boolean;
    status(code: number): { json(body: unknown): void };
    json(body: unknown): void;
}

const makeRes = (): { res: FakeResponse; done: Promise<void> } => {
    let finish: () => void = () => undefined;
    const done = new Promise<void>(resolve => finish = resolve);
    const res: FakeResponse = {
        headersSent: false,
        status(code: number) {
            res.statusCode = code;
            return { json: (body: unknown) => { res.body = body; res.headersSent = true; finish(); } };
        },
        json(body: unknown) {
            res.statusCode = res.statusCode ?? 200;
            res.body = body;
            res.headersSent = true;
            finish();
        },
    };
    return { res, done };
};

interface DesktopEndpoint {
    handleAuthSession(req: unknown, res: FakeResponse): void;
    handleSearchGithubPullRequests(req: unknown, res: FakeResponse): Promise<void>;
    handleGithubPullRequestByBranch(req: unknown, res: FakeResponse): Promise<void>;
}

describe('QaapGithubOauthEndpoint with the desktop credential', () => {

    const createEndpoint = (desktopCredential: QaapGithubDesktopCredentialSession | undefined): { endpoint: DesktopEndpoint; searches: unknown[] } => {
        const searches: unknown[] = [];
        const instance = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(instance, {
            auth: { authenticate: () => skip, resolveUserLogin: () => '_dev', logSecurityEvent: () => undefined },
            desktopCredential,
            pullRequestSearch: {
                search: (options: unknown) => {
                    searches.push(options);
                    return Promise.resolve({ pullRequests: [], page: 1, hasMore: false, signedIn: true });
                },
            },
        });
        return { endpoint: instance as unknown as DesktopEndpoint, searches };
    };

    it('searches pull requests with the gh credential and the gh login on the desktop', async () => {
        const { session } = setup({ QAAP_DESKTOP: '1' });
        const { endpoint, searches } = createEndpoint(session);
        const { res } = makeRes();
        await endpoint.handleSearchGithubPullRequests({ query: { view: 'created' }, headers: {} }, res);
        expect(res.statusCode).to.equal(200);
        expect(searches).to.have.length(1);
        expect(searches[0]).to.include({ accessToken: GH_TOKEN_VALUE, login: 'octo' });
        expect(JSON.stringify(res.body)).not.to.contain(GH_TOKEN_VALUE);
    });

    it('keeps the skip-auth answers on any backend that is not the desktop app', async () => {
        const { resolver, session } = setup({ QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice', QAAP_DESKTOP: '1' });
        const { endpoint, searches } = createEndpoint(session);
        const search = makeRes();
        await endpoint.handleSearchGithubPullRequests({ query: {}, headers: {} }, search.res);
        expect(searches).to.deep.equal([]);
        expect(search.res.body).to.deep.include({ pullRequests: [], signedIn: true });
        const byBranch = makeRes();
        await endpoint.handleGithubPullRequestByBranch({ query: { owner: 'o', repo: 'r', branch: 'main' }, headers: {} }, byBranch.res);
        expect(byBranch.res.statusCode).to.equal(503);
        expect(resolver.ghCalls).to.equal(0);
    });

    it('keeps "sign in required" for the pull request tab on the desktop without a credential', async () => {
        const { resolver, session } = setup({ QAAP_DESKTOP: '1' });
        resolver.ghOutcome = { kind: 'missing' };
        const { endpoint } = createEndpoint(session);
        const { res } = makeRes();
        await endpoint.handleGithubPullRequestByBranch({ query: { owner: 'o', repo: 'r', branch: 'main' }, headers: {} }, res);
        expect(res.statusCode).to.equal(503);
    });

    it('reports the connected GitHub user and source in /auth/session, never the token', async () => {
        const { session } = setup({ QAAP_DESKTOP: '1' });
        const { endpoint } = createEndpoint(session);
        const { res, done } = makeRes();
        endpoint.handleAuthSession({ headers: {} }, res);
        await done;
        const body = res.body as { signedIn: boolean; user: { login: string }; githubCredential?: { source: string; user: { login: string } } };
        expect(body.signedIn).to.equal(true);
        expect(body.user.login).to.equal('dev');
        expect(body.githubCredential).to.deep.equal({ source: 'gh-cli', user: { provider: 'github', login: 'octo', name: 'Octo Cat' } });
        expect(JSON.stringify(body)).not.to.contain(GH_TOKEN_VALUE);
    });

    it('answers /auth/session without a credential field when none is available', async () => {
        const { resolver, session } = setup({ QAAP_DESKTOP: '1' });
        resolver.ghOutcome = { kind: 'missing' };
        const { endpoint } = createEndpoint(session);
        const { res, done } = makeRes();
        endpoint.handleAuthSession({ headers: {} }, res);
        await done;
        expect(res.body).not.to.have.property('githubCredential');
    });
});

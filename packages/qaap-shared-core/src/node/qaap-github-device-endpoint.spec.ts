// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapGithubDeviceFlows } from './qaap-github-device-flow';

/** Minimal Express-like response that records what the handler sent. */
interface FakeResponse {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    redirectedTo?: string;
    status(code: number): FakeResponse;
    json(body: unknown): FakeResponse;
    setHeader(name: string, value: string): void;
    redirect(code: number, url: string): void;
}

function fakeResponse(): FakeResponse {
    const res: FakeResponse = {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(code: number): FakeResponse {
            res.statusCode = code;
            return res;
        },
        json(body: unknown): FakeResponse {
            res.body = body;
            return res;
        },
        setHeader(name: string, value: string): void {
            res.headers[name] = value;
        },
        redirect(code: number, url: string): void {
            res.statusCode = code;
            res.redirectedTo = url;
        },
    };
    return res;
}

const DESKTOP_KEYS = ['QAAP_DESKTOP', 'QAAP_GITHUB_CLIENT_ID', 'QAAP_GITHUB_CLIENT_SECRET', 'QAAP_OAUTH_PUBLIC_URL'] as const;

describe('QaapGithubOauthEndpoint desktop device flow and sign-in', () => {
    const originalFetch = globalThis.fetch;
    const savedEnv: Record<string, string | undefined> = {};
    let stored: Map<string, { accessToken: string; user: { login: string; name: string; avatarUrl: string; provider: string } }>;
    let githubCalls: string[];
    let githubReplies: Array<Record<string, unknown>>;
    let authSession: { kind: 'skip'; userLogin: string } | { kind: 'unauthorized' } | undefined;

    beforeEach(() => {
        for (const key of DESKTOP_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
        stored = new Map();
        githubCalls = [];
        githubReplies = [];
        authSession = { kind: 'skip', userLogin: '_dev' };
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            githubCalls.push(url);
            if (url === 'https://api.github.com/user') {
                return new Response(JSON.stringify({ login: 'octo', name: 'Octo', avatar_url: 'https://avatars/octo' }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            const body = githubReplies.shift() ?? { error: 'unexpected' };
            return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        for (const key of DESKTOP_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    function createEndpoint(): QaapGithubOauthEndpoint {
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(endpoint, {
            deviceFlows: new QaapGithubDeviceFlows(),
            sessions: {
                createOAuthState: () => 'state-1',
                consumeOAuthState: (state: string | undefined) => state === 'state-1',
                createSession: (value: { accessToken: string; user: { login: string; name: string; avatarUrl: string; provider: string } }) => {
                    const id = `sid-${stored.size + 1}`;
                    stored.set(id, value);
                    return id;
                },
                getSession: (id: string | undefined) => (id ? stored.get(id) : undefined),
                deleteSession: (id: string | undefined) => { if (id) { stored.delete(id); } },
            },
            auth: {
                resolveSessionId: () => undefined,
                authenticate: () => authSession,
                logSecurityEvent: () => undefined,
            },
        });
        return endpoint;
    }

    const sameOriginHeaders = { host: 'localhost:3000', origin: 'http://localhost:3000' };
    const request = (body: unknown, headers: Record<string, string> = sameOriginHeaders): Record<string, unknown> => ({ body, headers });

    type DeviceHandler = { handleDeviceStart(req: unknown, res: unknown): Promise<void>; handleDevicePoll(req: unknown, res: unknown): Promise<void> };

    it('answers 404 for the device routes outside the desktop runtime', async () => {
        const endpoint = createEndpoint() as unknown as DeviceHandler;
        const start = fakeResponse();
        await endpoint.handleDeviceStart(request({}), start);
        expect(start.statusCode).to.equal(404);
        const poll = fakeResponse();
        await endpoint.handleDevicePoll(request({ flowId: 'x' }), poll);
        expect(poll.statusCode).to.equal(404);
        expect(githubCalls).to.deep.equal([]);
    });

    it('refuses cross-site device requests', async () => {
        process.env.QAAP_DESKTOP = '1';
        process.env.QAAP_GITHUB_CLIENT_ID = 'client-1';
        const endpoint = createEndpoint() as unknown as DeviceHandler;
        const res = fakeResponse();
        await endpoint.handleDeviceStart(request({}, { host: 'localhost:3000', origin: 'https://evil.example' }), res);
        expect(res.statusCode).to.equal(403);
        expect(githubCalls).to.deep.equal([]);
    });

    it('explains the missing client id instead of starting a flow', async () => {
        process.env.QAAP_DESKTOP = '1';
        const endpoint = createEndpoint() as unknown as DeviceHandler;
        const res = fakeResponse();
        await endpoint.handleDeviceStart(request({}), res);
        expect(res.statusCode).to.equal(503);
        expect(res.body).to.deep.include({ code: 'github_sign_in_not_configured', error: "GitHub sign-in isn't configured: set QAAP_GITHUB_CLIENT_ID" });
        expect(githubCalls).to.deep.equal([]);
    });

    it('starts a flow and returns the user code without the device code', async () => {
        process.env.QAAP_DESKTOP = '1';
        process.env.QAAP_GITHUB_CLIENT_ID = 'client-1';
        githubReplies.push({ device_code: 'DEVICE-SECRET', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
        const endpoint = createEndpoint() as unknown as DeviceHandler;
        const res = fakeResponse();
        await endpoint.handleDeviceStart(request({}), res);
        expect(res.statusCode).to.equal(200);
        expect(JSON.stringify(res.body)).to.not.include('DEVICE-SECRET');
        expect(res.body).to.deep.include({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5 });
    });

    it('polls through pending and slow_down, then stores the session and sets only the HttpOnly cookie', async () => {
        process.env.QAAP_DESKTOP = '1';
        process.env.QAAP_GITHUB_CLIENT_ID = 'client-1';
        githubReplies.push({ device_code: 'DEVICE-SECRET', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 0 });
        const endpoint = createEndpoint() as unknown as DeviceHandler & { deviceFlows: QaapGithubDeviceFlows };
        const start = fakeResponse();
        await endpoint.handleDeviceStart(request({}), start);
        const flowId = (start.body as { flowId: string }).flowId;
        // Interval is 1 s minimum: the first poll within it is answered pending without GitHub.
        const early = fakeResponse();
        await endpoint.handleDevicePoll(request({ flowId }), early);
        expect(early.body).to.deep.include({ status: 'pending' });
        // Force the flow past its interval without sleeping.
        (endpoint.deviceFlows as unknown as { flows: Map<string, { lastPollAt: number }> }).flows.get(flowId)!.lastPollAt -= 60_000;
        githubReplies.push({ error: 'slow_down' });
        const slow = fakeResponse();
        await endpoint.handleDevicePoll(request({ flowId }), slow);
        expect(slow.body).to.deep.include({ status: 'pending', interval: 6 });
        (endpoint.deviceFlows as unknown as { flows: Map<string, { lastPollAt: number }> }).flows.get(flowId)!.lastPollAt -= 60_000;
        githubReplies.push({ access_token: 'gho_SECRET_TOKEN' });
        const done = fakeResponse();
        await endpoint.handleDevicePoll(request({ flowId }), done);
        expect(done.body).to.deep.equal({ status: 'complete', user: { login: 'octo', name: 'Octo', avatarUrl: 'https://avatars/octo' } });
        expect(JSON.stringify(done.body)).to.not.include('gho_SECRET_TOKEN');
        const cookie = done.headers['Set-Cookie'];
        expect(cookie).to.match(/^qaap_sid=sid-1; /);
        expect(cookie).to.include('HttpOnly');
        expect(cookie).to.include('SameSite=Lax');
        expect(stored.get('sid-1')?.accessToken).to.equal('gho_SECRET_TOKEN');
    });

    it('reports denied and expired flows as their own status', async () => {
        process.env.QAAP_DESKTOP = '1';
        process.env.QAAP_GITHUB_CLIENT_ID = 'client-1';
        const endpoint = createEndpoint() as unknown as DeviceHandler & { deviceFlows: QaapGithubDeviceFlows };
        githubReplies.push({ device_code: 'D', user_code: 'U', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
        const start = fakeResponse();
        await endpoint.handleDeviceStart(request({}), start);
        const flowId = (start.body as { flowId: string }).flowId;
        (endpoint.deviceFlows as unknown as { flows: Map<string, { lastPollAt: number }> }).flows.get(flowId)!.lastPollAt -= 60_000;
        githubReplies.push({ error: 'access_denied' });
        const denied = fakeResponse();
        await endpoint.handleDevicePoll(request({ flowId }), denied);
        expect(denied.body).to.deep.equal({ status: 'denied' });
        const unknown = fakeResponse();
        await endpoint.handleDevicePoll(request({ flowId: 'no-such-flow' }), unknown);
        expect(unknown.body).to.deep.equal({ status: 'expired' });
        expect(stored.size).to.equal(0);
    });

    it('lists repositories as sign-in required in desktop skip mode without a session', async () => {
        process.env.QAAP_DESKTOP = '1';
        const endpoint = createEndpoint() as unknown as { handleGithubRepositories(req: unknown, res: unknown): Promise<void> };
        const res = fakeResponse();
        await endpoint.handleGithubRepositories({ headers: {} }, res);
        expect(res.statusCode).to.equal(401);
        expect(res.body).to.deep.include({ code: 'github_sign_in_required' });
    });

    it('keeps the empty list in skip mode outside the desktop runtime', async () => {
        const endpoint = createEndpoint() as unknown as { handleGithubRepositories(req: unknown, res: unknown): Promise<void> };
        const res = fakeResponse();
        await endpoint.handleGithubRepositories({ headers: {} }, res);
        expect(res.statusCode).to.equal(200);
        expect(res.body).to.deep.equal({ repositories: [] });
    });

    it('refuses to start an import in desktop skip mode without a session', async () => {
        process.env.QAAP_DESKTOP = '1';
        const endpoint = createEndpoint() as unknown as { handleStartWorkspaceJob(req: unknown, res: unknown): void; workspaceJobs: unknown };
        Object.assign(endpoint, { workspaceJobs: { list: () => [] } });
        const res = fakeResponse();
        endpoint.handleStartWorkspaceJob({ body: { kind: 'clone', repository: 'octo/hello' }, headers: {} }, res);
        expect(res.statusCode).to.equal(401);
        expect(res.body).to.deep.include({ code: 'github_sign_in_required' });
    });

    it('writes the session cookie without Secure on http localhost and with Secure only on https', () => {
        const endpoint = createEndpoint() as unknown as { setSessionCookie(res: unknown, id: string): void };
        process.env.QAAP_OAUTH_PUBLIC_URL = 'http://localhost:3000';
        process.env.QAAP_GITHUB_CLIENT_ID = 'client-1';
        const local = fakeResponse();
        endpoint.setSessionCookie(local, 'sid-x');
        expect(local.headers['Set-Cookie']).to.not.include('Secure');
        process.env.QAAP_OAUTH_PUBLIC_URL = 'https://qaaq.example';
        process.env.QAAP_GITHUB_CLIENT_SECRET = 'secret-1';
        const remote = fakeResponse();
        endpoint.setSessionCookie(remote, 'sid-x');
        expect(remote.headers['Set-Cookie']).to.include('; Secure');
    });

    it('keeps the web OAuth callback storing the same session and cookie', async () => {
        process.env.QAAP_GITHUB_CLIENT_ID = 'client-1';
        process.env.QAAP_GITHUB_CLIENT_SECRET = 'secret-1';
        process.env.QAAP_OAUTH_PUBLIC_URL = 'http://localhost:3000';
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === 'https://api.github.com/user') {
                return new Response(JSON.stringify({ login: 'octo', name: 'Octo', avatar_url: 'a' }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return new Response(JSON.stringify({ access_token: 'gho_WEB' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch;
        const endpoint = createEndpoint() as unknown as { handleOAuthCallback(req: unknown, res: unknown): Promise<void> };
        const res = fakeResponse();
        await endpoint.handleOAuthCallback({ query: { code: 'abc', state: 'state-1' }, headers: {} }, res);
        expect(stored.get('sid-1')?.accessToken).to.equal('gho_WEB');
        expect(res.headers['Set-Cookie']).to.match(/HttpOnly/);
        expect(res.redirectedTo).to.include('qaap_oauth=github');
    });
});

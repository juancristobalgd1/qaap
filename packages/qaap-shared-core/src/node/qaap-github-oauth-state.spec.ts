// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapGithubOauthEndpoint } from './qaap-github-oauth-endpoint';
import { QaapGithubSessionStore, type QaapGithubStoredSession } from './qaap-github-session-store';

const PUBLIC_URL = 'https://qaap.203-0-113-7.sslip.io';
const PUBLIC_HOST = 'qaap.203-0-113-7.sslip.io';

/** One backend process: a fresh store loaded from the shared SQLite file. */
class ProcessSessionStore extends QaapGithubSessionStore {
    start(): this {
        this.init();
        return this;
    }

    ageOAuthState(state: string, ms: number): void {
        const store = this.getSqliteStore();
        const record = store.get<{ createdAt: number }>(`oauth:${state}`);
        if (record) {
            store.set(`oauth:${state}`, { ...record, createdAt: record.createdAt - ms });
        }
    }

    protected override installShutdownHandlers(): void { }
}

/** Cookie jar of one browser profile (all its tabs). */
class TestBrowser {
    readonly cookies = new Map<string, string>();

    cookieHeader(): string | undefined {
        return this.cookies.size ? [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') : undefined;
    }

    store(setCookies: string[]): void {
        for (const cookie of setCookies) {
            const [pair] = cookie.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq);
            if (/Max-Age=0(?:;|$)/.test(cookie)) {
                this.cookies.delete(name);
            } else {
                this.cookies.set(name, pair.slice(eq + 1));
            }
        }
    }
}

interface TestResponse {
    location?: string;
    setCookies: string[];
}

class Backend {
    readonly endpoint: QaapGithubOauthEndpoint;
    readonly sessions = new ProcessSessionStore().start();
    readonly exchangedCodes: string[] = [];

    constructor() {
        const exchangedCodes = this.exchangedCodes;
        const sessions = this.sessions;
        this.endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        Object.assign(this.endpoint, {
            sessions,
            auth: {
                resolveSessionId: (req: { headers: { cookie?: string } }) => {
                    const id = /(?:^|;\s*)qaap_sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
                    return id && sessions.getSession(decodeURIComponent(id)) ? decodeURIComponent(id) : undefined;
                },
            },
            endSession: (id: string | undefined) => sessions.deleteSession(id),
            exchangeOAuthCode: async (_config: unknown, code: string): Promise<QaapGithubStoredSession> => {
                exchangedCodes.push(code);
                return { accessToken: `token-${code}`, user: { provider: 'github', login: 'alice', name: 'Alice' } };
            },
        });
    }

    async get(browser: TestBrowser, url: string, host = PUBLIC_HOST): Promise<TestResponse> {
        const parsed = new URL(url, PUBLIC_URL);
        const response: TestResponse = { setCookies: [] };
        const res = {
            append(name: string, value: string) {
                if (name === 'Set-Cookie') {
                    response.setCookies.push(value);
                }
                return res;
            },
            redirect(_status: number, location: string) {
                response.location = location;
            },
            status: () => ({ send: () => undefined }),
        };
        const req = {
            headers: { host, ...(browser.cookieHeader() ? { cookie: browser.cookieHeader() } : {}) },
            query: Object.fromEntries(parsed.searchParams),
        };
        const handler = parsed.pathname.endsWith('/start') ? 'handleOAuthStart' : 'handleOAuthCallback';
        await (this.endpoint as unknown as Record<string, (rq: unknown, rs: unknown) => unknown>)[handler](req, res);
        browser.store(response.setCookies);
        return response;
    }

    /** `/start` → GitHub authorize URL; returns the `state` GitHub will send back. */
    async start(browser: TestBrowser, query = ''): Promise<string> {
        const response = await this.get(browser, `/qaap/oauth/github/start${query}`);
        const state = new URL(response.location!).searchParams.get('state');
        expect(state, 'GitHub authorize redirect').to.be.a('string');
        return state!;
    }

    callback(browser: TestBrowser, state: string, code = 'code'): Promise<TestResponse> {
        return this.get(browser, `/qaap/oauth/github/callback?code=${code}&state=${encodeURIComponent(state)}`);
    }
}

function signedIn(response: TestResponse): boolean {
    return response.location === `${PUBLIC_URL}/?qaap_oauth=github#!empty`;
}

function isAutomaticRetry(response: TestResponse): boolean {
    return response.location === `${PUBLIC_URL}/qaap/oauth/github/start?retry=1`;
}

function failedWithStateLost(response: TestResponse): boolean {
    return response.location === `${PUBLIC_URL}/?qaap_oauth_error=1&qaap_oauth_reason=state_lost#!empty`;
}

describe('QaapGithubOauthEndpoint OAuth state (state_lost)', () => {
    let dir: string;
    const saved: Record<string, string | undefined> = {};
    const env: Record<string, string> = {
        QAAP_GITHUB_CLIENT_ID: 'client',
        QAAP_GITHUB_CLIENT_SECRET: 'secret',
        QAAP_OAUTH_PUBLIC_URL: PUBLIC_URL,
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-oauth-state-'));
        for (const [name, value] of Object.entries({ ...env, QAAP_AUTH_STORE_PATH: path.join(dir, 'sessions.json') })) {
            saved[name] = process.env[name];
            process.env[name] = value;
        }
    });

    afterEach(() => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('signs in when the callback arrives after the backend restarted (deploy)', async () => {
        const browser = new TestBrowser();
        const state = await new Backend().start(browser);
        QaapSqliteConnectionRegistry.shared.closeUnder(dir);
        const restarted = new Backend();
        const response = await restarted.callback(browser, state);
        expect(signedIn(response), response.location).to.equal(true);
        expect(browser.cookies.has('qaap_sid')).to.equal(true);
        expect(restarted.exchangedCodes).to.deep.equal(['code']);
    });

    it('signs in from two tabs that both started the login', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        const tab1 = await backend.start(browser);
        const tab2 = await backend.start(browser);
        expect(signedIn(await backend.callback(browser, tab2, 'code-2'))).to.equal(true);
        expect(signedIn(await backend.callback(browser, tab1, 'code-1'))).to.equal(true);
        expect(backend.exchangedCodes).to.deep.equal(['code-2', 'code-1']);
    });

    it('binds the state cookie to the OAuth paths with attributes that survive the GitHub redirect', async () => {
        const backend = new Backend();
        const response = await backend.get(new TestBrowser(), '/qaap/oauth/github/start');
        expect(response.setCookies).to.have.length(1);
        expect(response.setCookies[0]).to.match(/^qaap_oauth_binding=[A-Za-z0-9_-]{43}; Path=\/qaap\/oauth\/github; HttpOnly; SameSite=Lax; Secure; Max-Age=600$/);
    });

    it('moves /start to the public host first so the cookie is sent to the callback', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        const response = await backend.get(browser, '/qaap/oauth/github/start', '203.0.113.7');
        expect(response.location).to.equal(`${PUBLIC_URL}/qaap/oauth/github/start?canonical=1`);
        expect(browser.cookies.size).to.equal(0);
        const proxied = await backend.get(browser, '/qaap/oauth/github/start?canonical=1', 'theia:4873');
        expect(proxied.location).to.match(/^https:\/\/github\.com\//);
    });

    it('never exchanges a reused state', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        const state = await backend.start(browser);
        expect(signedIn(await backend.callback(browser, state))).to.equal(true);
        const otherBrowser = new TestBrowser();
        const replay = await backend.callback(otherBrowser, state, 'replayed');
        expect(signedIn(replay)).to.equal(false);
        expect(otherBrowser.cookies.has('qaap_sid')).to.equal(false);
        expect(backend.exchangedCodes).to.deep.equal(['code']);
    });

    it('a replayed callback in the browser that already signed in keeps its session', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        const state = await backend.start(browser);
        await backend.callback(browser, state);
        const session = browser.cookies.get('qaap_sid');
        expect(signedIn(await backend.callback(browser, state, 'again'))).to.equal(true);
        expect(browser.cookies.get('qaap_sid')).to.equal(session);
        expect(backend.exchangedCodes).to.deep.equal(['code']);
    });

    it('rejects an expired state without exchanging the code', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        const state = await backend.start(browser);
        backend.sessions.ageOAuthState(state, 11 * 60 * 1000);
        const response = await backend.callback(browser, state);
        expect(isAutomaticRetry(response), response.location).to.equal(true);
        expect(backend.exchangedCodes).to.deep.equal([]);
    });

    it('rejects a state started in another browser (login CSRF)', async () => {
        const backend = new Backend();
        const attacker = new TestBrowser();
        const state = await backend.start(attacker);
        const victim = new TestBrowser();
        const response = await backend.callback(victim, state, 'attacker-code');
        expect(isAutomaticRetry(response), response.location).to.equal(true);
        expect(victim.cookies.has('qaap_sid')).to.equal(false);
        expect(backend.exchangedCodes).to.deep.equal([]);
    });

    it('restarts a lost sign-in automatically once and then signs in', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        const lost = await backend.callback(browser, 'state-lost-by-the-server');
        expect(isAutomaticRetry(lost), lost.location).to.equal(true);
        const retryState = await backend.start(browser, '?retry=1');
        expect(signedIn(await backend.callback(browser, retryState))).to.equal(true);
        expect(browser.cookies.has('qaap_oauth_retry')).to.equal(false);
    });

    it('never loops: a second lost state reports state_lost', async () => {
        const backend = new Backend();
        const browser = new TestBrowser();
        expect(isAutomaticRetry(await backend.callback(browser, 'lost-1'))).to.equal(true);
        await backend.start(browser, '?retry=1');
        const second = await backend.callback(browser, 'lost-2');
        expect(failedWithStateLost(second), second.location).to.equal(true);
        expect(browser.cookies.has('qaap_oauth_retry')).to.equal(false);
    });

    it('never loops when the browser drops every cookie', async () => {
        const backend = new Backend();
        const noCookies = (): TestBrowser => new TestBrowser();
        const first = await backend.callback(noCookies(), await backend.start(noCookies()));
        expect(isAutomaticRetry(first), first.location).to.equal(true);
        const second = await backend.callback(noCookies(), await backend.start(noCookies(), '?retry=1'));
        expect(failedWithStateLost(second), second.location).to.equal(true);
        expect(backend.exchangedCodes).to.deep.equal([]);
    });
});

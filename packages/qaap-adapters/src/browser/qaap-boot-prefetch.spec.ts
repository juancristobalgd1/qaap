// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { fetchQaapProjectSessions, fetchQaapUserAiSettings } from './qaap-github-auth-client';
import { QAAP_BOOT_PREFETCH_MAX_AGE_MS } from './qaap-boot-prefetch';

const PROJECT_SESSIONS = '/qaap/api/github/project-sessions';
const USER_SETTINGS = '/qaap/api/user-settings';

interface PrefetchHost {
    __qaapBootPrefetch?: Record<string, { startedAt: number; response: Promise<Response> } | undefined>;
}

describe('qaap boot prefetch', () => {
    const originalFetch = globalThis.fetch;
    const host = globalThis as PrefetchHost;
    let fetched: string[];

    beforeEach(() => {
        fetched = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            fetched.push(String(input));
            return new Response(JSON.stringify({ sessions: [{ id: 'fresh' }], settings: { source: 'fresh' } }), { status: 200 });
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete host.__qaapBootPrefetch;
    });

    function prefetch(path: string, response: Promise<Response>, startedAt = Date.now()): void {
        host.__qaapBootPrefetch = { ...host.__qaapBootPrefetch, [path]: { startedAt, response } };
    }

    function json(body: unknown, status = 200): Promise<Response> {
        return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }

    it('uses the responses the login gate started with the bundle instead of asking again', async () => {
        prefetch(PROJECT_SESSIONS, json({ sessions: [{ id: 'boot' }] }));
        prefetch(USER_SETTINGS, json({ settings: { source: 'boot' } }));
        expect((await fetchQaapProjectSessions()).sessions).to.deep.equal([{ id: 'boot' }]);
        expect(await fetchQaapUserAiSettings()).to.deep.equal({ source: 'boot' });
        expect(fetched).to.deep.equal([]);
    });

    it('uses a boot response once; later refreshes read the server', async () => {
        prefetch(PROJECT_SESSIONS, json({ sessions: [{ id: 'boot' }] }));
        await fetchQaapProjectSessions();
        expect((await fetchQaapProjectSessions()).sessions).to.deep.equal([{ id: 'fresh' }]);
        expect(fetched).to.deep.equal([PROJECT_SESSIONS]);
    });

    it('reads again when the boot response failed, was not ok, or is stale', async () => {
        prefetch(PROJECT_SESSIONS, Promise.reject(new TypeError('Failed to fetch')));
        expect((await fetchQaapProjectSessions()).sessions).to.deep.equal([{ id: 'fresh' }]);
        prefetch(PROJECT_SESSIONS, json({}, 503));
        expect((await fetchQaapProjectSessions()).sessions).to.deep.equal([{ id: 'fresh' }]);
        prefetch(USER_SETTINGS, json({ settings: { source: 'boot' } }), Date.now() - QAAP_BOOT_PREFETCH_MAX_AGE_MS - 1);
        expect(await fetchQaapUserAiSettings()).to.deep.equal({ source: 'fresh' });
        expect(fetched).to.deep.equal([PROJECT_SESSIONS, PROJECT_SESSIONS, USER_SETTINGS]);
    });

    it('does not wait past the request deadline for a boot response that never completes', async () => {
        prefetch(USER_SETTINGS, new Promise<Response>(() => undefined), Date.now() - 15_000 + 20);
        expect(await fetchQaapUserAiSettings()).to.deep.equal({ source: 'fresh' });
        expect(fetched).to.deep.equal([USER_SETTINGS]);
    });
});

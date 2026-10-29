// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapExternalTaskOptInClient } from './qaap-external-task-opt-in-client';

describe('QaapExternalTaskOptInClient', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const stubFetch = (status: number, body: unknown): void => {
        globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    };

    it('hides the toggle when the server answers { available: false }', async () => {
        stubFetch(200, { available: false, repositories: [] });
        const client = new QaapExternalTaskOptInClient();
        await client.load();
        expect(client.available).to.equal(false);
    });

    it('hides the toggle on a 404 from older servers', async () => {
        stubFetch(404, { error: 'GitHub issue tasks are off.' });
        const client = new QaapExternalTaskOptInClient();
        await client.load();
        expect(client.available).to.equal(false);
    });

    it('lists opted-in repositories case-insensitively when the feature is on', async () => {
        stubFetch(200, { repositories: [{ repository: 'Owner/Repo' }] });
        const client = new QaapExternalTaskOptInClient();
        await client.load();
        expect(client.available).to.equal(true);
        expect(client.isEnabled('owner', 'repo')).to.equal(true);
    });
});

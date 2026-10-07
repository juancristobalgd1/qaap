// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsServiceContext } from './mobile-projects-service-context';

type Timeline = typeof import('./mobile-projects-service-timeline');

// A removed project can linger in hub state (selected project, open transcript) for a render or two.
// Resolving its cwd must not call `/open`: on the server that clones the repository back.
describe('prepareProjectCwdExtracted for a removed project', () => {
    let disableJSDOM: (() => void) | undefined;
    let timeline: Timeline;
    let originalFetch: typeof globalThis.fetch;
    let requests: string[];

    before(() => {
        disableJSDOM = enableJSDOM();
        timeline = require('./mobile-projects-service-timeline');
    });

    after(() => disableJSDOM?.());

    beforeEach(() => {
        requests = [];
        originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            requests.push(String(input));
            return new Response(JSON.stringify({
                repository: { owner: 'acme', name: 'shop', fullName: 'acme/shop' },
                workspaceUri: 'file:///workspace/repos/users/alice/acme/shop',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as typeof globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const githubProject: MobileProjectEntry = {
        id: 'github:acme/shop',
        name: 'shop',
        color: '#000',
        branch: 'main',
        status: 'idle',
        task: '',
        progress: 0,
        agents: [],
        lastActive: '—',
        tokens: '—',
        cost: '—',
        pinned: false,
        isCurrent: false,
        github: { owner: 'acme', name: 'shop', fullName: 'acme/shop' } as MobileProjectEntry['github'],
    };

    const context = (hidden: string[], pending: string[] = []): MobileProjectsServiceContext => ({
        getProjectCwd: () => undefined,
        cwdFromFileUri: (uri: { path: { toString(): string } } | undefined) => uri?.path.toString(),
        readHiddenProjectIds: () => new Set(hidden),
        isProjectRemovalPending: (id: string) => pending.includes(id),
    }) as unknown as MobileProjectsServiceContext;

    it('does not open (clone) a GitHub project the user removed', async () => {
        const cwd = await timeline.prepareProjectCwdExtracted(context(['github:acme/shop']), githubProject);

        expect(cwd).to.equal(undefined);
        expect(requests).to.deep.equal([]);
    });

    it('does not open a GitHub project whose removal is still in flight', async () => {
        const cwd = await timeline.prepareProjectCwdExtracted(context([], ['github:acme/shop']), githubProject);

        expect(cwd).to.equal(undefined);
        expect(requests).to.deep.equal([]);
    });

    it('still opens a GitHub project that was not removed', async () => {
        const cwd = await timeline.prepareProjectCwdExtracted(context([]), githubProject);

        expect(cwd).to.equal('/workspace/repos/users/alice/acme/shop');
        expect(requests).to.have.length(1);
        expect(requests[0]).to.contain('/repositories/acme/shop/open');
    });
});

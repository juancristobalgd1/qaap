// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import type { MobileProjectsServiceContext } from './mobile-projects-service-context';
import type { MobileProjectEntry } from './mobile-projects-types';
import { cwdFromFileUriExtracted } from './mobile-projects-service-timeline';
import { githubCloneOfProjectWorkspace, removeProjectExtracted } from './mobile-projects-service-streaming';
import { readLocalRemovedProjects, writeLocalRemovedProjects } from './mobile-projects-session-cache';

disableImportJSDOM();

const CLONE = '/workspace/repos/users/ana/Acme/Shop';

describe('removeProjectExtracted', () => {

    let disableJSDOM: (() => void) | undefined;
    let originalFetch: typeof fetch;
    let requests: Array<{ url: string; method?: string }>;
    let status: number;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    beforeEach(() => {
        requests = [];
        status = 200;
        originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), method: init?.method });
            return new Response(JSON.stringify(status === 200 ? { deleted: true } : { error: 'Forbidden' }), { status });
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function createContext(): { ctx: MobileProjectsServiceContext; hidden: Set<string>; removedRecents: string[] } {
        const hidden = new Set<string>();
        const removedRecents: string[] = [];
        const ctx = {
            canRemove: () => true,
            readHiddenProjectIds: () => new Set(hidden),
            writeHiddenProjectIds: (ids: Set<string>) => {
                hidden.clear();
                ids.forEach(id => hidden.add(id));
            },
            workspaceService: {
                removeRecentWorkspace: async (uri: string) => { removedRecents.push(uri); },
            },
        } as unknown as MobileProjectsServiceContext;
        (ctx as unknown as { cwdFromFileUri: (uri: URI | undefined) => string | undefined }).cwdFromFileUri = uri => cwdFromFileUriExtracted(ctx, uri);
        return { ctx, hidden, removedRecents };
    }

    function recentCard(path: string): MobileProjectEntry {
        const uri = URI.fromFilePath(path);
        return { id: `recent:${uri.toString()}`, name: 'Shop', uri, isCurrent: false } as MobileProjectEntry;
    }

    it('deletes the clone behind a recent card and hides every alias, so it cannot come back as github:', async () => {
        const { ctx, hidden, removedRecents } = createContext();
        const project = recentCard(CLONE);

        expect(await removeProjectExtracted(ctx, project)).to.equal(true);

        expect(requests).to.deep.equal([{ url: '/qaap/api/github/repositories/Acme/Shop', method: 'DELETE' }]);
        expect([...hidden]).to.include.members([project.id, 'github:Acme/Shop']);
        expect(removedRecents).to.deep.equal([project.uri!.toString()]);
    });

    it('surfaces a backend refusal instead of pretending the project was removed', async () => {
        const { ctx, hidden } = createContext();
        status = 403;

        let error: unknown;
        try {
            await removeProjectExtracted(ctx, recentCard(CLONE));
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Forbidden');
        expect(hidden.size).to.equal(0);
    });

    // Production (juancristobalgd1): the card vyyq_1 of task worktree 733cf503 only got a browser-local hidden
    // id, so it came back on reload. Its removal must be recorded where the server lists it again.
    describe('a task worktree card', () => {
        const WORKTREE = '/tmp/qaap-worktrees/juancristobalgd1/733cf503';
        const VYYQ = '/workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq';
        const worktreeCard = (worktreeSourceCwd?: string): MobileProjectEntry => {
            const uri = URI.fromFilePath(WORKTREE);
            return { id: `ws:${uri.toString()}`, name: 'vyyq_1', uri, isCurrent: false, worktreeSourceCwd } as MobileProjectEntry;
        };

        beforeEach(() => localStorage.clear());

        it('records the removal under its own key on the server when its source is unknown', async () => {
            const { ctx, hidden } = createContext();

            expect(await removeProjectExtracted(ctx, worktreeCard())).to.equal(true);

            expect(requests).to.deep.equal([{ url: '/qaap/api/github/worktrees/733cf503', method: 'DELETE' }]);
            expect([...readLocalRemovedProjects()]).to.deep.equal(['worktree:juancristobalgd1/733cf503']);
            expect([...hidden]).to.include(worktreeCard().id);
        });

        it('resolves to its removed source repository, whose delete also forgets the worktree', async () => {
            writeLocalRemovedProjects(new Set(['github:juancristobalgd1/vyyq']));
            const { ctx } = createContext();

            expect(await removeProjectExtracted(ctx, worktreeCard(VYYQ))).to.equal(true);

            expect(requests).to.deep.equal([{ url: '/qaap/api/github/repositories/juancristobalgd1/vyyq', method: 'DELETE' }]);
            expect([...readLocalRemovedProjects()].sort()).to.deep.equal(['github:juancristobalgd1/vyyq', 'worktree:juancristobalgd1/733cf503']);
        });

        it('never deletes a source repository that is still listed', async () => {
            const { ctx } = createContext();

            await removeProjectExtracted(ctx, worktreeCard(VYYQ));

            expect(requests).to.deep.equal([{ url: '/qaap/api/github/worktrees/733cf503', method: 'DELETE' }]);
        });
    });

    it('never maps a sub-folder or a foreign layout to a whole-repository delete', () => {
        const { ctx } = createContext();
        expect(githubCloneOfProjectWorkspace(ctx, recentCard(`${CLONE}/packages/web`))).to.equal(undefined);
        expect(githubCloneOfProjectWorkspace(ctx, recentCard('/home/ana/projects/shop'))).to.equal(undefined);
        expect(githubCloneOfProjectWorkspace(ctx, recentCard('/workspace/repos/users/ana/Acme/..'))).to.equal(undefined);
        expect(githubCloneOfProjectWorkspace(ctx, recentCard(CLONE))).to.deep.equal({ owner: 'Acme', name: 'Shop', fullName: 'Acme/Shop' });
    });
});

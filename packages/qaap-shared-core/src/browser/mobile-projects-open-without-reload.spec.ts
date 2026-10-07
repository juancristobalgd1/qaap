// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { QAAP_AUTH_PROVIDER_KEY, QAAP_AUTH_SIGNED_IN_KEY, QAAP_AUTH_USER_KEY, qaapAuthStorageKey } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { MobileProjectsServiceContext } from './mobile-projects-service-context';
import type { MobileProjectEntry } from './mobile-projects-types';
import { openProjectWithoutReloadExtracted } from './mobile-projects-service-render';
import { QaapWorkspaceService } from './qaap-workspace-service';

disableImportJSDOM();

const OWN_CLONE = new URI('file:///workspace/repos/users/jcristgd/leoMirandaa/shadcn-landing-page');
const OTHER_LOGIN_CLONE = new URI('file:///workspace/repos/users/juancristobalgd1/leoMirandaa/shadcn-landing-page');

interface Harness {
    readonly ctx: MobileProjectsServiceContext;
    readonly openedInPlace: string[];
    readonly backendOpens: string[];
    /** Answers the pending backend open (`POST …/open`: fetch, then the clone path). */
    answerBackend(workspaceUri: URI): void;
}

function harness(): Harness {
    const openedInPlace: string[] = [];
    const backendOpens: string[] = [];
    let answer: (response: Response) => void = () => undefined;
    const workspaceService = Object.assign(Object.create(QaapWorkspaceService.prototype) as QaapWorkspaceService, {
        openWithoutReload: async (uri: URI): Promise<boolean> => {
            openedInPlace.push(uri.toString());
            return true;
        },
    });
    Object.defineProperty(workspaceService, 'opened', { get: () => openedInPlace.length > 0 });
    const fetchStub = (input: RequestInfo | URL): Promise<Response> => {
        backendOpens.push(String(input));
        return new Promise(resolve => { answer = resolve; });
    };
    window.fetch = fetchStub;
    globalThis.fetch = fetchStub;
    const ctx = {
        workspaceService,
        readHiddenProjectIds: (): Set<string> => new Set(),
        writeHiddenProjectIds: (): void => undefined,
        touchGithubRepositoryActivity: (): void => undefined,
        touchProjectActivity: (): void => undefined,
    } as unknown as MobileProjectsServiceContext;
    return {
        ctx,
        openedInPlace,
        backendOpens,
        answerBackend: (workspaceUri: URI): void => answer(new Response(JSON.stringify({
            workspaceUri: workspaceUri.toString(),
            repository: { fullName: 'leoMirandaa/shadcn-landing-page', owner: 'leoMirandaa', name: 'shadcn-landing-page' },
        }), { status: 200 })),
    };
}

function githubProject(uri: URI): MobileProjectEntry {
    return {
        id: 'github:leoMirandaa/shadcn-landing-page',
        uri,
        github: { owner: 'leoMirandaa', name: 'shadcn-landing-page' },
    } as MobileProjectEntry;
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

describe('openProjectWithoutReloadExtracted', () => {

    let disableJSDOM: () => void;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        localStorage.setItem(qaapAuthStorageKey(QAAP_AUTH_SIGNED_IN_KEY), 'true');
        localStorage.setItem(qaapAuthStorageKey(QAAP_AUTH_PROVIDER_KEY), JSON.stringify('github'));
        localStorage.setItem(qaapAuthStorageKey(QAAP_AUTH_USER_KEY), JSON.stringify({ provider: 'github', login: 'jcristgd', name: 'jcristgd' }));
    });

    afterEach(() => {
        localStorage.clear();
        globalThis.fetch = originalFetch;
        disableJSDOM();
    });

    it("opens the login's own clone at once and fetches it in the background (prod 2026-10-06: tree ~22 s)", async () => {
        const h = harness();
        const opened = await openProjectWithoutReloadExtracted(h.ctx, githubProject(OWN_CLONE));
        expect(opened).to.equal(true);
        expect(h.openedInPlace).to.deep.equal([OWN_CLONE.toString()]);
        // The repository open (fetch) is still requested, but nothing waits for it.
        expect(h.backendOpens).to.have.length(1);
    });

    it("waits for the backend's clone path when the cached entry names another login's folder", async () => {
        const h = harness();
        const done = openProjectWithoutReloadExtracted(h.ctx, githubProject(OTHER_LOGIN_CLONE));
        await flush();
        expect(h.openedInPlace).to.deep.equal([]);
        h.answerBackend(OWN_CLONE);
        expect(await done).to.equal(true);
        expect(h.openedInPlace).to.deep.equal([OWN_CLONE.toString()]);
    });
});

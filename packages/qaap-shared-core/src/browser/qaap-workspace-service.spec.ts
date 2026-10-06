// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { QaapWorkspaceService } from './qaap-workspace-service';
import { clearPreferDesktopIde, markPreferDesktopIde } from '../common/qaap-mobile-work-surface-preference';

disableImportJSDOM();

const REPO = new URI('file:///workspace/repos/users/alice/acme/shadcn-landing-page');
const README = REPO.resolve('README.md');
/** The backend's most recent workspace: shared by every page of the process. */
const OTHER = new URI('file:///workspace/repos/users/alice/acme/vitesse-lite');

class TestWorkspaceService extends QaapWorkspaceService {
    reloads = 0;
    mostRecent: string[] = [];

    constructor(open?: FileStat) {
        super();
        this._workspace = open;
        Object.assign(this, {
            fileService: {
                resolve: async (uri: URI): Promise<FileStat> => {
                    if (uri.isEqual(REPO)) {
                        return FileStat.dir(REPO);
                    }
                    if (uri.isEqual(README)) {
                        return { resource: README, name: 'README.md', isFile: true, isDirectory: false, isSymbolicLink: false, isReadonly: false };
                    }
                    throw new Error(`not found: ${uri}`);
                },
            },
            server: {
                getMostRecentlyUsedWorkspace: async (): Promise<string> => OTHER.toString(),
                setMostRecentlyUsedWorkspace: async (uri: string): Promise<void> => { this.mostRecent.push(uri); },
            },
            windowService: { reload: (): void => { this.reloads++; } },
        });
        this._ready.resolve();
    }

    defaultWorkspaceUri(): Promise<string | undefined> {
        return this.getDefaultWorkspaceUri();
    }

    /** What upstream `doInit` does with the default workspace URI. */
    async start(): Promise<void> {
        await this.setWorkspace(await this.toFileStat(await this.getDefaultWorkspaceUri()));
    }

    protected override updateTitle(): void { }

    protected override watchRoots(): Promise<void> {
        return Promise.resolve();
    }
}

describe('QaapWorkspaceService.openWithoutReload', () => {

    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => disableJSDOM());

    it('opens the project on a page without a workspace in place: roots change, no reload (prod 2026-10-06 hub at /)', async () => {
        const service = new TestWorkspaceService();
        const changes: string[][] = [];
        service.onWorkspaceChanged(roots => changes.push(roots.map(root => root.resource.toString())));

        expect(await service.openWithoutReload(REPO)).to.equal(true);

        expect(service.reloads).to.equal(0);
        expect(service.opened).to.equal(true);
        expect(service.workspace?.resource.toString()).to.equal(REPO.toString());
        expect((await service.roots).map(root => root.resource.toString())).to.deep.equal([REPO.toString()]);
        expect(changes).to.deep.equal([[REPO.toString()]]);
        // F5 restores the same workspace, like after an upstream open.
        expect(decodeURI(window.location.hash)).to.equal(`#${REPO.path.toString()}`);
        expect(service.mostRecent).to.deep.equal([REPO.toString()]);
    });

    it('leaves an open workspace alone: switching workspaces still needs the upstream reload', async () => {
        const other = FileStat.dir(new URI('file:///workspace/repos/users/alice/acme/vitesse-lite'));
        const service = new TestWorkspaceService(other);

        expect(await service.openWithoutReload(REPO)).to.equal(false);

        expect(service.workspace).to.equal(other);
        expect(service.mostRecent).to.deep.equal([]);
    });

    it('refuses a file or a missing folder so the caller falls back to the regular open', async () => {
        const service = new TestWorkspaceService();

        expect(await service.openWithoutReload(README)).to.equal(false);
        expect(await service.openWithoutReload(REPO.resolve('missing'))).to.equal(false);

        expect(service.opened).to.equal(false);
        expect(service.reloads).to.equal(0);
    });
});

describe('QaapWorkspaceService default workspace', () => {

    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        clearPreferDesktopIde();
        disableJSDOM();
    });

    it('a desktop Work Hub at / starts without the backend\'s most recent workspace, and leaves it to other pages', async () => {
        // Prod 2026-10-06: with that implicit workspace the IDE tab on another project reloaded.
        const service = new TestWorkspaceService();
        expect(await service.defaultWorkspaceUri()).to.equal(undefined);
        await service.start();
        expect(service.opened).to.equal(false);
        expect(service.mostRecent).to.deep.equal([]);

        expect(await service.openWithoutReload(REPO)).to.equal(true);
        expect(service.reloads).to.equal(0);
    });

    it('F5 after the IDE opened keeps its workspace from the hash', async () => {
        window.location.hash = REPO.path.toString();
        const service = new TestWorkspaceService();
        expect(await service.defaultWorkspaceUri()).to.equal(REPO.toString());
    });

    it('keeps the most recent workspace for the desktop IDE surface', async () => {
        markPreferDesktopIde();
        const service = new TestWorkspaceService();
        expect(await service.defaultWorkspaceUri()).to.equal(OTHER.toString());
    });

    it('keeps the most recent workspace on mobile', async () => {
        window.matchMedia = (query: string) => ({ matches: true, media: query } as MediaQueryList);
        const service = new TestWorkspaceService();
        expect(await service.defaultWorkspaceUri()).to.equal(OTHER.toString());
    });
});

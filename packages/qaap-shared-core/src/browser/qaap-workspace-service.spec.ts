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

disableImportJSDOM();

const REPO = new URI('file:///workspace/repos/users/alice/acme/shadcn-landing-page');
const README = REPO.resolve('README.md');

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
            server: { setMostRecentlyUsedWorkspace: async (uri: string): Promise<void> => { this.mostRecent.push(uri); } },
            windowService: { reload: (): void => { this.reloads++; } },
        });
        this._ready.resolve();
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

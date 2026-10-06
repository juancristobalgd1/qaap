// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { QaapHostedWorkspaceServer } from './qaap-hosted-workspace-server';

const ALICE_REPO = 'file:///workspace/repos/users/alice/acme/shadcn-landing-page';
const BOB_REPO = 'file:///workspace/repos/users/bob/acme/vitesse-lite';

class TestWorkspaceServer extends QaapHostedWorkspaceServer {
    login: string | undefined = 'alice';
    recents: string[] = [];

    constructor(mostRecent: string | undefined) {
        super();
        this.root = new Deferred();
        this.root.resolve(mostRecent);
        Object.assign(this, {
            connections: { getCurrentLogin: (): string | undefined => this.login },
            auth: {
                isSkipAuthEnabled: (): boolean => false,
                loginOwnsWorkspacePath: (login: string, fsPath: string): boolean => fsPath.startsWith(`/workspace/repos/users/${login}/`),
            },
        });
    }

    override async getRecentWorkspaces(): Promise<string[]> {
        return this.recents;
    }
}

describe('QaapHostedWorkspaceServer.getMostRecentlyUsedWorkspace', () => {

    it("returns the asking login's own repository", async () => {
        const server = new TestWorkspaceServer(ALICE_REPO);
        expect(await server.getMostRecentlyUsedWorkspace()).to.equal(ALICE_REPO);
    });

    it("never hands out another login's repository; falls back to the login's own most recent one", async () => {
        const server = new TestWorkspaceServer(BOB_REPO);
        server.recents = [ALICE_REPO];
        expect(await server.getMostRecentlyUsedWorkspace()).to.equal(ALICE_REPO);
        server.recents = [];
        expect(await server.getMostRecentlyUsedWorkspace()).to.equal(undefined);
    });

    it('never suggests the workspace container', async () => {
        const server = new TestWorkspaceServer('file:///workspace');
        expect(await server.getMostRecentlyUsedWorkspace()).to.equal(undefined);
    });

    it('keeps the explicit "no workspace" signal', async () => {
        const server = new TestWorkspaceServer('');
        server.recents = [ALICE_REPO];
        expect(await server.getMostRecentlyUsedWorkspace()).to.equal('');
    });
});

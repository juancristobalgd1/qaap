// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapShellExecutionServerImpl } from './qaap-shell-execution-server-impl';
import { QaapWebsocketAuthRegistry } from '@theia/qaap-cloud-workspace/lib/node/qaap-websocket-auth-registry';

class TestShellExecutionServer extends QaapShellExecutionServerImpl {
    allowed(cwd: string, owner: string): boolean {
        return this.isAllowedTenantCwd(cwd, owner);
    }
}

describe('QaapShellExecutionServerImpl hosted isolation', () => {
    const previousEnv = process.env;
    let root: string;
    let aliceRepo: string;
    let bobRepo: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-shell-tenant-'));
        aliceRepo = path.join(root, 'users', 'alice', 'acme', 'app');
        bobRepo = path.join(root, 'users', 'bob', 'acme', 'app');
        fs.mkdirSync(aliceRepo, { recursive: true });
        fs.mkdirSync(bobRepo, { recursive: true });
        process.env = {
            ...previousEnv,
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_REPOS_ROOT: root,
        };
    });

    afterEach(() => {
        process.env = previousEnv;
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('allows only the authenticated tenant repository tree', () => {
        const server = new TestShellExecutionServer();
        expect(server.allowed(aliceRepo, 'alice')).to.equal(true);
        expect(server.allowed(bobRepo, 'alice')).to.equal(false);
        expect(server.allowed(root, 'alice')).to.equal(false);
    });

    it('rejects an unauthenticated hosted shell request before spawning', async () => {
        const server = new TestShellExecutionServer();
        const registry = new QaapWebsocketAuthRegistry();
        (server as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        try {
            await server.execute({ command: 'id', workspaceRoot: aliceRepo });
            expect.fail('expected hosted shell execution to require an owner');
        } catch (error) {
            expect(String(error)).to.match(/authenticated tenant/i);
        }
    });
});

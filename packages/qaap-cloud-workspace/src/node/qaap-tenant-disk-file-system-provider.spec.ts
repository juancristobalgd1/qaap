// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { FileSystemProviderErrorCode } from '@theia/filesystem/lib/common/files';
import { QaapTenantDiskFileSystemProvider } from './qaap-tenant-disk-file-system-provider';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

function createProvider(options: {
    login?: string;
    skipAuth?: boolean;
    ownsPath?: (login: string, path: string) => boolean;
}): QaapTenantDiskFileSystemProvider {
    const connections = new QaapWebsocketAuthRegistry();
    if (options.login) {
        connections.runWithLogin(options.login, () => undefined);
    }
    const provider = new QaapTenantDiskFileSystemProvider();
    (provider as unknown as { auth: {
        isSkipAuthEnabled: () => boolean;
        loginOwnsWorkspacePath: (login: string, path: string) => boolean;
    } }).auth = {
        isSkipAuthEnabled: () => options.skipAuth ?? false,
        loginOwnsWorkspacePath: (login, path) => options.ownsPath?.(login, path) ?? path.includes(`/users/${login}/`),
    };
    (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = connections;
    (provider as unknown as { reposRoot: string }).reposRoot = '/workspace/repos';
    return provider;
}

async function expectForbidden(run: () => Promise<unknown>): Promise<void> {
    try {
        await run();
        expect.fail('expected forbidden');
    } catch (err) {
        expect((err as { code?: string }).code).to.equal(FileSystemProviderErrorCode.NoPermissions);
    }
}

describe('QaapTenantDiskFileSystemProvider', () => {
    it('blocks hosted container paths for the active login', async () => {
        const provider = createProvider({ login: 'alice' });
        await expectForbidden(() => provider.stat(new URI('file:///workspace')));
    });

    it('blocks cross-tenant repository paths even when another user is connected', async () => {
        const registry = new QaapWebsocketAuthRegistry();
        registry.bindSocketLogin('socket-alice', 'alice');
        registry.bindSocketLogin('socket-bob', 'bob');
        const provider = createProvider({
            login: 'alice',
            ownsPath: (login, path) => path.includes(`/users/${login}/`),
        });
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        await registry.runWithLogin('alice', async () => {
            await expectForbidden(() => provider.stat(new URI('file:///workspace/repos/users/bob/acme/demo/package.json')));
        });
    });

    it('accepts owned repository paths for the active login scope', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const provider = createProvider({
            ownsPath: (login, path) => path.includes(`/users/${login}/`),
        });
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        const uri = new URI('file:///workspace/repos/users/alice/acme/demo/package.json');
        registry.runWithLogin('alice', () => {
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(uri)).to.not.throw();
        });
    });

    it('denies managed paths when no login is in scope', () => {
        const provider = createProvider({});
        expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(
            new URI('file:///workspace/repos/users/alice/acme/demo/package.json'),
        )).to.throw();
    });

    it('allows system paths outside the managed workspace tree without login', () => {
        const provider = createProvider({});
        expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(
            new URI('file:///app/plugins/vscode.theme-monokai/package.json'),
        )).to.not.throw();
        expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(
            new URI('file:///root/.qaap/agent-conversations/index.json'),
        )).to.not.throw();
    });
});

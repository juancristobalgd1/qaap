// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import * as os from 'os';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { FileSystemProviderErrorCode } from '@theia/filesystem/lib/common/files';
import { QaapTenantDiskFileSystemProvider } from './qaap-tenant-disk-file-system-provider';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';
import { resolveQaapTenantConfigDir } from './qaap-tenant-config-scope';
import { resolveQaapParallelRoot, resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

function normalizedPath(fsPath: string): string {
    return fsPath.replace(/\\/g, '/');
}

function ownsTenantPath(login: string, fsPath: string): boolean {
    return normalizedPath(fsPath).includes(`/users/${login}/`);
}

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
        loginOwnsWorkspacePath: (login, fsPath) => options.ownsPath?.(login, fsPath) ?? ownsTenantPath(login, fsPath),
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

    it('reports a forbidden path as a rejected promise, never a synchronous throw', async () => {
        const provider = createProvider({});
        const uri = new URI('file:///root/.theia/backend-settings.json');
        let pending: Promise<unknown> | undefined;
        expect(() => { pending = provider.readFile(uri); }).not.to.throw();
        await expectForbidden(() => pending!);
        await expectForbidden(() => provider.stat(uri));
        await expectForbidden(() => provider.writeFile(uri, new Uint8Array(), { create: true, overwrite: true }));
    });

    it('blocks cross-tenant repository paths even when another user is connected', async () => {
        const registry = new QaapWebsocketAuthRegistry();
        registry.bindSocketLogin('socket-alice', 'alice');
        registry.bindSocketLogin('socket-bob', 'bob');
        const provider = createProvider({
            login: 'alice',
            ownsPath: ownsTenantPath,
        });
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        await registry.runWithLogin('alice', async () => {
            await expectForbidden(() => provider.stat(new URI('file:///workspace/repos/users/bob/acme/demo/package.json')));
        });
    });

    it('accepts owned repository paths for the active login scope', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const provider = createProvider({
            ownsPath: ownsTenantPath,
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

    it('allows only the active tenant to access its Theia user-storage tree', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const provider = createProvider({});
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        const aliceConfig = FileUri.create(path.join(resolveQaapTenantConfigDir('alice'), 'settings.json'));
        registry.runWithLogin('alice', () => {
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(aliceConfig)).to.not.throw();
        });
    });

    it('blocks a tenant from another tenant Theia user-storage tree', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const provider = createProvider({});
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        const bobConfig = FileUri.create(path.join(resolveQaapTenantConfigDir('bob'), 'settings.json'));
        registry.runWithLogin('alice', () => {
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(bobConfig)).to.throw();
        });
    });

    it('blocks system paths outside the tenant allowlist', () => {
        const provider = createProvider({});
        expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(
            new URI('file:///app/plugins/vscode.theme-monokai/package.json'),
        )).to.throw();
        expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(
            new URI('file:///root/.qaap/agent-conversations/index.json'),
        )).to.throw();
    });

    it('allows a dedicated tenant backend to initialize its private Theia config without a socket', () => {
        const previous = process.env.QAAP_TENANT_BACKEND_MODE;
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        try {
            const provider = createProvider({});
            const config = FileUri.create(path.join(os.homedir(), '.theia', 'backend-settings.json'));
            expect(() => (provider as unknown as { assertAllowed(uri: URI, access?: 'read' | 'write'): void })
                .assertAllowed(config, 'write')).to.not.throw();
        } finally {
            if (previous === undefined) {
                delete process.env.QAAP_TENANT_BACKEND_MODE;
            } else {
                process.env.QAAP_TENANT_BACKEND_MODE = previous;
            }
        }
    });

    it('allows reading bundled skills but never allows a tenant to modify them', () => {
        const previous = process.env.QAAP_SYSTEM_SKILLS_DIR;
        process.env.QAAP_SYSTEM_SKILLS_DIR = '/opt/qaap/system-skills';
        try {
            const registry = new QaapWebsocketAuthRegistry();
            const provider = createProvider({});
            (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
            const skill = new URI('file:///opt/qaap/system-skills/review/SKILL.md');
            registry.runWithLogin('alice', () => {
                expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(skill)).to.not.throw();
                expect(() => (provider as unknown as { assertAllowed(uri: URI, access: 'read' | 'write'): void })
                    .assertAllowed(skill, 'write')).to.throw();
            });
        } finally {
            if (previous === undefined) {
                delete process.env.QAAP_SYSTEM_SKILLS_DIR;
            } else {
                process.env.QAAP_SYSTEM_SKILLS_DIR = previous;
            }
        }
    });

    it('allows only the active tenant worktree and parallel-run roots', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const provider = createProvider({});
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        const worktree = FileUri.create(path.join(resolveQaapWorktreesRoot(), 'alice', 'run-1', 'src', 'index.ts'));
        const parallel = FileUri.create(path.join(resolveQaapParallelRoot(), 'alice', 'run-1', 'variant-a', 'src', 'index.ts'));
        registry.runWithLogin('alice', () => {
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(worktree)).to.not.throw();
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(parallel)).to.not.throw();
        });
    });

    it('blocks another tenant worktree and parallel-run roots', () => {
        const registry = new QaapWebsocketAuthRegistry();
        const provider = createProvider({});
        (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
        const bobWorktree = FileUri.create(path.join(resolveQaapWorktreesRoot(), 'bob', 'run-1', 'src', 'index.ts'));
        const bobParallel = FileUri.create(path.join(resolveQaapParallelRoot(), 'bob', 'run-1', 'variant-a', 'src', 'index.ts'));
        registry.runWithLogin('alice', () => {
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(bobWorktree)).to.throw();
            expect(() => (provider as unknown as { assertAllowed(uri: URI): void }).assertAllowed(bobParallel)).to.throw();
        });
    });
});

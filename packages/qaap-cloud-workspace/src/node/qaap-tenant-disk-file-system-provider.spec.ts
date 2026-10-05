// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import * as os from 'os';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { Container } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { ILogger } from '@theia/core/lib/common/logger';
import { EncodingService } from '@theia/core/lib/common/encoding-service';
import { FileSystemProvider, FileSystemProviderErrorCode } from '@theia/filesystem/lib/common/files';
import { FileSystemProviderServer } from '@theia/filesystem/lib/common/remote-file-system-provider';
import { FileSystemWatcherServer } from '@theia/filesystem/lib/common/filesystem-watcher-protocol';
import { DiskFileSystemProvider } from '@theia/filesystem/lib/node/disk-file-system-provider';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { bindQaapTenantDiskFileSystemProvider, QaapTenantDiskFileSystemProvider } from './qaap-tenant-disk-file-system-provider';
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

    it('allows a tenant task to access its repository without browser RPC login context', () => {
        const keys = ['QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_LOGIN', 'QAAP_TENANT_CONFIG_ROOT'] as const;
        const previous = keys.map(key => process.env[key]);
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_LOGIN = 'alice';
        process.env.QAAP_TENANT_CONFIG_ROOT = path.join(os.tmpdir(), 'qaap-fs-guard-config-root');
        try {
            const registry = new QaapWebsocketAuthRegistry();
            const provider = createProvider({ ownsPath: ownsTenantPath });
            (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
            const guard = provider as unknown as { assertAllowed(uri: URI, access?: 'read' | 'write'): void };
            registry.runWithLogin(undefined, () => {
                const taskFile = FileUri.create('/workspace/repos/users/alice/acme/demo/task.py');
                expect(() => guard.assertAllowed(taskFile)).not.to.throw();
                expect(() => guard.assertAllowed(taskFile, 'write')).not.to.throw();
                expect(() => guard.assertAllowed(FileUri.create('/workspace/repos/users/bob/acme/demo/task.py')))
                    .to.throw(/Forbidden workspace path/);
            });
        } finally {
            keys.forEach((key, index) => {
                if (previous[index] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[index];
                }
            });
        }
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

    it('allows reading deployed extension code but not writing it, nor reading plugin storage', () => {
        const keys = ['THEIA_CONFIG_DIR', 'THEIA_PLUGINS_DIR'] as const;
        const previous = keys.map(key => process.env[key]);
        const configDir = path.join(os.tmpdir(), 'qaap-fs-guard-config');
        const pluginsDir = path.join(os.tmpdir(), 'qaap-fs-guard-plugins');
        process.env.THEIA_CONFIG_DIR = configDir;
        process.env.THEIA_PLUGINS_DIR = pluginsDir;
        try {
            const registry = new QaapWebsocketAuthRegistry();
            const provider = createProvider({});
            (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
            const guard = provider as unknown as { assertAllowed(uri: URI, access?: 'read' | 'write'): void };
            const deployed = FileUri.create(path.join(configDir, 'deployedPlugins', 'ms-python.python', 'package.json'));
            const bundled = FileUri.create(path.join(pluginsDir, 'ms-python.python', 'extension', 'package.json'));
            const storage = FileUri.create(path.join(configDir, 'globalStorage', 'ms-python.python', 'state.json'));
            registry.runWithLogin('alice', () => {
                expect(() => guard.assertAllowed(deployed)).to.not.throw();
                expect(() => guard.assertAllowed(bundled)).to.not.throw();
                expect(() => guard.assertAllowed(deployed, 'write')).to.throw();
                expect(() => guard.assertAllowed(storage)).to.throw(/Forbidden workspace path: .*globalStorage/);
            });
            // Never without an authenticated connection.
            expect(() => guard.assertAllowed(deployed)).to.throw();
        } finally {
            keys.forEach((key, index) => {
                if (previous[index] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[index];
                }
            });
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
    describe('watch', () => {
        const upstreamWatch = DiskFileSystemProvider.prototype.watch;
        let watched: string[];

        beforeEach(() => {
            watched = [];
            DiskFileSystemProvider.prototype.watch = function (resource: URI): Disposable {
                watched.push(resource.path.toString());
                return Disposable.NULL;
            };
        });

        afterEach(() => {
            DiskFileSystemProvider.prototype.watch = upstreamWatch;
        });

        it('ignores a plugin watch outside the tenant roots without failing the RPC', () => {
            // The Python extension watches ~/.conda/environments.txt at activation; the frontend
            // never handles a rejected `watch`, so a throw surfaced as a console "forbidden".
            const registry = new QaapWebsocketAuthRegistry();
            const provider = createProvider({});
            (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
            registry.runWithLogin('alice', () => {
                expect(() => provider.watch(new URI('file:///home/theia/.conda'), { recursive: false, excludes: [] })).to.not.throw();
                expect(() => provider.watch(new URI('file:///workspace/repos/users/bob'), { recursive: true, excludes: [] })).to.not.throw();
            });
            expect(watched).to.deep.equal([]);
        });

        it('still watches the tenant own repository and keeps reads of other roots forbidden', async () => {
            const registry = new QaapWebsocketAuthRegistry();
            const provider = createProvider({});
            (provider as unknown as { connections: QaapWebsocketAuthRegistry }).connections = registry;
            registry.runWithLogin('alice', () => {
                provider.watch(new URI('file:///workspace/repos/users/alice/app'), { recursive: true, excludes: [] });
            });
            expect(watched).to.deep.equal(['/workspace/repos/users/alice/app']);
            await registry.runWithLogin('alice', () => expectForbidden(() => provider.stat(new URI('file:///home/theia/.conda'))));
        });
    });
});

describe('QaapTenantDiskFileSystemProvider lifecycle per browser connection', () => {
    interface FakeWatcher {
        client?: { onDidFilesChanged(event: { changes: Array<{ uri: string; type: number }> }): void };
        disposed: boolean;
        setClient(client: FakeWatcher['client']): void;
        watchFileChanges(): Promise<number>;
        unwatchFileChanges(): Promise<void>;
        dispose(): void;
    }

    function createContainer(watchers: FakeWatcher[]): Container {
        const container = new Container();
        // Upstream filesystem bindings this fix interacts with.
        container.bind(DiskFileSystemProvider).toSelf();
        container.bind(FileSystemProvider).toService(DiskFileSystemProvider);
        container.bind(FileSystemProviderServer).toSelf();
        container.bind(FileSystemWatcherServer).toDynamicValue(() => {
            const watcher: FakeWatcher = {
                disposed: false,
                setClient: client => { watcher.client = client; },
                watchFileChanges: async () => 1,
                unwatchFileChanges: async () => undefined,
                dispose: () => { watcher.disposed = true; },
            };
            watchers.push(watcher);
            return watcher;
        });
        container.bind(EncodingService).toSelf().inSingletonScope();
        container.bind(ILogger).toConstantValue({} as ILogger).whenTargetNamed('filesystem:DiskFileSystemProvider');
        container.bind(QaapGithubAuthGuard).toConstantValue({ isSkipAuthEnabled: () => true } as unknown as QaapGithubAuthGuard);
        container.bind(QaapWebsocketAuthRegistry).toSelf().inSingletonScope();
        bindQaapTenantDiskFileSystemProvider(container.bind.bind(container), container.rebind.bind(container));
        return container;
    }

    it('gives every connection its own provider, so closing one keeps the others watching', () => {
        const watchers: FakeWatcher[] = [];
        const container = createContainer(watchers);
        const first = container.get(FileSystemProviderServer);
        const second = container.get(FileSystemProviderServer);
        const firstEvents: string[] = [];
        const secondEvents: string[] = [];
        first.setClient({ notifyDidChangeFile: ({ changes }: { changes: Array<{ resource: string }> }) => firstEvents.push(...changes.map(c => c.resource)) } as never);
        second.setClient({ notifyDidChangeFile: ({ changes }: { changes: Array<{ resource: string }> }) => secondEvents.push(...changes.map(c => c.resource)) } as never);
        expect(watchers).to.have.length(2);
        expect((first as unknown as { provider: unknown }).provider).to.be.instanceOf(QaapTenantDiskFileSystemProvider);
        expect((first as unknown as { provider: unknown }).provider).not.to.equal((second as unknown as { provider: unknown }).provider);

        // Only the connection that owns a watcher sees its events (no cross-tenant broadcast).
        watchers[1].client?.onDidFilesChanged({ changes: [{ uri: 'file:///workspace/repos/users/bob/a.ts', type: 0 }] });
        expect(firstEvents).to.deep.equal([]);
        expect(secondEvents).to.deep.equal(['file:///workspace/repos/users/bob/a.ts']);

        first.dispose();
        expect(watchers[0].disposed).to.equal(true);
        expect(watchers[1].disposed).to.equal(false);
        watchers[1].client?.onDidFilesChanged({ changes: [{ uri: 'file:///workspace/repos/users/bob/b.ts', type: 0 }] });
        expect(secondEvents).to.deep.equal(['file:///workspace/repos/users/bob/a.ts', 'file:///workspace/repos/users/bob/b.ts']);
    });
});

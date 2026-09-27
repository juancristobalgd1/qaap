// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import * as os from 'os';
import { inject, injectable, interfaces } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import {
    isPathUnderUserWorkspace,
    resolveQaapReposRoot,
    resolveQaapParallelRoot,
    resolveQaapWorktreesRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { isRealPathUnder } from '@theia/qaap-shared-core/lib/node/qaap-realpath-guard';
import {
    createFileSystemProviderError,
    FileSystemProvider,
    FileDeleteOptions,
    FileOpenOptions,
    FileOverwriteOptions,
    FileSystemProviderErrorCode,
    FileWriteOptions,
    Stat,
    WatchOptions,
} from '@theia/filesystem/lib/common/files';
import { DiskFileSystemProvider } from '@theia/filesystem/lib/node/disk-file-system-provider';
import { Disposable } from '@theia/core/lib/common/disposable';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';
import {
    isQaapTenantConfigPath,
    resolveQaapTenantUserRoot,
} from './qaap-tenant-config-scope';

/**
 * Defense-in-depth filesystem guard for hosted multi-tenant deployments.
 * Every operation is scoped to the authenticated login of the active RPC connection.
 */
@injectable()
export class QaapTenantDiskFileSystemProvider extends DiskFileSystemProvider {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    @inject(QaapWebsocketAuthRegistry)
    protected readonly connections: QaapWebsocketAuthRegistry;

    protected readonly reposRoot = resolveQaapReposRoot();

    protected assertAllowed(uri: URI, access: 'read' | 'write' = 'read'): void {
        if (this.auth.isSkipAuthEnabled()) {
            return;
        }
        const fsPath = FileUri.fsPath(uri);
        // A dedicated tenant backend must be able to initialize its own Theia preference tree
        // before a browser WebSocket exists. This directory is mounted exclusively into this
        // container; it is not the shared control-plane config and is never reachable directly
        // from another tenant backend.
        if (this.isTenantBackendRuntime()
            && (isQaapTenantConfigPath(fsPath)
                || isRealPathUnder(fsPath, path.join(os.homedir(), '.theia')))) {
            return;
        }
        const login = this.connections.getCurrentLogin();
        if (!login) {
            throw this.forbidden();
        }
        if (isQaapTenantConfigPath(fsPath)) {
            if (!isRealPathUnder(fsPath, resolveQaapTenantUserRoot(login))) {
                throw this.forbidden();
            }
            return;
        }
        const systemSkillsDir = process.env.QAAP_SYSTEM_SKILLS_DIR?.trim();
        if (systemSkillsDir && isRealPathUnder(fsPath, systemSkillsDir)) {
            if (access === 'write') {
                throw this.forbidden();
            }
            return;
        }
        if (!this.isOwnedWorkspaceArtifact(fsPath, login)) {
            throw this.forbidden();
        }
    }

    protected isTenantBackendRuntime(): boolean {
        return /^(1|true)$/i.test(process.env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '');
    }

    /**
     * Authenticated browser sessions may access only tenant-owned workspace artifacts.
     * System paths are deliberately not an exception: this provider is reachable from the browser
     * and must never become a generic backend filesystem reader for `/root`, `/app`, or `/tmp`.
     */
    protected isOwnedWorkspaceArtifact(fsPath: string, login: string): boolean {
        const userRoot = resolveUserReposRoot(this.reposRoot, login);
        if (isPathUnderUserWorkspace(fsPath, this.reposRoot, login)
            && isRealPathUnder(fsPath, userRoot)
            && this.auth.loginOwnsWorkspacePath(login, fsPath)) {
            return true;
        }
        const tenant = safeUserIdSegment(login);
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()]
            .map(root => path.join(root, tenant))
            .some(root => isRealPathUnder(fsPath, root));
    }

    /**
     * Promise-returning operations are `async` so a forbidden path surfaces as a rejected promise
     * (handled by the caller's `.catch`) rather than a synchronous throw that escapes it.
     */
    protected forbidden(): never {
        throw createFileSystemProviderError('Forbidden workspace path', FileSystemProviderErrorCode.NoPermissions);
    }

    override async stat(resource: URI): Promise<Stat> {
        this.assertAllowed(resource);
        return super.stat(resource);
    }

    override async readdir(resource: URI): Promise<[string, import('@theia/filesystem/lib/common/files').FileType][]> {
        this.assertAllowed(resource);
        return super.readdir(resource);
    }

    override async readFile(resource: URI): Promise<Uint8Array> {
        this.assertAllowed(resource);
        return super.readFile(resource);
    }

    override async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
        this.assertAllowed(resource, 'write');
        return super.writeFile(resource, content, opts);
    }

    override async mkdir(resource: URI): Promise<void> {
        this.assertAllowed(resource, 'write');
        return super.mkdir(resource);
    }

    override async delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
        this.assertAllowed(resource, 'write');
        return super.delete(resource, opts);
    }

    override async rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
        this.assertAllowed(from, 'write');
        this.assertAllowed(to, 'write');
        return super.rename(from, to, opts);
    }

    override async copy(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
        this.assertAllowed(from, 'write');
        this.assertAllowed(to, 'write');
        return super.copy(from, to, opts);
    }

    override async access(resource: URI, mode?: number): Promise<void> {
        this.assertAllowed(resource);
        return super.access(resource, mode);
    }

    override async open(resource: URI, opts: FileOpenOptions): Promise<number> {
        this.assertAllowed(resource, opts.create ? 'write' : 'read');
        return super.open(resource, opts);
    }

    override watch(resource: URI, opts: WatchOptions): Disposable {
        this.assertAllowed(resource);
        return super.watch(resource, opts);
    }
}

/**
 * Bind the guarded provider as the browser-reachable `FileSystemProvider`.
 *
 * Transient on purpose, like upstream's `DiskFileSystemProvider`: every browser connection gets its
 * own `RemoteFileSystemServer`, which subscribes to its provider's change events and disposes the
 * provider (and its file watcher) when the connection closes. A shared singleton made the first
 * closed connection dispose the watcher for every other connection, and broadcast each tenant's
 * file-change events to all connected clients.
 */
export function bindQaapTenantDiskFileSystemProvider(bind: interfaces.Bind, rebind: interfaces.Rebind): void {
    bind(QaapTenantDiskFileSystemProvider).toSelf();
    rebind(FileSystemProvider).toService(QaapTenantDiskFileSystemProvider);
}

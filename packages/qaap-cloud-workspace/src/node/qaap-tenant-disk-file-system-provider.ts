// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    isPathUnderUserWorkspace,
    resolveQaapReposRoot,
    resolveUserReposRoot,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { isVpsWorkspaceInfrastructurePath } from '@theia/qaap-mobile-shell/lib/common/qaap-hub-project-eligibility';
import { QaapGithubAuthGuard } from '@theia/qaap-mobile-shell/lib/node/qaap-github-auth-guard';
import { isRealPathUnder } from '@theia/qaap-mobile-shell/lib/node/qaap-realpath-guard';
import {
    createFileSystemProviderError,
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

    protected assertAllowed(uri: URI): void {
        if (this.auth.isSkipAuthEnabled()) {
            return;
        }
        const fsPath = FileUri.fsPath(uri);
        if (isQaapWorkspaceContainerPath(fsPath) || isVpsWorkspaceInfrastructurePath(fsPath)) {
            throw this.forbidden();
        }
        const login = this.connections.getCurrentLogin();
        if (!login) {
            throw this.forbidden();
        }
        if (!this.auth.loginOwnsWorkspacePath(login, fsPath)) {
            throw this.forbidden();
        }
        const userRoot = resolveUserReposRoot(this.reposRoot, login);
        if (!isPathUnderUserWorkspace(fsPath, this.reposRoot, login)) {
            throw this.forbidden();
        }
        if (!isRealPathUnder(fsPath, userRoot)) {
            throw this.forbidden();
        }
    }

    protected forbidden(): never {
        throw createFileSystemProviderError('Forbidden workspace path', FileSystemProviderErrorCode.NoPermissions);
    }

    override stat(resource: URI): Promise<Stat> {
        this.assertAllowed(resource);
        return super.stat(resource);
    }

    override readdir(resource: URI): Promise<[string, import('@theia/filesystem/lib/common/files').FileType][]> {
        this.assertAllowed(resource);
        return super.readdir(resource);
    }

    override readFile(resource: URI): Promise<Uint8Array> {
        this.assertAllowed(resource);
        return super.readFile(resource);
    }

    override writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
        this.assertAllowed(resource);
        return super.writeFile(resource, content, opts);
    }

    override mkdir(resource: URI): Promise<void> {
        this.assertAllowed(resource);
        return super.mkdir(resource);
    }

    override delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
        this.assertAllowed(resource);
        return super.delete(resource, opts);
    }

    override rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
        this.assertAllowed(from);
        this.assertAllowed(to);
        return super.rename(from, to, opts);
    }

    override copy(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
        this.assertAllowed(from);
        this.assertAllowed(to);
        return super.copy(from, to, opts);
    }

    override access(resource: URI, mode?: number): Promise<void> {
        this.assertAllowed(resource);
        return super.access(resource, mode);
    }

    override open(resource: URI, opts: FileOpenOptions): Promise<number> {
        this.assertAllowed(resource);
        return super.open(resource, opts);
    }

    override watch(resource: URI, opts: WatchOptions): Disposable {
        this.assertAllowed(resource);
        return super.watch(resource, opts);
    }
}

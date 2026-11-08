// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { DelegatingFileSystemProvider } from '@theia/filesystem/lib/common/delegating-file-system-provider';
import { FileSystemProvider } from '@theia/filesystem/lib/common/files';
import { UserStorageContribution } from '@theia/userstorage/lib/browser/user-storage-contribution';

/**
 * Upstream's `DelegatingFileSystemProvider.updateFile` is the one method that forwards the
 * `user-storage:` URI without converting it. The backend then resolves `/user/settings.json` instead
 * of the real config file: every incremental settings save fails (the tenant guard answers
 * `Forbidden workspace path`) and only the full-content fallback in `Resource.save` persists it.
 *
 * Convert the URI here. If upstream fixes `updateFile`, the double conversion throws
 * `invalid resource` and `qaap-user-storage-contribution.spec.ts` fails: drop this class then.
 */
@injectable()
export class QaapUserStorageContribution extends UserStorageContribution {

    protected override async createProvider(service: FileService): Promise<FileSystemProvider> {
        const provider = await super.createProvider(service);
        if (provider instanceof DelegatingFileSystemProvider) {
            const updateFile = provider.updateFile.bind(provider);
            provider.updateFile = (resource, changes, options) => updateFile(provider.toUnderlyingResource(resource), changes, options);
        }
        return provider;
    }
}

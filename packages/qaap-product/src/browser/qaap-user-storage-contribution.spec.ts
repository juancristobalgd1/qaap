// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { DelegatingFileSystemProvider } from '@theia/filesystem/lib/common/delegating-file-system-provider';
import { FileSystemProvider, FileSystemProviderCapabilities, FileUpdateResult } from '@theia/filesystem/lib/common/files';
import { QaapUserStorageContribution } from './qaap-user-storage-contribution';

disableJSDOM();

const CONFIG_DIR_URI = 'file:///home/theia/.theia';

class TestableUserStorageContribution extends QaapUserStorageContribution {
    create(service: FileService): Promise<FileSystemProvider> {
        return this.createProvider(service);
    }
}

describe('QaapUserStorageContribution', () => {

    let updatedResources: string[];
    let provider: DelegatingFileSystemProvider;

    beforeEach(async () => {
        updatedResources = [];
        const delegate = {
            capabilities: FileSystemProviderCapabilities.Update,
            onDidChangeCapabilities: new Emitter<void>().event,
            onDidChangeFile: new Emitter<never>().event,
            onFileWatchError: new Emitter<void>().event,
            watch: () => Disposable.NULL,
            updateFile: async (resource: URI): Promise<FileUpdateResult> => {
                updatedResources.push(resource.toString());
                return { encoding: 'utf8' } as FileUpdateResult;
            },
        } as unknown as FileSystemProvider;
        const container = new Container();
        container.bind(EnvVariablesServer).toConstantValue({ getConfigDirUri: async () => CONFIG_DIR_URI } as unknown as EnvVariablesServer);
        container.bind(TestableUserStorageContribution).toSelf();
        const service = { activateProvider: async () => delegate } as unknown as FileService;
        provider = await container.get(TestableUserStorageContribution).create(service) as DelegatingFileSystemProvider;
    });

    it('sends incremental saves to the real config file, not to the user-storage path', async () => {
        await provider.updateFile(new URI('user-storage:/user/settings.json'), [], { readEncoding: 'utf8', writeEncoding: 'utf8', overwriteEncoding: false });
        expect(updatedResources).to.deep.equal([`${CONFIG_DIR_URI}/settings.json`]);
    });

    it('rejects a resource outside user storage instead of forwarding it', () => {
        expect(() => provider.updateFile(new URI('file:///etc/passwd'), [], { readEncoding: 'utf8', writeEncoding: 'utf8', overwriteEncoding: false }))
            .to.throw('invalid resource');
        expect(updatedResources).to.deep.equal([]);
    });
});

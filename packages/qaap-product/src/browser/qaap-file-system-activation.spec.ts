// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Emitter } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileSystemProvider } from '@theia/filesystem/lib/common/files';
import { QaapFileSystemActivation } from './qaap-file-system-activation';

disableJSDOM();

function fakeProvider(): FileSystemProvider {
    return {
        capabilities: 0,
        onDidChangeCapabilities: new Emitter<void>().event,
        onDidChangeFile: new Emitter<never>().event,
        onFileWatchError: new Emitter<void>().event,
    } as unknown as FileSystemProvider;
}

function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<boolean> {
    return Promise.race([promise.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))]);
}

/**
 * Cold-start guard: `QaapHostedPluginSupport.ensureFileSystemActivation` must not hold Theia's own
 * file systems (settings in `user-storage`) until the backend has deployed every plugin.
 */
describe('qaap file system activation', () => {

    let fileService: FileService;
    let pluginsSynced: Deferred<void>;
    let activatedByPlugins: string[];
    let toDispose: Disposable[];

    beforeEach(() => {
        fileService = new FileService();
        pluginsSynced = new Deferred<void>();
        activatedByPlugins = [];
        toDispose = [];
        // What HostedPluginSupport registers: wait for the plugin sync (`willStart`), then activate
        // `onFileSystem:<scheme>`, as upstream's ensureFileSystemActivation does.
        toDispose.push(fileService.onWillActivateFileSystemProvider(event => {
            const pluginActivation = pluginsSynced.promise.then(() => {
                activatedByPlugins.push(event.scheme);
            });
            event.waitUntil(QaapFileSystemActivation.untilProviderOrPlugins(fileService, event.scheme, pluginActivation));
        }));
        // What UserStorageContribution registers: Theia's own provider, created on first use.
        toDispose.push(fileService.onWillActivateFileSystemProvider(event => {
            if (event.scheme === 'user-storage') {
                event.waitUntil((async () => {
                    fileService.registerProvider('user-storage', fakeProvider());
                })());
            }
        }));
    });

    afterEach(() => {
        toDispose.forEach(disposable => disposable.dispose());
    });

    it('activates a Theia-provided scheme while plugins are still deploying', async () => {
        const activation = fileService.activateProvider('user-storage');

        expect(await settlesWithin(activation, 1000), 'user-storage must not wait for the plugin sync').to.equal(true);
        expect(fileService.hasProvider('user-storage')).to.equal(true);
    });

    it('still activates onFileSystem plugins once plugins are synced', async () => {
        await fileService.activateProvider('user-storage');
        expect(activatedByPlugins).to.deep.equal([]);

        pluginsSynced.resolve();
        await pluginsSynced.promise;
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(activatedByPlugins).to.deep.equal(['user-storage']);
    });

    it('waits for the plugin sync when only a plugin can provide the scheme', async () => {
        toDispose.push(fileService.onWillActivateFileSystemProvider(event => {
            if (event.scheme === 'plugin-fs') {
                event.waitUntil(pluginsSynced.promise.then(() => {
                    fileService.registerProvider('plugin-fs', fakeProvider());
                }));
            }
        }));
        const activation = fileService.activateProvider('plugin-fs');

        expect(await settlesWithin(activation, 200)).to.equal(false);
        pluginsSynced.resolve();
        expect(await settlesWithin(activation, 1000)).to.equal(true);
    });
});


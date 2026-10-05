// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Event } from '@theia/core/lib/common/event';

/** The part of `FileService` needed to see a file system provider being registered. */
export interface QaapFileSystemProviderRegistry {
    hasProvider(scheme: string): boolean;
    readonly onDidChangeFileSystemProviderRegistrations: Event<{ added: boolean, scheme: string }>;
}

export namespace QaapFileSystemActivation {

    /**
     * Settles when `pluginActivation` settles or as soon as any provider for `scheme` is
     * registered, whichever comes first. `pluginActivation` keeps running in the background.
     */
    export function untilProviderOrPlugins(registry: QaapFileSystemProviderRegistry, scheme: string, pluginActivation: Promise<unknown>): Promise<void> {
        if (registry.hasProvider(scheme)) {
            return Promise.resolve();
        }
        const toDispose = new DisposableCollection();
        const registered = new Promise<void>(resolve => {
            toDispose.push(registry.onDidChangeFileSystemProviderRegistrations(({ added, scheme: registeredScheme }) => {
                if (added && registeredScheme === scheme) {
                    resolve();
                }
            }));
        });
        return Promise.race([registered, pluginActivation.then(() => undefined)])
            .finally(() => toDispose.dispose());
    }
}

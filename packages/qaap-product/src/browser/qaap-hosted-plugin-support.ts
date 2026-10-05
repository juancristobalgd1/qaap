// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { WaitUntilEvent } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PluginContributions, PluginHost } from '@theia/plugin-ext/lib/hosted/common/hosted-plugin';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { QaapPluginStartGate } from '@theia/qaap-shared-core/lib/browser/qaap-plugin-start-gate';
import { QaapPluginLoadGate } from './qaap-plugin-load-gate';
import { QaapFileSystemActivation } from './qaap-file-system-activation';

/**
 * Upstream holds every file system provider activation until the backend has deployed and the
 * frontend has synced all plugins (`willStart`), because a plugin may provide the scheme. That
 * also held the schemes Theia registers itself, e.g. `user-storage` for the user settings.json:
 * `PreferenceService.ready`, the terminal `initializeLayout` and with it the Work Hub mount waited
 * for plugin deployment on every cold start (59 s on a loaded tenant). Release the activation as
 * soon as any provider for the scheme is registered; plugins listening to `onFileSystem:<scheme>`
 * are still activated once plugins are synced, exactly as upstream.
 *
 * Plugins are only synced, their contributions loaded and the plugin host started once
 * {@link QaapPluginStartGate} is released, i.e. on a page that shows the IDE. Until then the page does
 * not call the plugin server at all, so the backend neither deploys plugins nor forks a plugin host
 * for it; a phone never releases the gate. On release the page asks the backend for plugins
 * explicitly (see {@link QaapPluginLoadGate}) and loads them as upstream.
 */
@injectable()
export class QaapHostedPluginSupport extends HostedPluginSupport {

    @inject(QaapPluginStartGate)
    protected readonly pluginStartGate: QaapPluginStartGate;

    protected loadGate: QaapPluginLoadGate;

    protected override init(): void {
        super.init();
        this.loadGate = new QaapPluginLoadGate(this.pluginStartGate, this.server, () => this.load());
    }

    protected override async syncPlugins(): Promise<void> {
        if (await this.loadGate.beginSync()) {
            return super.syncPlugins();
        }
    }

    /** Without synced plugins, keep restored plugin views for the IDE instead of removing them as stale. */
    protected override async afterLoadContributions(toDisconnect: DisposableCollection): Promise<void> {
        if (this.loadGate.syncHeld) {
            return;
        }
        return super.afterLoadContributions(toDisconnect);
    }

    protected override async startPlugins(contributionsByHost: Map<PluginHost, PluginContributions[]>, toDisconnect: DisposableCollection): Promise<void> {
        if (this.loadGate.syncHeld) {
            return;
        }
        return super.startPlugins(contributionsByHost, toDisconnect);
    }

    protected override ensureFileSystemActivation(event: WaitUntilEvent & { scheme: string }): void {
        let pluginActivation: Promise<unknown> = Promise.resolve();
        super.ensureFileSystemActivation({
            scheme: event.scheme,
            token: event.token,
            waitUntil: (thenable: Promise<unknown>) => {
                pluginActivation = thenable;
            }
        });
        event.waitUntil(QaapFileSystemActivation.untilProviderOrPlugins(this.fileService, event.scheme, pluginActivation));
    }
}

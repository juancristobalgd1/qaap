// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { WaitUntilEvent } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { WillExecuteCommandEvent } from '@theia/core/lib/common/command';
import { PluginContributions, PluginHost } from '@theia/plugin-ext/lib/hosted/common/hosted-plugin';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { QaapPluginStartGate } from '@theia/qaap-shared-core/lib/browser/qaap-plugin-start-gate';
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
 * Plugins are synced and their contributions loaded as upstream, but the plugin host only starts
 * once {@link QaapPluginStartGate} is released: a Work Hub page that opens a project in the IDE
 * reloads into it, and must not boot every plugin twice.
 */
@injectable()
export class QaapHostedPluginSupport extends HostedPluginSupport {

    @inject(QaapPluginStartGate)
    protected readonly pluginStartGate: QaapPluginStartGate;

    protected override async startPlugins(contributionsByHost: Map<PluginHost, PluginContributions[]>, toDisconnect: DisposableCollection): Promise<void> {
        this.pluginStartGate.releaseForBootWorkspace(this.workspaceService.workspace?.resource.path.toString());
        await this.pluginStartGate.whenReleased;
        if (toDisconnect.disposed) {
            return;
        }
        return super.startPlugins(contributionsByHost, toDisconnect);
    }

    /** A plugin command waits for its handler, which only a started plugin host registers. */
    protected override ensureCommandHandlerRegistration(event: WillExecuteCommandEvent): void {
        if (this.contributionHandler.hasCommand(event.commandId) && !this.contributionHandler.hasCommandHandler(event.commandId)) {
            this.pluginStartGate.release();
        }
        super.ensureCommandHandlerRegistration(event);
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

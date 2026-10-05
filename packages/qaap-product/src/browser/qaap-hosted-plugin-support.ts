// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { WaitUntilEvent } from '@theia/core/lib/common/event';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { QaapFileSystemActivation } from './qaap-file-system-activation';

/**
 * Upstream holds every file system provider activation until the backend has deployed and the
 * frontend has synced all plugins (`willStart`), because a plugin may provide the scheme. That
 * also held the schemes Theia registers itself, e.g. `user-storage` for the user settings.json:
 * `PreferenceService.ready`, the terminal `initializeLayout` and with it the Work Hub mount waited
 * for plugin deployment on every cold start (59 s on a loaded tenant). Release the activation as
 * soon as any provider for the scheme is registered; plugins listening to `onFileSystem:<scheme>`
 * are still activated once plugins are synced, exactly as upstream.
 */
@injectable()
export class QaapHostedPluginSupport extends HostedPluginSupport {

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

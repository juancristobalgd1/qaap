// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { CancellationToken } from '@theia/core/lib/common/cancellation';
import {
    PluginDeployOptions,
    PluginType,
} from '@theia/plugin-ext/lib/common/plugin-protocol';
import { PluginServerImpl } from '@theia/plugin-ext/lib/main/node/plugin-server-impl';
import { isLocalPluginArchiveInstallBlocked } from './qaap-local-plugin-archive-policy';

/**
 * Blocks runtime `local-file:` installs (drag/drop VSIX, Install from VSIX) when the
 * untrusted-archive policy is on. Defense-in-depth for GHSA-mp2f-45pm-3cg9 alongside
 * the central @theia/qaap-archive extractor — Open-VSX / build-time download-plugins
 * validate archive paths and links before writing.
 */
@injectable()
export class QaapPluginServerImpl extends PluginServerImpl {

    override async install(
        pluginEntry: string,
        arg2?: PluginType | CancellationToken,
        options?: PluginDeployOptions,
    ): Promise<void> {
        if (isLocalPluginArchiveInstallBlocked(pluginEntry)) {
            throw new Error(
                'Installing local plugin archives (VSIX / local-file:) is disabled. '
                + 'Set QAAP_ALLOW_LOCAL_VSIX=1 to override, or install from the marketplace.',
            );
        }
        return super.install(pluginEntry, arg2, options);
    }
}

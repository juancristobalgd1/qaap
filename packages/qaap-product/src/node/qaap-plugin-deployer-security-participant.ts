// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import {
    PluginDeployerParticipant,
    PluginDeployerStartContext,
} from '@theia/plugin-ext/lib/common/plugin-protocol';
import {
    isLocalPluginArchivePolicyEnabled,
    LOCAL_PLUGIN_FILE_SCHEME_PREFIX,
} from './qaap-local-plugin-archive-policy';

/**
 * Strips drop-in `local-file:` entries discovered under the user extensions dir before
 * deployment starts. Complements {@link QaapPluginServerImpl} which covers RPC installs.
 */
@injectable()
export class QaapPluginDeployerSecurityParticipant implements PluginDeployerParticipant {

    async onWillStart(context: PluginDeployerStartContext): Promise<void> {
        if (!isLocalPluginArchivePolicyEnabled()) {
            return;
        }
        let removed = 0;
        for (let i = context.userEntries.length - 1; i >= 0; i--) {
            if (context.userEntries[i].startsWith(LOCAL_PLUGIN_FILE_SCHEME_PREFIX)) {
                context.userEntries.splice(i, 1);
                removed++;
            }
        }
        if (removed > 0) {
            console.warn(
                `[qaap] Blocked ${removed} local-file: drop-in plugin entr${removed === 1 ? 'y' : 'ies'} `
                + '(QAAP_ALLOW_LOCAL_VSIX=1 to allow).',
            );
        }
    }
}

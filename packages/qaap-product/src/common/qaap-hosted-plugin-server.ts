// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { HostedPluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';

/**
 * The per-connection hosted plugin server with an explicit opt-in: the tenant backend deploys
 * plugins and forks a plugin host only for a frontend that asked for them (an IDE page). Other
 * callers of {@link HostedPluginServer.getDeployedPluginIds} (e.g. the extensions view model on a
 * Work Hub page) wait for that request instead of triggering deployment themselves.
 */
export interface QaapHostedPluginServer extends HostedPluginServer {
    /** Starts plugin deployment (once per backend) and lets this connection sync and host plugins. */
    requestPlugins(): Promise<void>;
}

export namespace QaapHostedPluginServer {
    /** Asks the backend for plugins through a frontend proxy typed as the upstream {@link HostedPluginServer}. */
    export function requestPlugins(server: HostedPluginServer): Promise<void> {
        const qaapServer: Partial<QaapHostedPluginServer> = server;
        if (typeof qaapServer.requestPlugins !== 'function') {
            return Promise.reject(new Error('The hosted plugin server does not accept plugin requests.'));
        }
        return qaapServer.requestPlugins();
    }
}

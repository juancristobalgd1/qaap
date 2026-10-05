// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { PluginIdentifiers } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin';
import { HostedPluginServerImpl } from '@theia/plugin-ext/lib/hosted/node/plugin-service';
import { QaapHostedPluginServer } from '../common/qaap-hosted-plugin-server';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';

/**
 * Upstream forks this connection's plugin host as soon as the frontend lists the deployed plugins,
 * whoever asks. Here the listing (and with it the host fork) waits until this connection's frontend
 * calls {@link requestPlugins}, which only a page allowed to run plugins does: a phone or a Work Hub
 * page never gets a plugin host, even after another client has deployed the plugins.
 */
@injectable()
export class QaapHostedPluginServerImpl extends HostedPluginServerImpl implements QaapHostedPluginServer {

    @inject(QaapPluginDeploymentGate)
    protected readonly deploymentGate: QaapPluginDeploymentGate;

    protected readonly pluginsRequested = new Deferred<void>();

    constructor(@inject(HostedPluginSupport) hostedPlugin: HostedPluginSupport) {
        super(hostedPlugin);
    }

    async requestPlugins(): Promise<void> {
        this.deploymentGate.request();
        this.pluginsRequested.resolve();
    }

    override async getInstalledPluginIds(): Promise<PluginIdentifiers.VersionedId[]> {
        await this.pluginsRequested.promise;
        return super.getInstalledPluginIds();
    }
}

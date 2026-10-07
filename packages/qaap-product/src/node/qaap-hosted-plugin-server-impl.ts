// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { HostedPluginClient, PluginIdentifiers } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin';
import { HostedPluginServerImpl } from '@theia/plugin-ext/lib/hosted/node/plugin-service';
import { QaapHostedPluginServer } from '../common/qaap-hosted-plugin-server';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';

/**
 * Upstream forks this connection's plugin host as soon as the frontend lists the deployed plugins,
 * whoever asks. Here the listing (and with it the host fork) waits until this connection's frontend
 * calls {@link requestPlugins}, which only a page allowed to run plugins does: a phone or a Work Hub
 * page never gets a plugin host, even after another client has deployed the plugins.
 *
 * The lazy deployment also ends while the requesting IDE page is connected, so its completion
 * event (upstream: fired at backend boot, before any client exists) made that page run a second,
 * no-op plugin load right after the first: "Waiting for backend deployment" and "Loading plugin
 * contributions" again. Its first listing already waits for that deployment, so the event is not
 * forwarded; later deploy events (installs, uninstalls) are.
 */
@injectable()
export class QaapHostedPluginServerImpl extends HostedPluginServerImpl implements QaapHostedPluginServer {

    @inject(QaapPluginDeploymentGate)
    protected readonly deploymentGate: QaapPluginDeploymentGate;

    protected readonly pluginsRequested = new Deferred<void>();
    protected initialDeploymentEventDropped = false;

    constructor(@inject(HostedPluginSupport) hostedPlugin: HostedPluginSupport) {
        super(hostedPlugin);
    }

    override setClient(client: HostedPluginClient): void {
        super.setClient(client);
        this.client = {
            postMessage: (pluginHost, buffer) => client.postMessage(pluginHost, buffer),
            log: logPart => client.log(logPart),
            onDidDeploy: () => this.forwardDidDeploy(client)
        };
    }

    /** Drops at most one deploy event per connection: the one completing the initial deployment. */
    protected forwardDidDeploy(client: HostedPluginClient): void {
        if (this.deploymentGate.initialDeploymentPending && !this.initialDeploymentEventDropped) {
            this.initialDeploymentEventDropped = true;
            return;
        }
        client.onDidDeploy();
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

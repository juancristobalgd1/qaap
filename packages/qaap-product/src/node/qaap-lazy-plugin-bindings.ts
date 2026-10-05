// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { interfaces } from '@theia/core/shared/inversify';
import { CliContribution } from '@theia/core/lib/node/cli';
import { LocalizationServerImpl } from '@theia/core/lib/node/i18n/localization-server';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { PluginDeployerContribution } from '@theia/plugin-ext/lib/main/node/plugin-deployer-contribution';
import { HostedPluginServerImpl } from '@theia/plugin-ext/lib/hosted/node/plugin-service';
import { QaapHostedPluginServerImpl } from './qaap-hosted-plugin-server-impl';
import { QaapLazyPluginDeployerContribution } from './qaap-lazy-plugin-deployer-contribution';
import { QaapPluginDeploymentCliContribution } from './qaap-plugin-deployment-cli-contribution';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';
import { QaapPluginLocalizationServer } from './qaap-plugin-localization-server';

/** Connection-scoped: this frontend gets a plugin host only after it asked for plugins. */
export const qaapHostedPluginConnectionModule = ConnectionContainerModule.create(({ rebind, isBound }) => {
    if (isBound(HostedPluginServerImpl)) {
        rebind(HostedPluginServerImpl).to(QaapHostedPluginServerImpl).inSingletonScope();
    }
});

/**
 * Plugins are deployed, and a plugin host forked, only for an IDE page that asks for them: never at
 * backend boot, never for a phone or a Work Hub page (see {@link QaapPluginDeploymentGate}).
 * Must run after the plugin-ext backend modules (qaap-product depends on @theia/plugin-ext).
 */
export function bindQaapLazyPlugins(bind: interfaces.Bind, isBound: interfaces.IsBound, rebind: interfaces.Rebind): void {
    bind(QaapPluginDeploymentGate).toSelf().inSingletonScope();
    if (!isBound(PluginDeployerContribution)) {
        return;
    }
    rebind(PluginDeployerContribution).to(QaapLazyPluginDeployerContribution).inSingletonScope();
    bind(ConnectionContainerModule).toConstantValue(qaapHostedPluginConnectionModule);
    if (isBound(LocalizationServerImpl)) {
        rebind(LocalizationServerImpl).to(QaapPluginLocalizationServer).inSingletonScope();
    }
    bind(QaapPluginDeploymentCliContribution).toSelf().inSingletonScope();
    bind(CliContribution).toService(QaapPluginDeploymentCliContribution);
}

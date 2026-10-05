// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { PluginViewWelcomePolicy } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-welcome-policy';
import { QaapHostedPluginSupport } from './qaap-hosted-plugin-support';
import { QaapPluginHostFrontend } from './qaap-phone-debug-service';
import { QaapPluginViewWelcomePolicy } from './qaap-plugin-view-welcome-policy';

/**
 * Qaap bindings on top of plugin-ext. Desktop-only: the phone entry (bundle.mobile.js) drops this
 * module together with plugin-ext, so phones never download the plugin host frontend.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapPluginHostFrontend).toConstantValue(true);

    bind(QaapPluginViewWelcomePolicy).toSelf().inSingletonScope();
    bind(PluginViewWelcomePolicy).toService(QaapPluginViewWelcomePolicy);
    // Settings (user-storage) and the Work Hub mount do not wait for the backend plugin deployment.
    bind(QaapHostedPluginSupport).toSelf().inSingletonScope();
    rebind(HostedPluginSupport).toService(QaapHostedPluginSupport);
});

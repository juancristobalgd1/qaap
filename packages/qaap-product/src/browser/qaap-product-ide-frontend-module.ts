// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { TextmateRegistry } from '@theia/monaco/lib/browser/textmate/textmate-registry';
import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { PluginViewWelcomePolicy } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-welcome-policy';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { QaapMonacoEmbeddedLanguageContribution } from './qaap-monaco-embedded-language-contribution';
import { QaapPluginCompatibilityPreferenceContribution } from './qaap-plugin-compatibility-preference-contribution';
import { QaapTextmateRegistry } from './qaap-textmate-registry';
import { QaapGettingStartedWidget } from './qaap-getting-started-widget';
import { QaapPluginViewWelcomePolicy } from './qaap-plugin-view-welcome-policy';
import { QaapHostedPluginSupport } from './qaap-hosted-plugin-support';

/**
 * IDE-only product bindings: desktop loads this module right after
 * `qaap-product-bindings-frontend-module`; the `bundle-mobile` entry excludes it (no Monaco, plugin
 * host or getting-started page on mobile).
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapPluginCompatibilityPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapPluginCompatibilityPreferenceContribution);

    bind(QaapMonacoEmbeddedLanguageContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapMonacoEmbeddedLanguageContribution);

    bind(QaapTextmateRegistry).toSelf().inSingletonScope();
    rebind(TextmateRegistry).toService(QaapTextmateRegistry);

    bind(QaapGettingStartedWidget).toSelf();
    rebind(GettingStartedWidget).toService(QaapGettingStartedWidget);

    bind(QaapPluginViewWelcomePolicy).toSelf().inSingletonScope();
    bind(PluginViewWelcomePolicy).toService(QaapPluginViewWelcomePolicy);
    // Settings (user-storage) and the Work Hub mount do not wait for the backend plugin deployment.
    bind(QaapHostedPluginSupport).toSelf().inSingletonScope();
    rebind(HostedPluginSupport).toService(QaapHostedPluginSupport);
});

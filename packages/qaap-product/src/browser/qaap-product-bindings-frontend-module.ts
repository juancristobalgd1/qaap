// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { AboutDialogProps } from '@theia/core/lib/browser/about-dialog';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { QaapBuiltinThemeBrandingContribution } from './qaap-builtin-theme-branding-contribution';
import { QaapCopilotDefaultsContribution } from './qaap-copilot-defaults-contribution';
import { QaapCorePreferenceBrandingContribution } from './qaap-core-preference-branding-contribution';
import { QaapMonacoEmbeddedLanguageContribution } from './qaap-monaco-embedded-language-contribution';
import { QaapPluginCompatibilityPreferenceContribution } from './qaap-plugin-compatibility-preference-contribution';
import { QaapTextmateRegistry } from './qaap-textmate-registry';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { TextmateRegistry } from '@theia/monaco/lib/browser/textmate/textmate-registry';
import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { PluginViewWelcomePolicy } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-welcome-policy';
import { QaapGettingStartedWidget } from './qaap-getting-started-widget';
import { QaapPluginViewWelcomePolicy } from './qaap-plugin-view-welcome-policy';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { QaapHostedPluginSupport } from './qaap-hosted-plugin-support';
import { QaapAiPreferenceBrandingStartup } from './qaap-ai-preference-branding-contribution';
import { QaapWorkspaceSafetyDefaultsContribution } from './qaap-workspace-safety-defaults-contribution';
import { QaapServiceWorkerUpdateContribution } from './qaap-service-worker-update-contribution';
import { QaapLazyJsonSchemaDataStore } from './qaap-lazy-json-schema-data-store';
import { JsonSchemaDataStore } from '@theia/core/lib/browser/json-schema-store';
import { rebindQaapPreferenceTreeGenerator } from '@theia/qaap-shared-core/lib/browser/qaap-preference-tree-generator';
import { rebindQaapPreferencesContribution } from '@theia/qaap-shared-core/lib/browser/qaap-preferences-contribution';
import { decorateQaapTenantAiUserPreferenceProvider } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-ai-user-preference-provider';

export default new ContainerModule((bind, _unbind, isBound, rebind, _unbindAsync, onActivation) => {
    bind(QaapBuiltinThemeBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapBuiltinThemeBrandingContribution);

    bind(QaapCorePreferenceBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCorePreferenceBrandingContribution);

    bind(QaapCopilotDefaultsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCopilotDefaultsContribution);

    bind(QaapWorkspaceSafetyDefaultsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapWorkspaceSafetyDefaultsContribution);

    bind(QaapServiceWorkerUpdateContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapServiceWorkerUpdateContribution);

    bind(QaapPluginCompatibilityPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapPluginCompatibilityPreferenceContribution);

    bind(QaapMonacoEmbeddedLanguageContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapMonacoEmbeddedLanguageContribution);

    bind(QaapAiPreferenceBrandingStartup).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAiPreferenceBrandingStartup);

    // Startup rewrites the preference schemas once per contribution; serialize them only when read.
    bind(QaapLazyJsonSchemaDataStore).toSelf().inSingletonScope();
    rebind(JsonSchemaDataStore).toService(QaapLazyJsonSchemaDataStore);

    bind(QaapTextmateRegistry).toSelf().inSingletonScope();
    rebind(TextmateRegistry).toService(QaapTextmateRegistry);

    if (isBound(AboutDialogProps)) {
        rebind(AboutDialogProps).toDynamicValue(() => ({
            title: FrontendApplicationConfigProvider.get().applicationName
        })).inSingletonScope();
    } else {
        bind(AboutDialogProps).toDynamicValue(() => ({
            title: FrontendApplicationConfigProvider.get().applicationName
        })).inSingletonScope();
    }

    bind(QaapGettingStartedWidget).toSelf();
    rebind(GettingStartedWidget).toService(QaapGettingStartedWidget);

    bind(QaapPluginViewWelcomePolicy).toSelf().inSingletonScope();
    bind(PluginViewWelcomePolicy).toService(QaapPluginViewWelcomePolicy);
    // Settings (user-storage) and the Work Hub mount do not wait for the backend plugin deployment.
    // The phone entry (bundle.mobile.js) has no plugin host, so there is nothing to rebind there.
    if (isBound(HostedPluginSupport)) {
        bind(QaapHostedPluginSupport).toSelf().inSingletonScope();
        rebind(HostedPluginSupport).toService(QaapHostedPluginSupport);
    }

    // Settings tree keeps the curated QaapPreferenceLayoutProvider order instead of upstream's id sort.
    rebindQaapPreferenceTreeGenerator(bind, rebind);
    // The Settings editor is built on first open, not while collecting commands behind the splash.
    rebindQaapPreferencesContribution(bind, rebind);

    // Authenticated tenants' AI settings live in a per-user overlay, never in the shared User settings.json.
    decorateQaapTenantAiUserPreferenceProvider(onActivation);
});

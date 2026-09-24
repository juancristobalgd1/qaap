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
import { QaapAiPreferenceBrandingStartup } from './qaap-ai-preference-branding-contribution';
import { QaapWorkspaceSafetyDefaultsContribution } from './qaap-workspace-safety-defaults-contribution';
import { rebindQaapPreferenceTreeGenerator } from '@theia/qaap-shared-core/lib/browser/qaap-preference-tree-generator';
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

    bind(QaapPluginCompatibilityPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapPluginCompatibilityPreferenceContribution);

    bind(QaapMonacoEmbeddedLanguageContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapMonacoEmbeddedLanguageContribution);

    bind(QaapAiPreferenceBrandingStartup).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAiPreferenceBrandingStartup);

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

    // Settings tree keeps the curated QaapPreferenceLayoutProvider order instead of upstream's id sort.
    rebindQaapPreferenceTreeGenerator(bind, rebind);

    // Authenticated tenants' AI settings live in a per-user overlay, never in the shared User settings.json.
    decorateQaapTenantAiUserPreferenceProvider(onActivation);
});

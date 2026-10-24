// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { AboutDialogProps } from '@theia/core/lib/browser/about-dialog';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { QaapBuiltinThemeBrandingContribution } from './qaap-builtin-theme-branding-contribution';
import { QaapCopilotDefaultsContribution } from './qaap-copilot-defaults-contribution';
import { QaapCorePreferenceBrandingContribution } from './qaap-core-preference-branding-contribution';
import { QaapDisplayLanguageCommandContribution } from './qaap-display-language-command-contribution';
import { QaapAiPreferenceBrandingStartup } from './qaap-ai-preference-branding-contribution';
import { QaapWorkspaceSafetyDefaultsContribution } from './qaap-workspace-safety-defaults-contribution';
import { rebindQaapPreferenceTreeGenerator } from '@theia/qaap-shared-core/lib/browser/qaap-preference-tree-generator';
import { rebindQaapPreferencesContribution } from '@theia/qaap-shared-core/lib/browser/qaap-preferences-contribution';
import { bindQaapSecretPreferenceInputRenderer } from '@theia/qaap-shared-core/lib/browser/qaap-secret-preference-input-renderer';

/**
 * Mobile-safe product bindings (part of the `bundle-mobile` entry). IDE-only rebinds (Monaco
 * TextMate/embedded languages, plugin host, getting started) live in
 * `qaap-product-ide-frontend-module`, which desktop loads right after this module.
 */
export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    bind(QaapBuiltinThemeBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapBuiltinThemeBrandingContribution);

    bind(QaapCorePreferenceBrandingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCorePreferenceBrandingContribution);

    bind(QaapCopilotDefaultsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCopilotDefaultsContribution);

    bind(QaapWorkspaceSafetyDefaultsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapWorkspaceSafetyDefaultsContribution);

    bind(QaapAiPreferenceBrandingStartup).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapAiPreferenceBrandingStartup);

    // English only for launch (audit L1): no display-language picker while QaapSupportedLocales is ['en'].
    bind(QaapDisplayLanguageCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapDisplayLanguageCommandContribution);

    if (isBound(AboutDialogProps)) {
        rebind(AboutDialogProps).toDynamicValue(() => ({
            title: FrontendApplicationConfigProvider.get().applicationName
        })).inSingletonScope();
    } else {
        bind(AboutDialogProps).toDynamicValue(() => ({
            title: FrontendApplicationConfigProvider.get().applicationName
        })).inSingletonScope();
    }

    // Settings tree keeps the curated QaapPreferenceLayoutProvider order instead of upstream's id sort.
    rebindQaapPreferenceTreeGenerator(bind, rebind);
    // The Settings editor is built on first open, not while collecting commands behind the splash.
    rebindQaapPreferencesContribution(bind, rebind);
    // API keys and tokens in the settings editor (Settings, BYOK, IDE) are masked with a show/hide toggle.
    bindQaapSecretPreferenceInputRenderer(bind);
});

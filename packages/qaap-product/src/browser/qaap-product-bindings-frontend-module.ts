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
import { QaapAiPreferenceBrandingStartup } from './qaap-ai-preference-branding-contribution';
import { QaapWorkspaceSafetyDefaultsContribution } from './qaap-workspace-safety-defaults-contribution';
import { rebindQaapPreferenceTreeGenerator } from '@theia/qaap-shared-core/lib/browser/qaap-preference-tree-generator';
import { rebindQaapPreferencesContribution } from '@theia/qaap-shared-core/lib/browser/qaap-preferences-contribution';
import { decorateQaapTenantAiUserPreferenceProvider } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-ai-user-preference-provider';

/**
 * Mobile-safe product bindings (part of the `bundle-mobile` entry). IDE-only rebinds (Monaco
 * TextMate/embedded languages, plugin host, getting started) live in
 * `qaap-product-ide-frontend-module`, which desktop loads right after this module.
 */
export default new ContainerModule((bind, _unbind, isBound, rebind, _unbindAsync, onActivation) => {
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

    // Authenticated tenants' AI settings live in a per-user overlay, never in the shared User settings.json.
    decorateQaapTenantAiUserPreferenceProvider(onActivation);
});

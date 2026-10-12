// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { WidgetFactory } from '@theia/core/lib/browser';
import { LaunchListProvider } from '@theia/ai-ide/lib/browser/workspace-launch-provider';
import { LanguageModelOptionContribution } from '@theia/ai-ide/lib/browser/ai-configuration/language-model-option-contribution';
import { AIAgentConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/agent-configuration-widget';
import { AIAgentConfigurationViewContribution } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-view-contribution';
import { AIConfigurationContainerWidget } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-widget';
import { AISkillsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/skills-configuration-widget';
import { ShellCommandPermissionService } from '@theia/ai-terminal/lib/browser/shell-command-permission-service';
import { QaapLaunchListProvider } from './qaap-launch-list-provider';
import { QaapLanguageModelOptionContribution } from './qaap-language-model-option-contribution';
import { QaapAiAgentConfigurationWidget } from './qaap-ai-agent-configuration-widget';
import { QaapAiConfigurationContainerWidget } from './qaap-ai-configuration-container-widget';
import { QaapAiConfigurationViewContribution } from './qaap-ai-configuration-view-contribution';
import { QaapAiSkillsConfigurationWidget } from './qaap-ai-skills-configuration-widget';
import { QaapAiConfigurationNavigationWidget } from './qaap-ai-configuration-navigation-widget';
import { QaapShellCommandPermissionService } from './qaap-shell-command-permission-service';

/**
 * IDE-only half of the AI configuration bindings: desktop loads it right after
 * `qaap-ai-config-frontend-module`; the `bundle-mobile` entry excludes it: the IDE's AI configuration
 * views (`@theia/ai-ide`), launch configurations (`@theia/debug`) and terminal command permissions
 * (`@theia/ai-terminal`).
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapLaunchListProvider).toSelf().inSingletonScope();
    rebind(LaunchListProvider).toService(QaapLaunchListProvider);

    bind(QaapLanguageModelOptionContribution).toSelf().inSingletonScope();
    bind(LanguageModelOptionContribution).toService(QaapLanguageModelOptionContribution);

    bind(QaapAiAgentConfigurationWidget).toSelf().inSingletonScope();
    rebind(AIAgentConfigurationWidget).toService(QaapAiAgentConfigurationWidget);

    bind(QaapAiConfigurationContainerWidget).toSelf().inSingletonScope();
    rebind(AIConfigurationContainerWidget).toService(QaapAiConfigurationContainerWidget);

    bind(QaapAiConfigurationViewContribution).toSelf().inSingletonScope();
    rebind(AIAgentConfigurationViewContribution).toService(QaapAiConfigurationViewContribution);

    bind(QaapAiSkillsConfigurationWidget).toSelf();
    rebind(AISkillsConfigurationWidget).toService(QaapAiSkillsConfigurationWidget);

    bind(QaapAiConfigurationNavigationWidget).toSelf();
    bind(WidgetFactory)
        .toDynamicValue(ctx => ({
            id: QaapAiConfigurationNavigationWidget.ID,
            createWidget: () => ctx.container.get(QaapAiConfigurationNavigationWidget)
        }))
        .inSingletonScope();

    bind(QaapShellCommandPermissionService).toSelf().inSingletonScope();
    rebind(ShellCommandPermissionService).toService(QaapShellCommandPermissionService);
});

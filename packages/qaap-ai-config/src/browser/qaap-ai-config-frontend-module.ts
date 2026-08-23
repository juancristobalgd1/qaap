// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/qaap-ai-model-options.css';
import '../../src/browser/style/qaap-ai-skills-configuration.css';
import '../../src/browser/style/qaap-ai-harness-configuration.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { QaapCoderPromptContribution } from './qaap-coder-prompt-contribution';
import { QaapTasksBackgroundPromptContribution } from './qaap-tasks-background-prompt-contribution';
import { QaapAiModelDefaultsContribution } from './qaap-ai-model-defaults-contribution';
import { LanguageModelOptionContribution } from '@theia/ai-ide/lib/browser/ai-configuration/language-model-option-contribution';
import { QaapLanguageModelOptionContribution } from './qaap-language-model-option-contribution';
import { QaapIncrementalStreamParsingContribution } from './qaap-incremental-stream-parsing-contribution';
import { LaunchListProvider } from '@theia/ai-ide/lib/browser/workspace-launch-provider';
import { QaapLaunchListProvider } from './qaap-launch-list-provider';
import { ShellCommandPermissionService } from '@theia/ai-terminal/lib/browser/shell-command-permission-service';
import { QaapShellCommandPermissionService } from './qaap-shell-command-permission-service';
import { QaapTerminalPreferenceContribution } from './qaap-terminal-preferences';
import { QaapSkillsPreferenceContribution } from './qaap-skills-preferences';
import { QaapHarnessPreferenceContribution } from './qaap-harness-preferences';
import { QaapHarnessConfigurationWidget } from './qaap-harness-configuration-widget';

import { CodexChatAgent } from '@theia/ai-codex/lib/browser/codex-chat-agent';
import { QaapCodexChatAgent } from './qaap-codex-chat-agent';
import { AIAgentConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/agent-configuration-widget';
import { AIConfigurationContainerWidget } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-widget';
import { AISkillsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/skills-configuration-widget';
import { QaapAiAgentConfigurationWidget } from './qaap-ai-agent-configuration-widget';
import { QaapAiConfigurationContainerWidget } from './qaap-ai-configuration-container-widget';
import { QaapAiSkillsConfigurationWidget } from './qaap-ai-skills-configuration-widget';
import { DefaultSkillService, SkillService } from '@theia/ai-core/lib/browser/skill-service';
import { QaapSkillService } from './qaap-skill-service';
import { SkillPromptCoordinator } from '@theia/ai-core/lib/browser/skill-prompt-coordinator';
import { QaapSkillPromptCoordinator } from './qaap-skill-prompt-coordinator';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapCoderPromptContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCoderPromptContribution);

    bind(QaapTasksBackgroundPromptContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapTasksBackgroundPromptContribution);

    bind(QaapAiModelDefaultsContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapAiModelDefaultsContribution);

    bind(QaapLanguageModelOptionContribution).toSelf().inSingletonScope();
    bind(LanguageModelOptionContribution).toService(QaapLanguageModelOptionContribution);

    bind(QaapIncrementalStreamParsingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapIncrementalStreamParsingContribution);

    bind(QaapCodexChatAgent).toSelf().inSingletonScope();
    rebind(CodexChatAgent).toService(QaapCodexChatAgent);

    bind(QaapAiAgentConfigurationWidget).toSelf().inSingletonScope();
    rebind(AIAgentConfigurationWidget).toService(QaapAiAgentConfigurationWidget);

    bind(QaapAiConfigurationContainerWidget).toSelf().inSingletonScope();
    rebind(AIConfigurationContainerWidget).toService(QaapAiConfigurationContainerWidget);

    bind(QaapAiSkillsConfigurationWidget).toSelf();
    rebind(AISkillsConfigurationWidget).toService(QaapAiSkillsConfigurationWidget);

    bind(QaapSkillService).toSelf().inSingletonScope();
    rebind(DefaultSkillService).toService(QaapSkillService);
    rebind(SkillService).toService(QaapSkillService);

    bind(QaapSkillPromptCoordinator).toSelf().inSingletonScope();
    rebind(SkillPromptCoordinator).toService(QaapSkillPromptCoordinator);

    bind(QaapLaunchListProvider).toSelf().inSingletonScope();
    rebind(LaunchListProvider).toService(QaapLaunchListProvider);

    bind(QaapTerminalPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapTerminalPreferenceContribution);

    bind(QaapSkillsPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapSkillsPreferenceContribution);

    bind(QaapHarnessPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapHarnessPreferenceContribution);

    bind(QaapHarnessConfigurationWidget).toSelf();
    bind(WidgetFactory)
        .toDynamicValue(ctx => ({
            id: QaapHarnessConfigurationWidget.ID,
            createWidget: () => ctx.container.get(QaapHarnessConfigurationWidget)
        }))
        .inSingletonScope();

    bind(QaapShellCommandPermissionService).toSelf().inSingletonScope();
    rebind(ShellCommandPermissionService).toService(QaapShellCommandPermissionService);
});

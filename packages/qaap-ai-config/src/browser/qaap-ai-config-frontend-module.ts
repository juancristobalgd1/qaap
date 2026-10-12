// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/qaap-ai-model-options.css';
import '../../src/browser/style/qaap-ai-skills-configuration.css';
import '../../src/browser/style/qaap-ai-harness-configuration.css';
import '../../src/browser/style/qaap-ai-configuration.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';
import { QaapCoderPromptContribution } from './qaap-coder-prompt-contribution';
import { QaapTasksBackgroundPromptContribution } from './qaap-tasks-background-prompt-contribution';
import { QaapAiModelDefaultsContribution } from '../common/qaap-ai-model-defaults-contribution';
import { QaapIncrementalStreamParsingContribution } from './qaap-incremental-stream-parsing-contribution';
import { QaapTerminalPreferenceContribution } from './qaap-terminal-preferences';
import { QaapSkillsPreferenceContribution } from './qaap-skills-preferences';
import { QaapHarnessPreferenceContribution } from './qaap-harness-preferences';
import { QaapAgentApprovalPreferenceContribution } from './qaap-agent-approval-preferences';
import { QaapHarnessConfigurationWidget } from './qaap-harness-configuration-widget';

import { CodexChatAgent } from '@theia/ai-codex/lib/browser/codex-chat-agent';
import { QaapCodexChatAgent } from './qaap-codex-chat-agent';
import { DefaultSkillService, SkillService } from '@theia/ai-core/lib/browser/skill-service';
import { QaapSkillService } from './qaap-skill-service';
import { SkillPromptCoordinator } from '@theia/ai-core/lib/browser/skill-prompt-coordinator';
import { QaapSkillPromptCoordinator } from './qaap-skill-prompt-coordinator';

/**
 * Mobile-safe AI configuration bindings (part of the `bundle-mobile` entry). The IDE's AI
 * configuration views (`@theia/ai-ide`) and the terminal command permissions (`@theia/ai-terminal`)
 * live in `qaap-ai-config-ide-frontend-module`; the Work Hub lands AI settings in its preferences sheet.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapCoderPromptContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapCoderPromptContribution);

    bind(QaapTasksBackgroundPromptContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapTasksBackgroundPromptContribution);

    bind(QaapAiModelDefaultsContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapAiModelDefaultsContribution);

    bind(QaapIncrementalStreamParsingContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapIncrementalStreamParsingContribution);

    bind(QaapCodexChatAgent).toSelf().inSingletonScope();
    rebind(CodexChatAgent).toService(QaapCodexChatAgent);

    bind(QaapSkillService).toSelf().inSingletonScope();
    rebind(DefaultSkillService).toService(QaapSkillService);
    rebind(SkillService).toService(QaapSkillService);

    bind(QaapSkillPromptCoordinator).toSelf().inSingletonScope();
    rebind(SkillPromptCoordinator).toService(QaapSkillPromptCoordinator);

    bind(QaapTerminalPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapTerminalPreferenceContribution);

    bind(QaapSkillsPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapSkillsPreferenceContribution);

    bind(QaapHarnessPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapHarnessPreferenceContribution);

    bind(QaapAgentApprovalPreferenceContribution).toSelf().inSingletonScope();
    bind(PreferenceContribution).toService(QaapAgentApprovalPreferenceContribution);

    bind(QaapHarnessConfigurationWidget).toSelf();
    bind(WidgetFactory)
        .toDynamicValue(ctx => ({
            id: QaapHarnessConfigurationWidget.ID,
            createWidget: () => ctx.container.get(QaapHarnessConfigurationWidget)
        }))
        .inSingletonScope();
});

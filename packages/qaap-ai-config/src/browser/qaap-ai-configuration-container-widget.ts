// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { BoxLayout, codicon } from '@theia/core/lib/browser';
import { nls } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { AIMCPConfigurationWidget } from '@theia/ai-mcp/lib/browser/mcp-configuration-widget';
import { AIAgentConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/agent-configuration-widget';
import { AIConfigurationContainerWidget } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-widget';
import { AIPromptFragmentsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/prompt-fragments-configuration-widget';
import { AISkillsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/skills-configuration-widget';
import { ModelAliasesConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/model-aliases-configuration-widget';
import { QaapHarnessConfigurationWidget } from './qaap-harness-configuration-widget';
import { QaapAiConfigurationNavigationWidget } from './qaap-ai-configuration-navigation-widget';

/**
 * Work Hub–oriented AI Configuration tabs:
 * MCP / Skills / Model Aliases are first-class for the hub.
 * IDE Agents + Prompt Fragments stay mounted for classic IDE chat, but the Work Hub sheet
 * hides those tabs via {@link isQaapWorkHubHiddenAiConfigurationTab}.
 * Omits Variables / Token Usage / Tools (Theia Chat–only; Work Hub uses composer approval).
 */
@injectable()
export class QaapAiConfigurationContainerWidget extends AIConfigurationContainerWidget {

    protected navigationWidget: QaapAiConfigurationNavigationWidget;
    protected harnessWidget: QaapHarnessConfigurationWidget;

    protected override async initUI(): Promise<void> {
        this.addClass('qaap-ai-configuration-container');
        const layout = (this.layout = new BoxLayout({ direction: 'left-to-right', spacing: 0 }));
        this.dockpanel = this.dockPanelFactory({
            mode: 'multiple-document',
            spacing: 0,
        });
        this.dockpanel.addClass('qaap-ai-configuration-dock');
        this.dockpanel.addClass('ai-configuration-widget');

        this.navigationWidget = await this.widgetManager.getOrCreateWidget(QaapAiConfigurationNavigationWidget.ID);
        this.harnessWidget = await this.widgetManager.getOrCreateWidget(QaapHarnessConfigurationWidget.ID);
        this.mcpWidget = await this.widgetManager.getOrCreateWidget(AIMCPConfigurationWidget.ID);
        this.skillsWidget = await this.widgetManager.getOrCreateWidget(AISkillsConfigurationWidget.ID);
        this.modelAliasesWidget = await this.widgetManager.getOrCreateWidget(ModelAliasesConfigurationWidget.ID);
        this.agentsWidget = await this.widgetManager.getOrCreateWidget(AIAgentConfigurationWidget.ID);
        this.promptFragmentsWidget = await this.widgetManager.getOrCreateWidget(AIPromptFragmentsConfigurationWidget.ID);

        // Work Hub-first order.
        this.dockpanel.addWidget(this.harnessWidget);
        this.dockpanel.addWidget(this.mcpWidget, { mode: 'tab-after', ref: this.harnessWidget });
        this.dockpanel.addWidget(this.skillsWidget, { mode: 'tab-after', ref: this.mcpWidget });
        this.dockpanel.addWidget(this.modelAliasesWidget, { mode: 'tab-after', ref: this.skillsWidget });
        this.dockpanel.addWidget(this.agentsWidget, { mode: 'tab-after', ref: this.modelAliasesWidget });
        this.dockpanel.addWidget(this.promptFragmentsWidget, { mode: 'tab-after', ref: this.agentsWidget });

        this.agentsWidget.title.label = nls.localize('qaap/aiConfiguration/ideAgents', 'IDE Agents');
        this.agentsWidget.title.iconClass = codicon('account');
        this.promptFragmentsWidget.title.label = nls.localize(
            'qaap/aiConfiguration/idePromptFragments',
            'Prompt Fragments (IDE)',
        );
        this.promptFragmentsWidget.title.iconClass = codicon('comment-discussion');
        this.harnessWidget.title.iconClass = codicon('server-environment');
        this.mcpWidget.title.iconClass = codicon('server-process');
        this.skillsWidget.title.iconClass = codicon('sparkle');
        this.modelAliasesWidget.title.iconClass = codicon('symbol-variable');

        layout.addWidget(this.navigationWidget);
        BoxLayout.setSizeBasis(this.navigationWidget, 236);
        BoxLayout.setStretch(this.navigationWidget, 0);
        layout.addWidget(this.dockpanel);
        BoxLayout.setStretch(this.dockpanel, 1);

        this.update();

        // The settings navigation above is the stable, accessible way to switch
        // pages. Keep the existing DockPanel as the page host so all existing
        // commands and selection-service integrations remain unchanged.
        for (const tabBar of this.dockpanel.tabBars()) {
            tabBar.hide();
        }
    }

    protected override initListeners(): void {
        this.aiConfigurationSelectionService.onDidSelectConfiguration(widgetId => {
            if (widgetId === QaapHarnessConfigurationWidget.ID) {
                this.dockpanel.activateWidget(this.harnessWidget);
            } else if (widgetId === AIMCPConfigurationWidget.ID) {
                this.dockpanel.activateWidget(this.mcpWidget);
            } else if (widgetId === AISkillsConfigurationWidget.ID) {
                this.dockpanel.activateWidget(this.skillsWidget);
            } else if (widgetId === ModelAliasesConfigurationWidget.ID) {
                this.dockpanel.activateWidget(this.modelAliasesWidget);
            } else if (widgetId === AIAgentConfigurationWidget.ID) {
                this.dockpanel.activateWidget(this.agentsWidget);
            } else if (widgetId === AIPromptFragmentsConfigurationWidget.ID) {
                this.dockpanel.activateWidget(this.promptFragmentsWidget);
            }
            // Variables / Token Usage / Tools intentionally omitted.
        });
    }
}

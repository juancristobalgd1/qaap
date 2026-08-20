// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core';
import * as React from '@theia/core/shared/react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { AIAgentConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/agent-configuration-widget';
import { isQaapHiddenAiConfigurationAgent } from '@theia/qaap-mobile-shell/lib/common/qaap-ai-features-visibility';

/**
 * AI Configuration → Agents: omit Theia chat agents that Qaap replaced with Work Hub VPS agents.
 * Coder / Architect / Explore / review agents remain for classic IDE chat (labeled "IDE Agents").
 */
@injectable()
export class QaapAiAgentConfigurationWidget extends AIAgentConfigurationWidget {

    @postConstruct()
    protected override init(): void {
        super.init();
        this.title.label = nls.localize('qaap/aiConfiguration/ideAgents', 'IDE Agents');
    }

    protected override async loadItems(): Promise<void> {
        await super.loadItems();
        this.items = this.items.filter(agent => !isQaapHiddenAiConfigurationAgent(agent.id));
        const active = this.aiConfigurationSelectionService.getActiveAgent();
        if (active && isQaapHiddenAiConfigurationAgent(active.id)) {
            this.selectedItem = this.items[0];
            if (this.selectedItem) {
                this.aiConfigurationSelectionService.setActiveAgent(this.selectedItem);
            }
        } else if (this.selectedItem && isQaapHiddenAiConfigurationAgent(this.selectedItem.id)) {
            this.selectedItem = this.items[0];
        }
    }

    protected override renderList(): React.ReactNode {
        return (
            <div className="ai-configuration-list preferences-tree-widget theia-TreeContainer">
                <div className="theia-qaap-ai-config-ide-agents-banner" role="note">
                    {nls.localize(
                        'qaap/aiConfiguration/ideAgentsBanner',
                        'Work Hub agents (@qaiq, @codex, @claude, …) are chosen in the composer. This list is only for classic IDE chat agents.',
                    )}
                </div>
                <ul>
                    {this.items.map(agent => {
                        const agentId = this.getItemId(agent);
                        const isSelected = this.selectedItem && this.getItemId(this.selectedItem) === agentId;
                        return <li
                            key={agentId}
                            className={`theia-TreeNode theia-CompositeTreeNode${isSelected ? ' theia-mod-selected' : ''} ${this.getItemClassName(agent)}`}
                            onClick={() => this.handleItemSelect(agent)}
                        >
                            {this.renderItemPrefix(agent)}
                            <span className="ai-configuration-list-item-label">{this.getItemLabel(agent)}</span>
                            {this.renderItemSuffix(agent)}
                        </li>;
                    })}
                </ul>
                <div className='configuration-agents-add'>
                    <button
                        className='theia-button main'
                        onClick={() => this.addCustomAgent()}>
                        {nls.localize('theia/ai/core/agentConfiguration/addCustomAgent', 'Add Custom Agent')}
                    </button>
                </div>
            </div>
        );
    }
}

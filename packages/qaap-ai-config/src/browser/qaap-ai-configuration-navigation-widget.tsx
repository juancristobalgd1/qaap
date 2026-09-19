// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { codicon, ReactWidget } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AIMCPConfigurationWidget } from '@theia/ai-mcp/lib/browser/mcp-configuration-widget';
import { AIAgentConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/agent-configuration-widget';
import { AIConfigurationSelectionService } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-service';
import { AIPromptFragmentsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/prompt-fragments-configuration-widget';
import { AISkillsConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/skills-configuration-widget';
import { ModelAliasesConfigurationWidget } from '@theia/ai-ide/lib/browser/ai-configuration/model-aliases-configuration-widget';
import * as React from '@theia/core/shared/react';
import { QaapHarnessConfigurationWidget } from './qaap-harness-configuration-widget';

export interface QaapAiConfigurationNavigationEntry {
    readonly id: string;
    readonly label: string;
    readonly iconClass: string;
    readonly ideOnly?: boolean;
}

/**
 * The single source of truth for the AI Configuration navigation shown in the
 * IDE and the Work Hub. The IDs intentionally match the existing Theia widget
 * IDs so commands and deep links keep working.
 */
export const QAAP_AI_CONFIGURATION_NAVIGATION_ENTRIES: readonly QaapAiConfigurationNavigationEntry[] = [
    {
        id: QaapHarnessConfigurationWidget.ID,
        label: nls.localize('qaap/aiConfiguration/navigationRuntimes', 'Runtimes'),
        iconClass: codicon('server-environment'),
    },
    {
        id: AIMCPConfigurationWidget.ID,
        label: nls.localizeByDefault('MCP Servers'),
        iconClass: codicon('server-process'),
    },
    {
        id: AISkillsConfigurationWidget.ID,
        label: nls.localizeByDefault('Skills'),
        iconClass: codicon('sparkle'),
    },
    {
        id: ModelAliasesConfigurationWidget.ID,
        label: nls.localize('theia/ai/core/modelAliasesConfiguration/label', 'Model Aliases'),
        iconClass: codicon('symbol-variable'),
    },
    {
        id: AIAgentConfigurationWidget.ID,
        label: nls.localize('qaap/aiConfiguration/ideAgents', 'IDE Agents'),
        iconClass: codicon('account'),
        ideOnly: true,
    },
    {
        id: AIPromptFragmentsConfigurationWidget.ID,
        label: nls.localize('qaap/aiConfiguration/idePromptFragments', 'Prompt Fragments (IDE)'),
        iconClass: codicon('comment-discussion'),
        ideOnly: true,
    },
];

/** Cursor-inspired settings navigation shared by the IDE and Work Hub. */
@injectable()
export class QaapAiConfigurationNavigationWidget extends ReactWidget {

    static readonly ID = 'qaap-ai-configuration-navigation-widget';
    static readonly LABEL = nls.localize('qaap/aiConfiguration/navigationLabel', 'AI Configuration navigation');

    @inject(AIConfigurationSelectionService)
    protected readonly selectionService: AIConfigurationSelectionService;

    protected activeTabId = QAAP_AI_CONFIGURATION_NAVIGATION_ENTRIES[0].id;
    protected navigationFilter = '';

    @postConstruct()
    protected init(): void {
        this.id = QaapAiConfigurationNavigationWidget.ID;
        this.title.label = QaapAiConfigurationNavigationWidget.LABEL;
        this.title.caption = QaapAiConfigurationNavigationWidget.LABEL;
        this.title.closable = false;
        this.addClass('qaap-ai-configuration-navigation');
        this.toDispose.push(this.selectionService.onDidSelectConfiguration(tabId => {
            this.activeTabId = tabId;
            this.update();
        }));
    }

    protected override render(): React.ReactNode {
        const filter = this.navigationFilter.trim().toLocaleLowerCase();
        const entries = QAAP_AI_CONFIGURATION_NAVIGATION_ENTRIES.filter(entry =>
            !filter || entry.label.toLocaleLowerCase().includes(filter));

        return (
            <div className="qaap-ai-configuration-navigation-content">
                <div className="qaap-ai-configuration-navigation-brand">
                    <span className={`${codicon('settings-gear')} qaap-ai-configuration-navigation-brand-icon`} aria-hidden={true} />
                    <div>
                        <strong>{nls.localize('qaap/aiConfiguration/navigationProduct', 'Qaap')}</strong>
                        <span>{nls.localize('qaap/aiConfiguration/navigationSubtitle', 'AI configuration')}</span>
                    </div>
                </div>
                <label className="qaap-ai-configuration-search">
                    <span className={codicon('search')} aria-hidden={true} />
                    <input
                        type="search"
                        value={this.navigationFilter}
                        placeholder={nls.localize('qaap/aiConfiguration/searchPlaceholder', 'Search settings')}
                        aria-label={nls.localize('qaap/aiConfiguration/searchLabel', 'Search AI configuration')}
                        onChange={event => {
                            this.navigationFilter = event.currentTarget.value;
                            this.update();
                        }}
                    />
                </label>
                <div className="qaap-ai-configuration-navigation-section-label">
                    {nls.localize('qaap/aiConfiguration/navigationSection', 'Configure')}
                </div>
                <nav aria-label={nls.localize('qaap/aiConfiguration/navigationAriaLabel', 'AI configuration sections')}>
                    {entries.length > 0 ? entries.map(entry => this.renderEntry(entry)) : (
                        <div className="qaap-ai-configuration-navigation-empty">
                            {nls.localize('qaap/aiConfiguration/noMatchingSettings', 'No matching settings')}
                        </div>
                    )}
                </nav>
            </div>
        );
    }

    protected renderEntry(entry: QaapAiConfigurationNavigationEntry): React.ReactNode {
        const active = this.activeTabId === entry.id;
        return (
            <button
                key={entry.id}
                type="button"
                className={`qaap-ai-configuration-nav-item${active ? ' qaap-ai-configuration-nav-item-active' : ''}${entry.ideOnly ? ' qaap-work-hub-ide-only-tab' : ''}`}
                data-qaap-ai-config-tab-id={entry.id}
                role="tab"
                aria-selected={active}
                title={entry.label}
                onClick={() => {
                    this.activeTabId = entry.id;
                    this.update();
                    this.selectionService.selectConfigurationTab(entry.id);
                }}
            >
                <span className={`qaap-ai-configuration-nav-item-icon ${entry.iconClass}`} aria-hidden={true} />
                <span className="qaap-ai-configuration-nav-item-label">{entry.label}</span>
            </button>
        );
    }
}

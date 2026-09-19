// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Command, CommandRegistry, MenuModelRegistry, nls } from '@theia/core';
import { CommonCommands, FrontendApplication } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { injectable } from '@theia/core/shared/inversify';
import {
    AIAgentConfigurationViewContribution,
    OPEN_AI_CONFIG_VIEW,
    OPEN_AI_CONFIG_VIEW_TOOLS,
} from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-view-contribution';

/**
 * Keeps the legacy AI Configuration command ids compatible while making AI Features the only
 * user-facing configuration surface. The underlying widgets remain registered for runtime
 * services and old integrations, but the standalone view is neither opened nor advertised.
 */
@injectable()
export class QaapAiConfigurationViewContribution extends AIAgentConfigurationViewContribution implements TabBarToolbarContribution {

    override async initializeLayout(_app: FrontendApplication): Promise<void> {
        // AI Features settings owns the initial configuration surface.
    }

    override registerCommands(commands: CommandRegistry): void {
        const openAiFeatures: Command = {
            id: OPEN_AI_CONFIG_VIEW.id,
            label: nls.localize('qaap/aiConfiguration/openAiFeatures', 'Open AI Features'),
        };
        const openAiFeaturesTools: Command = {
            id: OPEN_AI_CONFIG_VIEW_TOOLS.id,
            label: nls.localize('qaap/aiConfiguration/openAiFeaturesTools', 'Open AI Features'),
        };
        commands.registerCommand(openAiFeatures, {
            execute: () => commands.executeCommand(CommonCommands.OPEN_PREFERENCES.id, 'ai-features'),
        });
        commands.registerCommand(openAiFeaturesTools, {
            execute: () => commands.executeCommand(CommonCommands.OPEN_PREFERENCES.id, 'ai-features'),
        });
    }

    override registerMenus(_menus: MenuModelRegistry): void {
        // Do not add the legacy AI Configuration entry to the IDE View menu.
    }

    override registerToolbarItems(_registry: TabBarToolbarRegistry): void {
        // The chat toolbar opens AI Features through the regular settings action.
    }
}

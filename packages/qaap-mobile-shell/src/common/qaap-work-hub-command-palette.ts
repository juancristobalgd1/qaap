// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { Command } from '@theia/core/lib/common/command';
import {
    QAAP_WORK_HUB_AI_CONFIGURATION_COMMAND,
    QAAP_WORK_HUB_AI_FEATURES_COMMAND,
    QAAP_WORK_HUB_COLOR_THEME_COMMAND,
} from './mobile-work-hub-catalog';

/** Opens the Work Hub Settings sheet (preferences embedded overlay). */
export const QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND = 'qaap.workHub.openSettings';

/** Opens the Work Hub Billing sheet. */
export const QAAP_WORK_HUB_OPEN_BILLING_COMMAND = 'qaap.workHub.openBilling';

/** Starts a new agent / empty chat on the Work Hub surface. */
export const QAAP_WORK_HUB_NEW_AGENT_COMMAND = 'qaap.workHub.newAgent';

/** Opens the Work Hub search quick-pick. */
export const QAAP_WORK_HUB_SEARCH_COMMAND = 'qaap.workHub.search';

/** Opens the Work Hub add/open repository dialog. */
export const QAAP_WORK_HUB_OPEN_REPOSITORY_COMMAND = 'qaap.workHub.openRepository';

/**
 * Shared (non-`qaap.*`) command ids that remain useful on the Work Hub surface.
 * Handlers for AI Features / AI Configuration / Preferences are remapped to sheets
 * while the user is on Work Hub; Color Theme works as a quick-pick overlay.
 */
export const WORK_HUB_COMMAND_PALETTE_SHARED_IDS: ReadonlySet<string> = new Set([
    QAAP_WORK_HUB_COLOR_THEME_COMMAND,
    QAAP_WORK_HUB_AI_FEATURES_COMMAND,
    QAAP_WORK_HUB_AI_CONFIGURATION_COMMAND,
    'preferences:open',
    'clear.command.history',
    'theia.mobile.onboarding.replay',
]);

/**
 * Labeled `qaap.*` commands that need args, target IDE chrome, or open the wrong
 * surface — hide from the Work Hub palette so picks do not fail or flash the IDE.
 */
export const WORK_HUB_COMMAND_PALETTE_EXCLUDED_QAAP_IDS: ReadonlySet<string> = new Set([
    'qaap.workHub.submitComposerPrompt',
    'qaap.workHub.pickAgentAndSubmitComposerPrompt',
    'qaap.workHub.openParallelRunsSheet',
    'qaap.workHub.attachComposerContext',
    'qaap.mobile.openAgentOnTask',
    'qaap.mobile.ideHeaderView.options',
    'qaap.mobile.ideHeaderView.active',
    'qaap.mobile.ideHeaderView.activate',
    'qaap.chat.maximize',
    'qaap.hub.resumePreview',
    'qaap.element-inspector.copySelector',
    'qaap.element-inspector.askAgent',
    'qaap.element-inspector.generateVariant',
    'qaap.pickElement',
    'qaap.ai.captureMissionSnapshot',
]);

/** True when the command should appear in the Work Hub command palette. */
export function isWorkHubCommandPaletteCommand(command: Command): boolean {
    const id = command.id;
    if (WORK_HUB_COMMAND_PALETTE_SHARED_IDS.has(id)) {
        return true;
    }
    if (!id.startsWith('qaap.')) {
        return false;
    }
    return !WORK_HUB_COMMAND_PALETTE_EXCLUDED_QAAP_IDS.has(id);
}

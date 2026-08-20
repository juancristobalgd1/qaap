// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Preference key prefixes (and exact keys) that are Theia IDE leftovers in Qaap.
 * Hidden from Settings / Work Hub AI Features; schemas stay registered for compatibility.
 *
 * Items that map to Work Hub (BYOK, MCP, skills, aliases, guidance placeholders) stay visible
 * and are re-labeled via {@link QaapAiPreferenceBrandingStartup}.
 */
export const QAAP_HIDDEN_AI_FEATURES_PREF_PREFIXES: readonly string[] = [
    'ai-features.AiEnable.',
    'ai-features.orchestrator.',
    'ai-features.agentMode.',
    'ai-features.chat.',
    'ai-features.copilot.',
    'ai-features.vercelAi.',
    'ai-features.llamafile.',
    'ai-features.SCANOSS.',
    'ai-features.codeCompletion.',
    'ai-features.registry.',
    // Theia workspace tools / terminal agent — Work Hub uses VPS approval policy instead.
    'ai-features.workspaceFunctions.',
    'ai-features.terminal.',
];

export const QAAP_HIDDEN_AI_FEATURES_PREF_KEYS: readonly string[] = [
    'ai-features.AiEnable.enableAI',
    'ai-features.orchestrator.excludedAgents',
    'ai-features.agentMode.enabled',
    'ai-features.notifications.default',
];

/**
 * Theia Chat agents with no Work Hub VPS equivalent (or that duplicate CLI agents).
 * Coder / Architect / Explore stay for classic IDE chat.
 */
export const QAAP_HIDDEN_AI_CONFIGURATION_AGENT_IDS: readonly string[] = [
    'Orchestrator',
    'Universal',
    'Command',
    'AppTester',
    'ClaudeCode',
    'Codex',
    'CreateSkill',
    'ProjectInfo',
];

/** AI Configuration tabs that only apply to Theia Chat, not Work Hub VPS. */
export const QAAP_HIDDEN_AI_CONFIGURATION_TAB_IDS: readonly string[] = [
    'ai-variable-configuration-container-widget',
    'ai-token-usage-configuration-container-widget',
    'ai-tools-configuration-widget',
];

export function shouldHideQaapAiFeaturesPreference(key: string): boolean {
    if (QAAP_HIDDEN_AI_FEATURES_PREF_KEYS.includes(key)) {
        return true;
    }
    return QAAP_HIDDEN_AI_FEATURES_PREF_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function isQaapHiddenAiConfigurationAgent(agentId: string): boolean {
    return QAAP_HIDDEN_AI_CONFIGURATION_AGENT_IDS.some(id => id.toLowerCase() === agentId.toLowerCase());
}

export function isQaapHiddenAiConfigurationTab(tabId: string): boolean {
    return QAAP_HIDDEN_AI_CONFIGURATION_TAB_IDS.includes(tabId);
}

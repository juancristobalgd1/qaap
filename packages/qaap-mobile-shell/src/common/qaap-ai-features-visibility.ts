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
    // Managed in AI Configuration → Skills (card toggles), not Settings.
    'ai-features.skills.disabledSkills',
    // Managed in AI Configuration → Harness (runtime checks), not Settings.
    'ai-features.harness.disabledAgents',
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

/**
 * AI Configuration tabs omitted from the shared container (Theia Chat–only).
 * Never mounted in {@link QaapAiConfigurationContainerWidget}.
 */
export const QAAP_HIDDEN_AI_CONFIGURATION_TAB_IDS: readonly string[] = [
    'ai-variable-configuration-container-widget',
    'ai-token-usage-configuration-container-widget',
    'ai-tools-configuration-widget',
];

/**
 * Tabs that remain available in classic IDE AI Configuration, but must not appear in the
 * Work Hub overlay (agents/prompts are chosen in the composer / IDE chat only).
 * Model Aliases stays visible in Work Hub (BYOK routing).
 * Skills tab stays visible (SkillService / SKILL.md for composer `/`); only the embedded
 * `.ai-slash-commands-section` (Theia PromptFragment commands) is CSS-hidden in Work Hub.
 */
export const QAAP_WORK_HUB_HIDDEN_AI_CONFIGURATION_TAB_IDS: readonly string[] = [
    'ai-agent-configuration-container-widget', // labeled "IDE Agents"
    'ai-prompt-fragments-configuration', // labeled "Prompt Fragments (IDE)"
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

/** True when this tab must be hidden while AI Configuration is embedded in Work Hub. */
export function isQaapWorkHubHiddenAiConfigurationTab(tabId: string): boolean {
    return QAAP_WORK_HUB_HIDDEN_AI_CONFIGURATION_TAB_IDS.includes(tabId)
        || isQaapHiddenAiConfigurationTab(tabId);
}

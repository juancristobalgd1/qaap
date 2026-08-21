// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapHiddenAiConfigurationAgent,
    isQaapHiddenAiConfigurationTab,
    isQaapWorkHubHiddenAiConfigurationTab,
    shouldHideQaapAiFeaturesPreference,
} from './qaap-ai-features-visibility';

describe('qaap-ai-features-visibility', () => {
    it('hides Theia leftover AI Features preferences', () => {
        expect(shouldHideQaapAiFeaturesPreference('ai-features.copilot.enabled')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.chat.defaultChatAgent')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.AiEnable.enableAI')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.skills.disabledSkills')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.vercelAi.openaiApiKey')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.llamafile.llamafiles')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.SCANOSS.apiKey')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.workspaceFunctions.excludedExtensions')).to.equal(true);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.terminal.denyList')).to.equal(true);
    });

    it('keeps Qaap BYOK and MCP preferences visible', () => {
        expect(shouldHideQaapAiFeaturesPreference('ai-features.openrouter.openrouterApiKey')).to.equal(false);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.nvidia.nvidiaApiKey')).to.equal(false);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.anthropic.AnthropicApiKey')).to.equal(false);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.mcp.mcpServers')).to.equal(false);
        expect(shouldHideQaapAiFeaturesPreference('ai-features.languageModelAliases')).to.equal(false);
    });

    it('hides obsolete Theia chat agents from AI Configuration', () => {
        expect(isQaapHiddenAiConfigurationAgent('Orchestrator')).to.equal(true);
        expect(isQaapHiddenAiConfigurationAgent('universal')).to.equal(true);
        expect(isQaapHiddenAiConfigurationAgent('ClaudeCode')).to.equal(true);
        expect(isQaapHiddenAiConfigurationAgent('Codex')).to.equal(true);
        expect(isQaapHiddenAiConfigurationAgent('Coder')).to.equal(false);
        expect(isQaapHiddenAiConfigurationAgent('Architect')).to.equal(false);
    });

    it('hides Theia-only AI Configuration tabs', () => {
        expect(isQaapHiddenAiConfigurationTab('ai-variable-configuration-container-widget')).to.equal(true);
        expect(isQaapHiddenAiConfigurationTab('ai-tools-configuration-widget')).to.equal(true);
        expect(isQaapHiddenAiConfigurationTab('ai-mcp-configuration-container-widget')).to.equal(false);
        expect(isQaapHiddenAiConfigurationTab('ai-skills-configuration-widget')).to.equal(false);
    });

    it('hides IDE Agents and Prompt Fragments only in the Work Hub sheet', () => {
        expect(isQaapWorkHubHiddenAiConfigurationTab('ai-agent-configuration-container-widget')).to.equal(true);
        expect(isQaapWorkHubHiddenAiConfigurationTab('ai-prompt-fragments-configuration')).to.equal(true);
        // Model Aliases stays in Work Hub (BYOK routing).
        expect(isQaapWorkHubHiddenAiConfigurationTab('ai-model-aliases-configuration-widget')).to.equal(false);
        expect(isQaapWorkHubHiddenAiConfigurationTab('ai-mcp-configuration-container-widget')).to.equal(false);
        expect(isQaapWorkHubHiddenAiConfigurationTab('ai-skills-configuration-widget')).to.equal(false);
    });
});

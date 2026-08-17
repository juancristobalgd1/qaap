// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    ANTIGRAVITY_API_MODELS,
    agentUsesNativeModelCatalog,
    agentUsesSettingsModelCatalog,
    listStaticAntigravityModels,
    listStaticNativeAgentModels,
    parseNativeModelLines,
} from './qaap-agent-native-model-catalog';

describe('qaap-agent-native-model-catalog', () => {
    it('only QAIQ uses the Settings model catalog', () => {
        expect(agentUsesSettingsModelCatalog('qaiq')).to.equal(true);
        expect(agentUsesSettingsModelCatalog('openclaude')).to.equal(false);
        expect(agentUsesSettingsModelCatalog('qwen')).to.equal(false);
        expect(agentUsesSettingsModelCatalog('opencode')).to.equal(false);
        expect(agentUsesSettingsModelCatalog('codex')).to.equal(false);
    });

    it('treats other VPS agents as native catalogs', () => {
        expect(agentUsesNativeModelCatalog('opencode')).to.equal(true);
        expect(agentUsesNativeModelCatalog('qwen')).to.equal(true);
        expect(agentUsesNativeModelCatalog('qaiq')).to.equal(false);
        expect(agentUsesNativeModelCatalog('openclaude')).to.equal(true);
        expect(agentUsesNativeModelCatalog('shell')).to.equal(false);
        expect(agentUsesNativeModelCatalog('cursor')).to.equal(false);
        expect(agentUsesNativeModelCatalog('goose')).to.equal(false);
        expect(agentUsesNativeModelCatalog('hermes')).to.equal(true);
    });

    it('parses CLI model lines', () => {
        const models = parseNativeModelLines('opencode', ['  opencode/foo  ', '# comment', 'opencode/foo', 'bar']);
        expect(models.map(m => m.modelId)).to.deep.equal(['opencode/foo', 'bar']);
        expect(models.every(m => m.vendor === 'opencode')).to.equal(true);
    });

    it('lists static fallbacks per agent', () => {
        expect(listStaticNativeAgentModels('codex').length).to.be.greaterThan(0);
        expect(listStaticNativeAgentModels('qwen').map(m => m.modelId)).to.include('qwen3-coder-plus');
        expect(listStaticNativeAgentModels('openclaude').map(m => m.modelId)).to.deep.equal([
            'claude-sonnet-4-6',
            'claude-opus-4-7',
            'claude-haiku-4-5',
            'gpt-4o',
            'gpt-5.4',
            'gemini-3.1-pro',
            'mistral-large-latest',
            'qwen2.5-coder:7b',
        ]);
        expect(listStaticNativeAgentModels('hermes').map(m => m.modelId)).to.include('anthropic/claude-fable-5');
        expect(listStaticNativeAgentModels('unknown-agent')).to.deep.equal([]);
    });

    it('lists frontier Claude Code, Codex, and Copilot models', () => {
        const claude = listStaticNativeAgentModels('claude').map(m => m.modelId);
        expect(claude).to.deep.equal([
            'claude-fable-5',
            'claude-opus-4-8',
            'claude-sonnet-5',
            'claude-haiku-4-5',
            'claude-sonnet-4-6',
            'claude-opus-4-7',
        ]);

        const codex = listStaticNativeAgentModels('codex').map(m => m.modelId);
        expect(codex).to.deep.equal([
            'gpt-5.6-sol',
            'gpt-5.6-terra',
            'gpt-5.6-luna',
            'gpt-5.5',
        ]);

        const copilot = listStaticNativeAgentModels('copilot').map(m => m.modelId);
        expect(copilot).to.deep.equal([
            'gpt-5.6-sol',
            'gpt-5.6-terra',
            'gpt-5.6-luna',
            'claude-sonnet-5',
            'claude-opus-4.8',
        ]);
    });

    it('lists Antigravity API models from the CLI /model menu', () => {
        const models = listStaticAntigravityModels('antigravity');
        expect(models).to.have.length(ANTIGRAVITY_API_MODELS.length);
        expect(models.map(m => m.modelId)).to.deep.equal(ANTIGRAVITY_API_MODELS.map(m => m.label));
        expect(models.map(m => m.label)).to.deep.equal(ANTIGRAVITY_API_MODELS.map(m => m.label));
        expect(listStaticNativeAgentModels('gemini').map(m => m.modelId))
            .to.deep.equal(listStaticAntigravityModels('gemini').map(m => m.modelId));
    });
});

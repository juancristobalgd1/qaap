// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    ANTIGRAVITY_API_MODELS,
    GEMINI_CLI_MODEL_OPTIONS,
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
        expect(agentUsesNativeModelCatalog('cursor')).to.equal(true);
        expect(agentUsesNativeModelCatalog('goose')).to.equal(false);
        expect(agentUsesNativeModelCatalog('hermes')).to.equal(true);
    });

    it('parses CLI model lines', () => {
        const models = parseNativeModelLines('opencode', ['  opencode/foo  ', '# comment', 'opencode/foo']);
        expect(models.map(m => m.modelId)).to.deep.equal(['opencode/foo']);
        expect(models.every(m => m.vendor === 'opencode')).to.equal(true);
    });

    it('ignores OpenCode diagnostics when they are printed as model lines', () => {
        const models = parseNativeModelLines('opencode', [
            "EROFS: read-only file system, mkdir '/home/theia/.local'",
            'path: "/home/theia/.local",',
            'opencode/big-pickle',
            'syscall: "mkdir",',
            'code: "EROFS"',
        ]);

        expect(models.map(m => m.modelId)).to.deep.equal(['opencode/big-pickle']);
    });

    it('lists static fallbacks per agent', () => {
        expect(listStaticNativeAgentModels('codex').length).to.be.greaterThan(0);
        expect(listStaticNativeAgentModels('qwen').map(m => m.modelId)).to.include('qwen3-coder-plus');
        const opencodeIds = listStaticNativeAgentModels('opencode').map(m => m.modelId);
        expect(opencodeIds.slice(0, 10)).to.deep.equal([
            'opencode/beam-free',
            'opencode/big-pickle',
            'opencode/deepseek-v4.1-flash-free',
            'opencode/flint-40b-free',
            'opencode/glm-5.3-flash-free',
            'opencode/mimo-v2.6-flash-free',
            'opencode/minimax-m3.1-flash-free',
            'opencode/nemotron-3-ultra-free',
            'opencode/nemotron-3.5-lightning-free',
            'opencode/nemotron-3.5-super-vl-free',
        ]);
        expect(opencodeIds).to.have.length(83);
        expect(opencodeIds).to.not.include('opencode/mimo-v2.5-free');
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
            'claude-fable-5-1',
            'claude-opus-5-5',
            'claude-sonnet-5-5',
            'claude-haiku-5-5',
            'claude-fable-5',
            'claude-sonnet-5',
        ]);

        const codex = listStaticNativeAgentModels('codex').map(m => m.modelId);
        expect(codex).to.deep.equal([
            'gpt-6-luna',
            'gpt-5.6-terra',
            'gpt-5.6-luna',
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
        expect(models[0].label).to.equal('Gemini 3.8 Flash (High)');
        expect(models.map(m => m.label)).to.deep.equal(ANTIGRAVITY_API_MODELS.map(m => m.label));
        expect(listStaticAntigravityModels('antigravity', 'agy').map(m => m.modelId)).to.deep.equal(models.map(m => m.modelId));
    });

    it('lists the Gemini CLI model ids when gemini is the resolved Antigravity CLI', () => {
        const models = listStaticAntigravityModels('antigravity', 'gemini');
        expect(models.map(m => m.modelId)).to.deep.equal(GEMINI_CLI_MODEL_OPTIONS.map(entry => entry.modelId));
        expect(models[0]).to.deep.equal({ provider: 'gemini', vendor: 'antigravity', modelId: 'auto', label: 'Auto' });
        expect(models.find(m => m.modelId === 'gemini-3.5-flash')).to.deep.equal({
            provider: 'gemini',
            vendor: 'antigravity',
            modelId: 'gemini-3.5-flash',
            label: 'Gemini 3.5 Flash',
        });
        expect(listStaticNativeAgentModels('antigravity', 'gemini').map(m => m.modelId))
            .to.deep.equal(models.map(m => m.modelId));
        expect(listStaticNativeAgentModels('gemini').map(m => m.modelId))
            .to.deep.equal(models.map(m => m.modelId));
    });

    it('keeps the agy labels for an unresolved or agy Antigravity bin', () => {
        const agyLabels = ANTIGRAVITY_API_MODELS.map(m => m.label);
        expect(listStaticNativeAgentModels('antigravity').map(m => m.modelId)).to.deep.equal(agyLabels);
        expect(listStaticNativeAgentModels('antigravity', 'agy').map(m => m.modelId)).to.deep.equal(agyLabels);
        expect(listStaticNativeAgentModels('antigravity', 'antigravity').map(m => m.modelId)).to.deep.equal(agyLabels);
    });

    it('keeps the Gemini CLI catalog to real gemini model ids plus the auto alias, default first and unique', () => {
        const ids = GEMINI_CLI_MODEL_OPTIONS.map(entry => entry.modelId);
        expect(new Set(ids).size).to.equal(ids.length);
        expect(ids[0]).to.equal('auto');
        for (const id of ids.slice(1)) {
            expect(id, id).to.match(/^gemini-[a-z0-9.-]+$/);
        }
        expect(ids.some(id => id.includes(' ') || id.includes('('))).to.equal(false);
    });
});

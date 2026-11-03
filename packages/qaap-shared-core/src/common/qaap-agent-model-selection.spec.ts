// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { OPENROUTER_DEFAULT_FREE_MODELS } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';
import {
    agentSupportsModelPicker,
    agentUsesNativeModelCatalog,
    agentUsesSettingsModelCatalog,
    ensureStoredAgentModel,
    isFreeAgentModel,
    isStoredAgentModelUsable,
    pickDefaultAgentModel,
    readStoredAgentModel,
    resolveAgentModelForSubmit,
    scopedAgentModelStorageKey,
    setAgentModelStorageUserLogin,
    writeStoredAgentModel,
} from './qaap-agent-model-selection';
import { OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, SHELL_AGENT_ID, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';

describe('qaap-agent-model-selection', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        setAgentModelStorageUserLogin(undefined);
        (global as unknown as { window: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
    });

    it('agentSupportsModelPicker excludes shell and local Coder', () => {
        expect(agentSupportsModelPicker('grok')).to.be.true;
        expect(agentSupportsModelPicker(SHELL_AGENT_ID)).to.be.false;
        expect(agentSupportsModelPicker(THEIA_CODER_AGENT_ID)).to.be.false;
    });

    it('QAIQ reads Settings models while OpenClaude uses its native catalog', () => {
        expect(agentUsesSettingsModelCatalog(QAIQ_AGENT_ID)).to.be.true;
        expect(agentUsesSettingsModelCatalog(OPENCLAUDE_AGENT_ID)).to.be.false;
        expect(agentUsesSettingsModelCatalog('qwen')).to.be.false;
        expect(agentUsesSettingsModelCatalog('opencode')).to.be.false;
        expect(agentUsesNativeModelCatalog('qwen')).to.be.true;
        expect(agentUsesNativeModelCatalog('opencode')).to.be.true;
        expect(agentUsesNativeModelCatalog('goose')).to.be.false;
        expect(agentUsesNativeModelCatalog('hermes')).to.be.true;
        expect(agentSupportsModelPicker('hermes')).to.be.true;
        expect(agentUsesNativeModelCatalog('pi')).to.be.true;
        expect(agentSupportsModelPicker('pi')).to.be.true;
        expect(agentUsesNativeModelCatalog(QAIQ_AGENT_ID)).to.be.false;
        expect(agentUsesNativeModelCatalog(OPENCLAUDE_AGENT_ID)).to.be.true;
        expect(agentUsesNativeModelCatalog('cursor')).to.be.true;
        expect(agentSupportsModelPicker('cursor')).to.be.true;
        expect(agentSupportsModelPicker('goose')).to.be.false;
    });

    it('rejects excluded OpenRouter slugs and clears stale localStorage', () => {
        const cwd = '/repo/a';
        const bad = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'deepseek/deepseek-v4-flash:free' };
        expect(isStoredAgentModelUsable(bad)).to.be.false;
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, bad);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)).to.be.undefined;
    });

    it('rejects excluded OpenRouter slugs stored under a native Hermes vendor', () => {
        const cwd = '/repo/hermes-stale';
        const bad = {
            provider: 'openai' as const,
            vendor: 'inclusionai',
            modelId: 'inclusionai/ring-2.6-1t:free',
        };
        expect(isStoredAgentModelUsable(bad)).to.be.false;
        writeStoredAgentModel(cwd, 'hermes', bad);
        expect(readStoredAgentModel(cwd, 'hermes')).to.be.undefined;
    });

    it('keeps a stored pick of the QAIQ default Nemotron 3 Ultra free model (live again since Oct 21 2026)', () => {
        const model = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free' };
        expect(isStoredAgentModelUsable(model)).to.be.true;
    });

    it('rejects confirmed tool-less models and clears stale localStorage', () => {
        const cwd = '/repo/tool-less';
        const bad = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'tencent/hy3:free' };
        expect(isStoredAgentModelUsable(bad)).to.be.false;
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, bad);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)).to.be.undefined;
    });

    it('stores models per agent within the same cwd', () => {
        const cwd = '/repo/a';
        const qaiqModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'a/b' };
        const grokModel = { provider: 'openai' as const, vendor: 'nvidia', modelId: 'meta/llama' };
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, qaiqModel);
        writeStoredAgentModel(cwd, 'grok', grokModel);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)).to.deep.equal(qaiqModel);
        expect(readStoredAgentModel(cwd, 'grok')).to.deep.equal(grokModel);
    });

    it('keeps OpenClaude model storage separate from QAIQ', () => {
        const cwd = '/repo/openclaude';
        const qaiqModel = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'qaiq/model' };
        const openclaudeModel = { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'openclaude/model' };
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, qaiqModel);
        writeStoredAgentModel(cwd, OPENCLAUDE_AGENT_ID, openclaudeModel);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)).to.deep.equal(qaiqModel);
        expect(readStoredAgentModel(cwd, OPENCLAUDE_AGENT_ID)).to.deep.equal(openclaudeModel);
    });

    it('resolveAgentModelForSubmit prefers explicit runtime model over stored default', () => {
        const cwd = '/repo/a';
        const stored = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'stored/model' };
        const runtime = { provider: 'anthropic' as const, vendor: 'anthropic', modelId: 'claude-sonnet-4' };
        writeStoredAgentModel(cwd, 'opencode', stored);
        expect(resolveAgentModelForSubmit('opencode', cwd, runtime)).to.deep.equal(runtime);
        expect(resolveAgentModelForSubmit('opencode', cwd)).to.deep.equal(stored);
    });

    it('ensureStoredAgentModel seeds the first usable catalog entry when empty', () => {
        const cwd = '/repo';
        expect(readStoredAgentModel(cwd, 'opencode')).to.be.undefined;
        const catalog = [
            { provider: 'openai' as const, vendor: 'opencode', modelId: 'opencode/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
            { provider: 'openai' as const, vendor: 'opencode', modelId: 'opencode/gpt-5', label: 'GPT-5' },
        ];
        expect(pickDefaultAgentModel(catalog)?.modelId).to.equal('opencode/claude-sonnet-4-6');
        const seeded = ensureStoredAgentModel(cwd, 'opencode', catalog);
        expect(seeded?.modelId).to.equal('opencode/claude-sonnet-4-6');
        expect(readStoredAgentModel(cwd, 'opencode')?.modelId).to.equal('opencode/claude-sonnet-4-6');
        const again = ensureStoredAgentModel(cwd, 'opencode', [
            { provider: 'openai' as const, vendor: 'opencode', modelId: 'opencode/gpt-5', label: 'GPT-5' },
        ]);
        expect(again?.modelId).to.equal('opencode/gpt-5');
        expect(readStoredAgentModel(cwd, 'opencode')?.modelId).to.equal('opencode/gpt-5');
    });

    it('pickDefaultAgentModel skips models the plan or connection denies', () => {
        const base = { provider: 'openai' as const, vendor: 'codex' };
        expect(pickDefaultAgentModel([
            { ...base, modelId: 'gpt-pro', label: 'GPT Pro', available: false, unavailableReason: 'plan' },
            { ...base, modelId: 'gpt-offline', label: 'GPT Offline', available: false, unavailableReason: 'not-connected' },
            { ...base, modelId: 'gpt-mini', label: 'GPT Mini', available: true },
        ])?.modelId).to.equal('gpt-mini');
        expect(pickDefaultAgentModel([
            { ...base, modelId: 'gpt-pro', label: 'GPT Pro', available: false, unavailableReason: 'plan' },
        ])).to.equal(undefined);
    });

    it('ensureStoredAgentModel keeps an explicit stored choice even if the catalog marks it unavailable', () => {
        const base = { provider: 'openai' as const, vendor: 'codex' };
        writeStoredAgentModel('/repo', 'codex', { ...base, modelId: 'gpt-pro', label: 'GPT Pro' });
        const resolved = ensureStoredAgentModel('/repo', 'codex', [
            { ...base, modelId: 'gpt-pro', label: 'GPT Pro', available: false, unavailableReason: 'plan' },
            { ...base, modelId: 'gpt-mini', label: 'GPT Mini', available: true },
        ]);
        expect(resolved?.modelId).to.equal('gpt-pro');
    });

    it('pickDefaultAgentModel prefers the QAIQ default free model over a paid entry listed first', () => {
        const paid = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku' };
        const free = { provider: 'openai' as const, vendor: 'openrouter', modelId: OPENROUTER_DEFAULT_FREE_MODELS[0], label: 'Nemotron Ultra' };
        expect(pickDefaultAgentModel([paid, free])?.modelId).to.equal(OPENROUTER_DEFAULT_FREE_MODELS[0]);
        expect(pickDefaultAgentModel([paid, { ...free, modelId: 'google/gemma-4-31b-it:free' }])?.modelId)
            .to.equal('google/gemma-4-31b-it:free');
        expect(isFreeAgentModel({ modelId: 'x/y:free' })).to.be.true;
        expect(isFreeAgentModel({ modelId: 'openai/gpt-5' })).to.be.false;
    });

    it('ensureStoredAgentModel seeds a free model for a project with no explicit choice', () => {
        const paid = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openai/gpt-5', label: 'GPT-5' };
        const free = { provider: 'openai' as const, vendor: 'openrouter', modelId: OPENROUTER_DEFAULT_FREE_MODELS[0], label: 'Nemotron Ultra' };
        const seeded = ensureStoredAgentModel('/repo-free', QAIQ_AGENT_ID, [paid, free]);
        expect(seeded?.modelId).to.equal(OPENROUTER_DEFAULT_FREE_MODELS[0]);
    });

    it('a paid default the user never chose yields to a free model; a user-chosen paid model is kept', () => {
        const cwd = '/repo-legacy';
        const paid = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openai/gpt-5', label: 'GPT-5' };
        const free = { provider: 'openai' as const, vendor: 'openrouter', modelId: OPENROUTER_DEFAULT_FREE_MODELS[0], label: 'Nemotron Ultra' };
        // Seeded by an older build: no userChosen marker.
        storage.set(scopedAgentModelStorageKey(cwd, QAIQ_AGENT_ID), JSON.stringify({ provider: paid.provider, vendor: paid.vendor, modelId: paid.modelId }));
        expect(ensureStoredAgentModel(cwd, QAIQ_AGENT_ID, [paid, free])?.modelId).to.equal(OPENROUTER_DEFAULT_FREE_MODELS[0]);
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, paid);
        expect(ensureStoredAgentModel(cwd, QAIQ_AGENT_ID, [paid, free])?.modelId).to.equal('openai/gpt-5');
    });

    it('scopes stored model picks per authenticated user', () => {
        const cwd = '/workspace/repos/users/alice/acme/app';
        const modelA = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'openai/gpt-4o-mini' };
        const modelB = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-31b-it:free' };
        setAgentModelStorageUserLogin('alice');
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, modelA);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)?.modelId).to.equal(modelA.modelId);
        setAgentModelStorageUserLogin('bob');
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)).to.be.undefined;
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, modelB);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)?.modelId).to.equal(modelB.modelId);
        setAgentModelStorageUserLogin('alice');
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)?.modelId).to.equal(modelA.modelId);
    });
});

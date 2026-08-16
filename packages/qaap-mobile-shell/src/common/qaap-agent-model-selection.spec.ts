// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    agentSupportsModelPicker,
    agentUsesNativeModelCatalog,
    agentUsesSettingsModelCatalog,
    ensureStoredAgentModel,
    isStoredAgentModelUsable,
    pickDefaultAgentModel,
    readStoredAgentModel,
    resolveAgentModelForSubmit,
    writeStoredAgentModel,
} from './qaap-agent-model-selection';
import { OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID, SHELL_AGENT_ID, THEIA_CODER_AGENT_ID } from './qaap-agent-task-client';

describe('qaap-agent-model-selection', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
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
        expect(agentUsesNativeModelCatalog('hermes')).to.be.false;
        expect(agentUsesNativeModelCatalog(QAIQ_AGENT_ID)).to.be.false;
        expect(agentUsesNativeModelCatalog(OPENCLAUDE_AGENT_ID)).to.be.true;
        expect(agentUsesNativeModelCatalog('cursor')).to.be.false;
        expect(agentSupportsModelPicker('cursor')).to.be.false;
        expect(agentSupportsModelPicker('goose')).to.be.false;
    });

    it('rejects excluded OpenRouter slugs and clears stale localStorage', () => {
        const cwd = '/repo/a';
        const bad = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'deepseek/deepseek-v4-flash:free' };
        expect(isStoredAgentModelUsable(bad)).to.be.false;
        writeStoredAgentModel(cwd, QAIQ_AGENT_ID, bad);
        expect(readStoredAgentModel(cwd, QAIQ_AGENT_ID)).to.be.undefined;
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
});

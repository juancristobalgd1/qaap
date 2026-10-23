// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { buildTemplateVarsExtracted, resolveAgentModelForRequestExtracted } from './qaap-agent-task-runner-streaming2';
import { normalizeQaiqModelBinding } from '../common/qaap-qaiq-model-binding';

/**
 * A model from one CLI's catalog must never reach another CLI's argv. QAIQ's default (the env
 * fallback / Settings alias, e.g. NVIDIA `meta/llama-3.3-70b-instruct`) handed to `claude` became
 * `claude --model meta/llama-3.3-70b-instruct` → 404 model_not_found.
 */
describe('agent task model — never hand one CLI another backend\'s model', () => {

    const llama = { provider: 'openai', vendor: 'nvidia', modelId: 'meta/llama-3.3-70b-instruct' } as const;
    const kimi = { provider: 'openai', vendor: 'openrouter', modelId: 'moonshotai/kimi-k2.6:free' } as const;
    const haiku = { provider: 'anthropic', vendor: 'claude', modelId: 'claude-haiku-4-5' } as const;
    const codexSol = { provider: 'openai', vendor: 'codex', modelId: 'gpt-5.6-sol' } as const;

    /** QAIQ is fully configured (aliases + NVIDIA key), which is what made its default leak. */
    function context(agentId: string): QaapAgentTaskRunnerContext {
        const prefs: Record<string, unknown> = {
            'ai-features.languageModelAliases': {
                'default/code': { selectedModel: 'nvidia/meta/llama-3.3-70b-instruct' },
                'default/universal': { selectedModel: 'nvidia/meta/llama-3.3-70b-instruct' },
            },
        };
        const readPref = (key: string): unknown => prefs[key];
        return {
            resolveAgentId: (_prompt: string, agent?: string) => agent ?? agentId,
            preferenceService: { get: () => undefined },
            preferenceReaderForOwner: () => readPref,
            previewProviderEnv: () => ({ NVIDIA_API_KEY: 'nvapi-test' }),
            nativeModelRoutingTable: () => ({}),
            normalizeAgentBinding: (binding: Parameters<typeof normalizeQaiqModelBinding>[0]) => normalizeQaiqModelBinding(binding, readPref),
            resolveQaiqProviderFlags: () => '--provider openai --model meta/llama-3.3-70b-instruct',
        } as unknown as QaapAgentTaskRunnerContext;
    }

    function resolve(agentId: string, request: Record<string, unknown>): unknown {
        return resolveAgentModelForRequestExtracted(
            context(agentId),
            { prompt: 'Implement the OAuth callback fix', cwd: '/repo', agent: agentId, ...request },
            'Implement the OAuth callback fix',
        );
    }

    it('runs claude on its own default when the request carries no model', () => {
        expect(resolve('claude', {})).to.equal(undefined);
    });

    for (const agentId of ['claude', 'codex', 'copilot', 'gemini', 'grok', 'opencode', 'qwen']) {
        it(`drops a QAIQ model sent for ${agentId} (agentModel or legacy qaiqModel)`, () => {
            expect(resolve(agentId, { agentModel: llama }), 'agentModel').to.equal(undefined);
            expect(resolve(agentId, { qaiqModel: kimi }), 'qaiqModel').to.equal(undefined);
        });
    }

    it('drops another native CLI\'s model (codex pick sent to claude, claude pick sent to codex)', () => {
        expect(resolve('claude', { agentModel: codexSol })).to.equal(undefined);
        expect(resolve('codex', { agentModel: haiku })).to.equal(undefined);
    });

    it('keeps a model from the agent\'s own catalog', () => {
        expect(resolve('claude', { agentModel: haiku })).to.deep.equal(haiku);
        expect(resolve('codex', { agentModel: codexSol })).to.deep.equal(codexSol);
    });

    it('keeps QAIQ on its own Settings models and never runs it on a native CLI\'s model', () => {
        expect(resolve('qaiq', { agentModel: llama })).to.deep.equal(llama);
        expect(resolve('qaiq', { agentModel: haiku })).to.not.deep.equal(haiku);
    });

    it('emits no --model flag for claude when handed a QAIQ model directly (prompt improve, reviewer)', () => {
        const vars = buildTemplateVarsExtracted(context('claude'), 'claude', llama);
        expect(vars.model_flags).to.equal('');
        expect(vars.qaiq_flags).to.equal('');
    });

    it('still emits the agent\'s own model flag', () => {
        expect(buildTemplateVarsExtracted(context('claude'), 'claude', haiku).model_flags).to.contain('claude-haiku-4-5');
        expect(buildTemplateVarsExtracted(context('codex'), 'codex', codexSol).model_flags).to.equal('-m gpt-5.6-sol');
    });
});

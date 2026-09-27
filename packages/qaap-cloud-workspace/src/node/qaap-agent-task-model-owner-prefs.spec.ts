// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { resolveAgentModelForRequestExtracted } from './qaap-agent-task-runner-streaming2';

describe('resolveAgentModelForRequest — per-user AI settings', () => {

    const kimi = { provider: 'openai', vendor: 'openrouter', modelId: 'moonshotai/kimi-k2.6:free' } as const;

    /** Hosted setup: the OpenRouter key lives in the user's settings; the server env only has Ollama. */
    function hostedContext(): QaapAgentTaskRunnerContext {
        const userSettings: Record<string, unknown> = { 'ai-features.openrouter.openrouterApiKey': 'sk-or-user' };
        return {
            resolveAgentId: () => 'qaiq',
            preferenceService: { get: () => undefined },
            preferenceReaderForOwner: (owner?: string) => (key: string) => (owner === 'alice' ? userSettings[key] : undefined),
            previewProviderEnv: () => ({ OLLAMA_HOST: 'http://ollama:11434' }),
            nativeModelRoutingTable: () => ({}),
        } as unknown as QaapAgentTaskRunnerContext;
    }

    it('keeps the picked OpenRouter model when the key is only in the owner\'s settings', () => {
        const model = resolveAgentModelForRequestExtracted(hostedContext(), { prompt: 'hola', cwd: '/repo', agent: 'qaiq', agentModel: kimi }, 'hola', 'alice');
        expect(model).to.deep.equal(kimi);
    });

    it('still falls back to a credentialed env model when the owner has no key for the pick', () => {
        const model = resolveAgentModelForRequestExtracted(hostedContext(), { prompt: 'hola', cwd: '/repo', agent: 'qaiq', agentModel: kimi }, 'hola', 'bob');
        expect(model).to.deep.include({ vendor: 'ollama', modelId: 'qwen2.5-coder:7b' });
    });
});

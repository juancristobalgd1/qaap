// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    agentModelKey,
    agentTurnHasRetryableEmptyOutput,
    agentTurnHasRetryableQuotaFailure,
    buildAgentModelFallbackChain,
    resolveNextFallbackAgentModel,
} from './qaap-agent-model-fallback';

describe('qaap-agent-model-fallback', () => {
    it('builds an OpenRouter chain with the current model first', () => {
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'moonshotai/kimi-k2.6:free',
        };
        const chain = buildAgentModelFallbackChain('qaiq', current);
        expect(chain.map(agentModelKey)).to.deep.equal([
            'openrouter/moonshotai/kimi-k2.6:free',
            'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
            'openrouter/google/gemma-4-31b-it:free',
        ]);
    });

    it('skips models already tried', () => {
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'moonshotai/kimi-k2.6:free',
        };
        const tried = new Set([
            'openrouter/moonshotai/kimi-k2.6:free',
            'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
        ]);
        const next = resolveNextFallbackAgentModel('qaiq', current, tried);
        expect(agentModelKey(next)).to.equal('openrouter/google/gemma-4-31b-it:free');
    });

    it('treats empty agent output as retryable', () => {
        expect(agentTurnHasRetryableEmptyOutput(undefined)).to.be.true;
        expect(agentTurnHasRetryableEmptyOutput({ content: '' })).to.be.true;
        expect(agentTurnHasRetryableEmptyOutput({
            segments: [{ type: 'thinking', content: 'hmm' }],
        })).to.be.true;
        expect(agentTurnHasRetryableEmptyOutput({
            segments: [{ type: 'text', content: 'done' }],
        })).to.be.false;
    });

    it('retries explicit credit exhaustion even when the provider returned text', () => {
        expect(agentTurnHasRetryableQuotaFailure({
            content: 'Free credits for this model are exhausted.',
        })).to.be.true;
        expect(agentTurnHasRetryableQuotaFailure({
            segments: [{ type: 'text', content: 'Error: insufficient_quota' }],
        })).to.be.true;
    });

    it('does not switch models for ordinary implementation errors', () => {
        expect(agentTurnHasRetryableQuotaFailure({ content: 'TypeError: build failed' })).to.be.false;
        expect(agentTurnHasRetryableQuotaFailure(undefined)).to.be.false;
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAIQ_AGENT_ID } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import {
    agentModelKey,
    agentTurnHasRetryableEmptyOutput,
    agentTurnHasRetryableModelFailure,
    agentTurnHasRetryableQuotaFailure,
    agentTurnHasRetryableToolSupportFailure,
    agentTurnQualifiesForModelFallback,
    buildAgentModelFallbackChain,
    resolveAgentModelFallbackReason,
    resolveNextFallbackAgentModel,
} from './qaap-agent-model-fallback';

describe('qaap-agent-model-fallback', () => {
    it('names the reason a turn was re-run: unavailable model vs. any other failed turn', () => {
        const unavailable = { content: "There's an issue with the selected model (x). It may not exist or you may not have access to it." };
        expect(resolveAgentModelFallbackReason(unavailable)).to.equal('model-unavailable');
        expect(resolveAgentModelFallbackReason({ content: '' })).to.equal('turn-failed');
        expect(resolveAgentModelFallbackReason(undefined)).to.equal('turn-failed');
    });

    it('builds an OpenRouter chain with the current model first', () => {
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'moonshotai/kimi-k2.6:free',
        };
        const chain = buildAgentModelFallbackChain('qaiq', current);
        expect(chain.map(agentModelKey)).to.deep.equal([
            'openrouter/moonshotai/kimi-k2.6:free',
            'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
            'openrouter/google/gemma-4-31b-it:free',
            'openrouter/poolside/laguna-s-2.1:free',
        ]);
    });

    it('falls back from the default across different upstream providers', () => {
        // Oct 21 2026 incident: the old default's only (Nvidia) endpoint died. The default's
        // chain must not stay with one upstream provider, or one outage kills every retry.
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        };
        const chain = buildAgentModelFallbackChain('qaiq', current);
        expect(chain.map(agentModelKey)).to.deep.equal([
            'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
            'openrouter/google/gemma-4-31b-it:free',
            'openrouter/poolside/laguna-s-2.1:free',
            'openrouter/cohere/north-mini-code:free',
        ]);
        const orgs = new Set(chain.map(model => model.modelId.split('/')[0]));
        expect(orgs.size).to.equal(chain.length);
    });

    it('moves a stored pick of the dead old default onto live models', () => {
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
        };
        const next = resolveNextFallbackAgentModel('qaiq', current, new Set(['openrouter/nvidia/nemotron-3-super-120b-a12b:free']));
        expect(agentModelKey(next)).to.equal('openrouter/nvidia/nemotron-3-ultra-550b-a55b:free');
    });

    it('skips models already tried', () => {
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'moonshotai/kimi-k2.6:free',
        };
        const tried = new Set([
            'openrouter/moonshotai/kimi-k2.6:free',
            'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
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

    it('treats a turn that only printed its provider error as having no output', () => {
        const providerError = '\n\n**Error:** {"message":"Provider returned error","code":503}';
        expect(agentTurnHasRetryableEmptyOutput({
            segments: [{ type: 'text', content: providerError }],
        })).to.be.true;
        expect(agentTurnHasRetryableEmptyOutput({ content: providerError })).to.be.true;
        expect(agentTurnHasRetryableEmptyOutput({
            segments: [{ type: 'text', content: `Partial answer${providerError}` }],
        })).to.be.false;
        expect(agentTurnQualifiesForModelFallback('pi', { state: 'failed' }, {
            segments: [{ type: 'text', content: providerError }],
        })).to.be.true;
    });

    it('builds the Pi chain from the owner discovered models, without the failed one, capped at four', () => {
        const failed = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'recursive/flint-v1.0:free' };
        const discovered = ['recursive/flint-v1.0:free', 'deepseek/a:free', 'qwen/b:free', 'z-ai/c:free', 'mistral/d:free']
            .map(modelId => ({ provider: 'openai' as const, vendor: 'openrouter', modelId }));
        const chain = buildAgentModelFallbackChain('pi', failed, discovered);
        expect(chain.map(agentModelKey)).to.deep.equal([
            'openrouter/recursive/flint-v1.0:free',
            'openrouter/deepseek/a:free',
            'openrouter/qwen/b:free',
            'openrouter/z-ai/c:free',
        ]);
        // The caller records the failed model as tried, so the next pick is the first untried discovered one.
        expect(resolveNextFallbackAgentModel('pi', failed, new Set(['openrouter/recursive/flint-v1.0:free', 'openrouter/deepseek/a:free']), discovered)?.modelId)
            .to.equal('qwen/b:free');
    });

    it('never falls back from a paid model, and never picks a paid fallback target', () => {
        const paid = { provider: 'openai' as const, vendor: 'openrouter', modelId: '~anthropic/claude-fable-latest' };
        const discovered = [
            { provider: 'openai' as const, vendor: 'openrouter', modelId: '~anthropic/claude-sonnet-latest' },
            { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free' },
        ];
        expect(buildAgentModelFallbackChain('pi', paid, discovered).map(agentModelKey)).to.deep.equal([agentModelKey(paid)]);
        expect(resolveNextFallbackAgentModel('pi', paid, new Set([agentModelKey(paid)!]), discovered)).to.equal(undefined);
        expect(buildAgentModelFallbackChain('pi', paid).map(agentModelKey)).to.deep.equal([agentModelKey(paid)]);
    });

    it('a free model falls back to free discovered models only, never to a paid one', () => {
        const free = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free' };
        const discovered = [
            { provider: 'openai' as const, vendor: 'openrouter', modelId: '~anthropic/claude-fable-latest' },
            { provider: 'openai' as const, vendor: 'openrouter', modelId: 'poolside/laguna-s-2.1:free' },
            { provider: 'openai' as const, vendor: 'openrouter', modelId: 'cohere/north-mini-code:free' },
        ];
        const chain = buildAgentModelFallbackChain('pi', free, discovered).map(agentModelKey);
        expect(chain).to.deep.equal([
            'openrouter/google/gemma-4-26b-a4b-it:free',
            'openrouter/poolside/laguna-s-2.1:free',
            'openrouter/cohere/north-mini-code:free',
        ]);
    });

    it('a free model with only paid candidates has no fallback', () => {
        const free = { provider: 'openai' as const, vendor: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free' };
        const paidOnly = [{ provider: 'openai' as const, vendor: 'openrouter', modelId: '~anthropic/claude-sonnet-latest' }];
        expect(buildAgentModelFallbackChain('pi', free, paidOnly).map(agentModelKey)).to.deep.equal([agentModelKey(free)]);
        expect(resolveNextFallbackAgentModel('pi', free, new Set([agentModelKey(free)!]), paidOnly)).to.equal(undefined);
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

    it('retries when the model emitted its tool call as plain text on a clean exit', () => {
        // tencent/hy3:free (no native function calling): exit 0, no tool segments, JSON-as-text.
        expect(agentTurnHasRetryableToolSupportFailure({
            segments: [
                { type: 'text', content: '{ "command": "ls -la", "description": "List all files in the current directory" }' },
            ],
        })).to.be.true;
        expect(agentTurnHasRetryableToolSupportFailure({
            content: '{"command": "npm test"}',
        })).to.be.true;
    });

    it('retries when the provider says the model has no tool-capable endpoint', () => {
        expect(agentTurnHasRetryableToolSupportFailure({
            segments: [{ type: 'text', content: '404 No endpoints found that support tool use.' }],
        })).to.be.true;
    });

    it('does not switch models when a turn with real tool runs mentions JSON', () => {
        expect(agentTurnHasRetryableToolSupportFailure({
            segments: [
                { type: 'tool', content: undefined, result: 'ok' },
                { type: 'text', content: '{ "command": "ls -la", "description": "List all files in the current directory" }' },
            ],
        })).to.be.false;
        expect(agentTurnHasRetryableToolSupportFailure({
            content: 'Done. The build passes.',
        })).to.be.false;
        expect(agentTurnHasRetryableToolSupportFailure(undefined)).to.be.false;
    });

    it('never offers a confirmed tool-less model as a fallback candidate', () => {
        const current = {
            provider: 'openai' as const,
            vendor: 'openrouter',
            modelId: 'tencent/hy3:free',
        };
        const chain = buildAgentModelFallbackChain('qaiq', current);
        // The tool-less current pick stays first (it is the "tried" anchor), but every
        // fallback candidate after it must be tool-capable.
        expect(agentModelKey(chain[0])).to.equal('openrouter/tencent/hy3:free');
        for (const candidate of chain.slice(1)) {
            expect(candidate.modelId).to.not.match(/^tencent\/hy/i);
        }
        const next = resolveNextFallbackAgentModel('qaiq', current, new Set(['openrouter/tencent/hy3:free']));
        expect(next).to.not.be.undefined;
        expect(next!.modelId).to.not.match(/^tencent\/hy/i);
    });

    it('retries a decommissioned model even when the turn already produced work', () => {
        // Real OpenRouter case: tencent/hy3:free was pulled mid-turn after tools had run.
        expect(agentTurnHasRetryableModelFailure({
            content: 'La captura funcionó.',
            segments: [
                { type: 'tool', content: undefined, result: 'ok' },
                {
                    type: 'text',
                    content: "There's an issue with the selected model (tencent/hy3:free). "
                        + 'It may not exist or you may not have access to it. Run --model to pick a different model.',
                },
            ],
        })).to.be.true;
        expect(agentTurnHasRetryableModelFailure({ content: 'TypeError: build failed' })).to.be.false;
        expect(agentTurnHasRetryableModelFailure(undefined)).to.be.false;
    });

    it('falls back from a model its provider retired (410 end of life, endpoint 404)', () => {
        const endOfLife = 'API Error: 410 {"status":410,"title":"Gone","detail":"Model nvidia/llama-3.3-nemotron-super-49b-v1 has reached its end of life."}';
        const endpoint404 = 'Provider endpoint at integrate.api.nvidia.com returned 404. Verify OPENAI_BASE_URL is correct.';
        expect(agentTurnHasRetryableModelFailure({ content: endOfLife })).to.be.true;
        expect(agentTurnHasRetryableModelFailure({ content: endpoint404 })).to.be.true;
        expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed' }, { content: endOfLife })).to.be.true;
        // A NIM model without the free slug is paid by the policy: its retired-model failure has no fallback.
        const paidCurrent = { provider: 'openai' as const, vendor: 'nvidia', modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1' };
        expect(resolveNextFallbackAgentModel('qaiq', paidCurrent, new Set([agentModelKey(paidCurrent)!]))).to.equal(undefined);
        const next = resolveNextFallbackAgentModel(
            'qaiq',
            { provider: 'openai', vendor: 'openrouter', modelId: 'nvidia/llama-3.3-nemotron-super-49b-v1:free' },
            new Set(['openrouter/nvidia/llama-3.3-nemotron-super-49b-v1:free']),
        );
        expect(next).to.not.equal(undefined);
        expect(next?.modelId.endsWith(':free')).to.equal(true);
    });

    describe('agentTurnQualifiesForModelFallback (shared by conversation turns and standalone tasks)', () => {
        const deadModel = { content: "There's an issue with the selected model (tencent/hy3:free). It may not exist or you may not have access to it." };

        it('qualifies a failed turn with no output or an unavailable model', () => {
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed' }, undefined)).to.be.true;
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed' }, deadModel)).to.be.true;
        });

        it('does not qualify a failure the turn explains, or an interrupted / cancelled turn', () => {
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed' }, { content: 'TypeError: build failed' })).to.be.false;
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'interrupted' }, undefined)).to.be.false;
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'cancelled' }, undefined)).to.be.false;
        });

        it('does not fall back on a failed quota turn, even with no output', () => {
            const quotaTurn = { content: 'ERROR message="stream error" small=false error.error="AI_APICallError: Free usage limit reached."' };
            expect(agentTurnQualifiesForModelFallback('opencode', { state: 'failed' }, undefined)).to.be.true;
            expect(agentTurnQualifiesForModelFallback('opencode', { state: 'failed' }, quotaTurn)).to.be.false;
        });

        it('does not fall back on an account-level limit: the free-model daily cap, out of credits, or the Codex plan usage cap', () => {
            const freeLimitTurn = { content: 'API Error: 429 {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429}} openrouter' };
            const creditsTurn = { content: 'API Error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402}}' };
            const codexUsageTurn = { content: 'You\'ve hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Nov 19th, 2026 12:56 AM.' };
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed' }, freeLimitTurn)).to.be.false;
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed' }, creditsTurn)).to.be.false;
            expect(agentTurnQualifiesForModelFallback('codex', { state: 'failed' }, codexUsageTurn)).to.be.false;
        });

        it('still falls back when the model itself is unsupported by the account (Codex model_not_found)', () => {
            const codexModelTurn = { content: '{"error":{"message":"The \'gpt-5.6-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}' };
            expect(agentTurnQualifiesForModelFallback('codex', { state: 'failed' }, codexModelTurn)).to.be.true;
        });

        it('never qualifies when the key every model shares stopped the turn, or the agent has no chain', () => {
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed', preflightFailure: 'provider_key_missing' }, undefined)).to.be.false;
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed', providerKeyVerdict: 'key_rejected' }, deadModel)).to.be.false;
            expect(agentTurnQualifiesForModelFallback('qaiq', { state: 'failed', providerKeyVerdict: 'no_credits' }, deadModel)).to.be.false;
            expect(agentTurnQualifiesForModelFallback('shell', { state: 'failed' }, undefined)).to.be.false;
        });
    });

    it('falls back to another model for a shared-pool 429, but not for the account credits or key limit', () => {
        const sharedPool = '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream.","limit_source":"upstream_provider_shared_pool"}}';
        expect(agentTurnQualifiesForModelFallback('pi', { state: 'failed' }, { segments: [{ type: 'text', content: sharedPool }] })).to.be.true;
        expect(agentTurnQualifiesForModelFallback('pi', { state: 'failed' }, { content: '402 Payment Required: insufficient credits' })).to.be.false;
        expect(agentTurnQualifiesForModelFallback('pi', { state: 'failed' }, { content: '429: rate limit exceeded for your API key' })).to.be.false;
    });

    describe('model identity and Stop', () => {
        it('treats the same slug as one model across the openrouter prefix and the ~ alias', () => {
            expect(agentModelKey({ provider: 'openai', vendor: 'openrouter', modelId: 'openrouter/cohere/north-mini-code:free' }))
                .to.equal(agentModelKey({ provider: 'openai', vendor: 'cohere', modelId: 'cohere/north-mini-code:free' }));
            expect(agentModelKey({ provider: 'openai', vendor: 'openrouter', modelId: '~cohere/north-mini-code:free' }))
                .to.equal(agentModelKey({ provider: 'openai', vendor: 'openrouter', modelId: 'cohere/north-mini-code:free' }));
        });

        it('never chooses the model that just failed as the fallback, even when its vendor tag differs', () => {
            const failed = { provider: 'openai' as const, vendor: 'cohere', modelId: 'cohere/north-mini-code:free' };
            const tried = new Set<string>([agentModelKey(failed)!]);
            const next = resolveNextFallbackAgentModel(QAIQ_AGENT_ID, { provider: 'openai', vendor: 'openrouter', modelId: 'openrouter/cohere/north-mini-code:free' }, tried);
            expect(next && agentModelKey(next)).to.not.equal(agentModelKey(failed));
        });

        it('a stopped turn never qualifies for a model fallback, even with tool-call-shaped partial output', () => {
            const toolShaped = { content: '{"name":"read_file","arguments":{"path":"a"}}' };
            expect(agentTurnQualifiesForModelFallback(QAIQ_AGENT_ID, { state: 'cancelled', providerKeyVerdict: undefined, preflightFailure: undefined }, toolShaped)).to.be.false;
            expect(agentTurnQualifiesForModelFallback(QAIQ_AGENT_ID, { state: 'interrupted', providerKeyVerdict: undefined, preflightFailure: undefined }, toolShaped)).to.be.false;
        });
    });
});

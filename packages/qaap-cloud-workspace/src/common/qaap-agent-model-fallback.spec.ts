// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    agentModelKey,
    agentTurnHasRetryableEmptyOutput,
    agentTurnHasRetryableModelFailure,
    agentTurnHasRetryableQuotaFailure,
    agentTurnHasRetryableToolSupportFailure,
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
});

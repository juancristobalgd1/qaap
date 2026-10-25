import { expect } from 'chai';
import {
    OPENROUTER_EXCLUDED_MODEL_SLUGS,
    filterOpenRouterModelSlugs,
    isExcludedOpenRouterModelSlug,
    isFreeOpenRouterModelId,
    OPENROUTER_DEFAULT_FREE_MODELS,
} from './openrouter-models';

describe('openrouter-models', () => {
    it('excludes deepseek-v4-flash:free from registration and free badge', () => {
        const slug = 'deepseek/deepseek-v4-flash:free';
        expect(isExcludedOpenRouterModelSlug(slug)).to.be.true;
        expect(isExcludedOpenRouterModelSlug(`openrouter/${slug}`)).to.be.true;
        expect(isFreeOpenRouterModelId(`openrouter/${slug}`)).to.be.false;
        expect(filterOpenRouterModelSlugs([
            slug,
            'nvidia/nemotron-3-ultra-550b-a55b:free',
        ])).to.deep.equal(['nvidia/nemotron-3-ultra-550b-a55b:free']);
    });

    it('excludes Hunyuan free/tool-less slugs from the agent catalog', () => {
        expect(isExcludedOpenRouterModelSlug('tencent/hy3:free')).to.be.true;
        expect(isExcludedOpenRouterModelSlug('tencent/hy3')).to.be.true;
        expect(filterOpenRouterModelSlugs([
            'tencent/hy3:free',
            'google/gemma-4-31b-it:free',
        ])).to.deep.equal(['google/gemma-4-31b-it:free']);
    });

    it('excludes Hermes catalog slugs that 404 with no OpenRouter endpoints', () => {
        expect(isExcludedOpenRouterModelSlug('poolside/laguna-m.1:free')).to.be.true;
        expect(isExcludedOpenRouterModelSlug('inclusionai/ring-2.6-1t:free')).to.be.true;
        expect(isExcludedOpenRouterModelSlug('openrouter/elephant-alpha')).to.be.true;
        expect(filterOpenRouterModelSlugs([
            'poolside/laguna-m.1:free',
            'inclusionai/ring-2.6-1t:free',
            'google/gemma-4-31b-it:free',
        ])).to.deep.equal(['google/gemma-4-31b-it:free']);
    });

    it('excludes free slugs OpenRouter delisted and keeps them out of the defaults', () => {
        for (const slug of ['moonshotai/kimi-k2.6:free', 'openai/gpt-oss-120b:free', 'z-ai/glm-4.5-air:free']) {
            expect(isExcludedOpenRouterModelSlug(slug), slug).to.be.true;
            expect(OPENROUTER_DEFAULT_FREE_MODELS, slug).to.not.include(slug);
        }
    });

    it('curated free list carries no slug OpenRouter no longer lists (minimax-m3.1-flash:free, 2026-10-25)', () => {
        // Static guard: this exact slug 404'd ("may not exist or you may not have access") on every
        // turn and was silently swapped out. Paid `minimax/minimax-m3.1-flash` is not a free pick.
        expect(OPENROUTER_DEFAULT_FREE_MODELS).to.not.include('minimax/minimax-m3.1-flash:free');
        expect(OPENROUTER_EXCLUDED_MODEL_SLUGS.has('minimax/minimax-m3.1-flash:free')).to.be.true;
    });

    it('defaults to a live tool-capable model, never the dead Oct 2026 ones', () => {
        // Oct 21 2026: `nvidia/nemotron-3-super-120b-a12b:free` (Nvidia endpoint status -5, 404) and
        // `qwen/qwen3.8-27b:free` (no endpoints) were the default and a fallback.
        expect(OPENROUTER_DEFAULT_FREE_MODELS[0]).to.equal('nvidia/nemotron-3-ultra-550b-a55b:free');
        expect(OPENROUTER_DEFAULT_FREE_MODELS).to.not.include('nvidia/nemotron-3-super-120b-a12b:free');
        expect(OPENROUTER_DEFAULT_FREE_MODELS).to.not.include('qwen/qwen3.8-27b:free');
        expect(isFreeOpenRouterModelId('openrouter/nvidia/nemotron-3-ultra-550b-a55b:free')).to.be.true;
    });

    it('keeps every default free, registrable and the first four from distinct providers', () => {
        expect(filterOpenRouterModelSlugs(OPENROUTER_DEFAULT_FREE_MODELS)).to.deep.equal([...OPENROUTER_DEFAULT_FREE_MODELS]);
        expect(OPENROUTER_DEFAULT_FREE_MODELS.every(slug => slug.endsWith(':free'))).to.be.true;
        expect(new Set(OPENROUTER_DEFAULT_FREE_MODELS).size).to.equal(OPENROUTER_DEFAULT_FREE_MODELS.length);
        const head = OPENROUTER_DEFAULT_FREE_MODELS.slice(0, 4).map(slug => slug.split('/')[0]);
        expect(new Set(head).size).to.equal(4);
    });
});

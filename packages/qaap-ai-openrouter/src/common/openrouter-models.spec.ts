import { expect } from 'chai';
import {
    filterOpenRouterModelSlugs,
    isExcludedOpenRouterModelSlug,
    isFreeOpenRouterModelId,
} from './openrouter-models';

describe('openrouter-models', () => {
    it('excludes deepseek-v4-flash:free from registration and free badge', () => {
        const slug = 'deepseek/deepseek-v4-flash:free';
        expect(isExcludedOpenRouterModelSlug(slug)).to.be.true;
        expect(isExcludedOpenRouterModelSlug(`openrouter/${slug}`)).to.be.true;
        expect(isFreeOpenRouterModelId(`openrouter/${slug}`)).to.be.false;
        expect(filterOpenRouterModelSlugs([
            slug,
            'nvidia/nemotron-3-super-120b-a12b:free',
        ])).to.deep.equal(['nvidia/nemotron-3-super-120b-a12b:free']);
    });

    it('excludes Hunyuan free/tool-less slugs from the agent catalog', () => {
        expect(isExcludedOpenRouterModelSlug('tencent/hy3:free')).to.be.true;
        expect(isExcludedOpenRouterModelSlug('tencent/hy3')).to.be.true;
        expect(filterOpenRouterModelSlugs([
            'tencent/hy3:free',
            'moonshotai/kimi-k2.6:free',
        ])).to.deep.equal(['moonshotai/kimi-k2.6:free']);
    });

    it('excludes Hermes catalog slugs that 404 with no OpenRouter endpoints', () => {
        expect(isExcludedOpenRouterModelSlug('poolside/laguna-m.1:free')).to.be.true;
        expect(isExcludedOpenRouterModelSlug('nvidia/nemotron-3-ultra-550b-a55b:free')).to.be.true;
        expect(isExcludedOpenRouterModelSlug('openrouter/elephant-alpha')).to.be.true;
        expect(filterOpenRouterModelSlugs([
            'poolside/laguna-m.1:free',
            'nvidia/nemotron-3-ultra-550b-a55b:free',
            'moonshotai/kimi-k2.6:free',
        ])).to.deep.equal(['moonshotai/kimi-k2.6:free']);
    });
});

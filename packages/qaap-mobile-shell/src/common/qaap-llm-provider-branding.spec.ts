import { expect } from 'chai';
import {
    resolveLlmProviderBrand,
    resolveLlmProviderBrandKey,
} from './qaap-llm-provider-branding';

describe('qaap-llm-provider-branding', () => {

    it('falls back to BYOK vendor when the model slug has no known brand', () => {
        expect(resolveLlmProviderBrandKey('openai', 'gpt-5.5')).to.equal('openai');
        expect(resolveLlmProviderBrandKey('openrouter')).to.equal('openrouter');
        expect(resolveLlmProviderBrandKey('gemini', 'gemini-2.5-flash')).to.equal('gemini');
    });

    it('prefers the model/org brand over the BYOK provider when the slug is known', () => {
        expect(resolveLlmProviderBrandKey('huggingface', 'meta-llama/Llama-3.2-3B-Instruct')).to.equal('meta');
        expect(resolveLlmProviderBrandKey('nvidia', 'meta/llama-3.3-70b-instruct')).to.equal('meta');
        expect(resolveLlmProviderBrandKey('nvidia', 'nvidia/llama-3.3-nemotron-70b-instruct')).to.equal('nvidia');
        expect(resolveLlmProviderBrandKey('openrouter', 'deepseek/deepseek-v3')).to.equal('deepseek');
        expect(resolveLlmProviderBrandKey('openrouter', 'qwen/qwen-2.5-coder')).to.equal('qwen');
        expect(resolveLlmProviderBrandKey('openrouter', 'google/gemma-3-27b-it')).to.equal('google');
        expect(resolveLlmProviderBrandKey('openrouter', 'anthropic/claude-sonnet-4-6')).to.equal('anthropic');
        expect(resolveLlmProviderBrandKey('openrouter', 'cohere/north-mini-code:free')).to.equal('cohere');
    });

    it('returns svg brands for known providers', () => {
        expect(resolveLlmProviderBrand('anthropic')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openai')?.tone).to.equal('brand');
        expect(resolveLlmProviderBrand('openai')?.imageUrlLight).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openai')?.imageUrlDark).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter')?.imageUrlLight).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter')?.imageUrlDark).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('huggingface')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('ollama')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter', 'moonshotai/kimi-k2.6:free')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter', 'nvidia/nemotron-3-super-120b-a12b:free')?.id).to.equal('nvidia');
        expect(resolveLlmProviderBrand('qwen')?.svg).to.include('<svg');
    });
});

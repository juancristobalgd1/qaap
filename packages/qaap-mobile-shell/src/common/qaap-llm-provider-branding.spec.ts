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
        expect(resolveLlmProviderBrandKey('openrouter', 'google/gemma-3-27b-it')).to.equal('gemma');
        expect(resolveLlmProviderBrandKey('openrouter', 'alibaba/qwen-max')).to.equal('alibaba');
        expect(resolveLlmProviderBrandKey('openrouter', 'anthropic/claude-sonnet-4-6')).to.equal('anthropic');
        expect(resolveLlmProviderBrandKey('openrouter', 'cohere/north-mini-code:free')).to.equal('cohere');
        expect(resolveLlmProviderBrandKey('openrouter', 'unsloth/llama-3.1-8b')).to.equal('unsloth');
        expect(resolveLlmProviderBrandKey('openrouter', 'z-ai/glm-5.2')).to.equal('z-ai');
        expect(resolveLlmProviderBrandKey('openrouter', 'tencent/hy3:free')).to.equal('tencent');
        expect(resolveLlmProviderBrandKey('openrouter', 'bytedance/doubao-pro')).to.equal('bytedance');
        expect(resolveLlmProviderBrandKey('openrouter', 'byte-dance/seed-1.6')).to.equal('bytedance');
        expect(resolveLlmProviderBrandKey('openrouter', 'acme-labs/custom-model')).to.equal('acme-labs');
    });

    it('builds distinct monogram brands for unknown model orgs', () => {
        expect(resolveLlmProviderBrand('openrouter', 'acme-labs/custom-model')?.label).to.equal('Acme Labs');
    });

    it('uses curated SVG brands for model-owner orgs', () => {
        expect(resolveLlmProviderBrand('openrouter', 'z-ai/glm-5.2')?.id).to.equal('z-ai');
        expect(resolveLlmProviderBrand('openrouter', 'z-ai/glm-5.2')?.svg).to.include('#2D2D2D');
        expect(resolveLlmProviderBrand('openrouter', 'tencent/hy3:free')?.svg).to.include('#0052D9');
        expect(resolveLlmProviderBrand('openrouter', 'minimax/MiniMax-M2.5')?.svg).to.include('#E2167E');
        expect(resolveLlmProviderBrand('openrouter', 'bytedance/doubao-pro')?.svg).to.include('#00C8D2');
        expect(resolveLlmProviderBrand('openrouter', 'mistralai/mistral-large')?.svg).to.include('#E10500');
        expect(resolveLlmProviderBrand('openrouter', 'deepseek/deepseek-v3')?.svg).to.include('#4D6BFE');
        expect(resolveLlmProviderBrand('openrouter', 'microsoft/phi-4')?.svg).to.include('#F1511B');
        expect(resolveLlmProviderBrand('openrouter', 'meta-llama/Llama-3.2-3B-Instruct')?.svg)
            .to.include('meta__g');
        expect(resolveLlmProviderBrand('openrouter', 'cohere/north-mini-code:free')?.svg).to.include('#D18EE2');
        expect(resolveLlmProviderBrand('openrouter', 'unsloth/llama-3.1-8b')?.imageUrl)
            .to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter', 'google/gemma-3-27b-it')?.svg).to.include('#446EFF');
        expect(resolveLlmProviderBrand('openrouter', 'alibabacloud/qwen-turbo')?.svg).to.include('#FF6A00');
        expect(resolveLlmProviderBrand('qwen')?.svg).to.include('#6336E7');
        expect(resolveLlmProviderBrand('nvidia')?.svg).to.include('#74B71B');
        expect(resolveLlmProviderBrand('openrouter')?.svgLight).to.include('#111111');
        expect(resolveLlmProviderBrand('openrouter')?.svgDark).to.include('#C8FF00');
    });

    it('returns svg brands for known providers', () => {
        expect(resolveLlmProviderBrand('anthropic')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openai')?.tone).to.equal('light');
        expect(resolveLlmProviderBrand('openai')?.svg).to.include('fill="currentColor"');
        expect(resolveLlmProviderBrand('openai')?.imageUrlLight).to.equal(undefined);
        expect(resolveLlmProviderBrand('openai')?.imageUrlDark).to.equal(undefined);
        expect(resolveLlmProviderBrand('openrouter')?.tone).to.equal('brand');
        expect(resolveLlmProviderBrand('openrouter')?.svg).to.equal(undefined);
        expect(resolveLlmProviderBrand('openrouter')?.svgDark).to.include('#C8FF00');
        expect(resolveLlmProviderBrand('openrouter')?.imageUrlLight).to.equal(undefined);
        expect(resolveLlmProviderBrand('huggingface')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('ollama')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter', 'moonshotai/kimi-k2.6:free')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('openrouter', 'nvidia/nemotron-3-super-120b-a12b:free')?.id).to.equal('nvidia');
        expect(resolveLlmProviderBrand('qwen')?.svg).to.include('<svg');
    });
});

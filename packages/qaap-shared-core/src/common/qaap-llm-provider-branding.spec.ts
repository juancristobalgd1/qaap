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

    it('maps Codex / Antigravity / Copilot section headers and GPT model rows', () => {
        expect(resolveLlmProviderBrandKey('codex')).to.equal('codex');
        expect(resolveLlmProviderBrandKey('antigravity')).to.equal('antigravity');
        expect(resolveLlmProviderBrandKey('copilot')).to.equal('copilot');
        expect(resolveLlmProviderBrandKey('github-copilot')).to.equal('copilot');
        // GPT rows under a Codex section must use OpenAI, not the Codex monogram.
        expect(resolveLlmProviderBrandKey('codex', 'gpt-5.6-sol')).to.equal('openai');
        expect(resolveLlmProviderBrandKey('codex', 'gpt-5.6-terra')).to.equal('openai');
        expect(resolveLlmProviderBrandKey('codex', 'gpt-5.6-luna')).to.equal('openai');
        expect(resolveLlmProviderBrandKey('codex', 'gpt-5.5')).to.equal('openai');
        expect(resolveLlmProviderBrandKey('codex', 'openai/gpt-4.1')).to.equal('openai');
        // GPT rows under a Copilot section must use OpenAI, not the Copilot mark.
        expect(resolveLlmProviderBrandKey('copilot', 'gpt-5.6')).to.equal('openai');
        expect(resolveLlmProviderBrandKey('copilot', 'gpt-4o')).to.equal('openai');
    });

    it('brands OpenCode model rows from the identity after stripping opencode/', () => {
        // Section header (vendor only) uses the OpenCode mark.
        expect(resolveLlmProviderBrandKey('opencode')).to.equal('opencode');
        expect(resolveLlmProviderBrand('opencode')?.id).to.equal('opencode');
        expect(resolveLlmProviderBrand('opencode')?.tone).to.equal('light');
        expect(resolveLlmProviderBrand('opencode')?.svg).to.include('fill="currentColor"');
        expect(resolveLlmProviderBrand('opencode')?.svg).to.include('M16 6H8v12h8V6zm4 16H4V2h16v20z');
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/claude-sonnet-5')).to.equal('claude');
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/deepseek-v4-flash')).to.equal('deepseek');
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/gemini-3-flash')).to.equal('gemini');
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/glm-4.7')).to.equal('z-ai');
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/qwen3-coder')).to.equal('qwen');
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/minimax-m2.5')).to.equal('minimax');
        // Nested gateway + org still resolves to the family brand.
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/anthropic/claude-opus-4')).to.equal('claude');
        expect(resolveLlmProviderBrand('opencode', 'opencode/claude-sonnet-5')?.svg).to.include('#D97757');
        expect(resolveLlmProviderBrand('opencode', 'opencode/deepseek-v4-flash')?.svg).to.include('#4D6BFE');
        expect(resolveLlmProviderBrand('opencode', 'opencode/glm-4.7')?.svg).to.include('#2D2D2D');
        // Unknown OpenCode model falls back to the OpenCode mark (not a monogram).
        expect(resolveLlmProviderBrandKey('opencode', 'opencode/big-pickle')).to.equal('opencode');
        expect(resolveLlmProviderBrand('opencode', 'opencode/big-pickle')?.svg)
            .to.include('M16 6H8v12h8V6zm4 16H4V2h16v20z');
    });

    it('prefers the model/org brand over the BYOK provider when the slug is known', () => {
        expect(resolveLlmProviderBrandKey('huggingface', 'meta-llama/Llama-3.2-3B-Instruct')).to.equal('meta');
        expect(resolveLlmProviderBrandKey('nvidia', 'meta/llama-3.3-70b-instruct')).to.equal('meta');
        expect(resolveLlmProviderBrandKey('nvidia', 'nvidia/llama-3.3-nemotron-70b-instruct')).to.equal('nvidia');
        expect(resolveLlmProviderBrandKey('openrouter', 'deepseek/deepseek-v3')).to.equal('deepseek');
        expect(resolveLlmProviderBrandKey('openrouter', 'qwen/qwen-2.5-coder')).to.equal('qwen');
        expect(resolveLlmProviderBrandKey('openrouter', 'google/gemma-3-27b-it')).to.equal('gemma');
        expect(resolveLlmProviderBrandKey('openrouter', 'alibaba/qwen-max')).to.equal('alibaba');
        expect(resolveLlmProviderBrandKey('openrouter', 'anthropic/claude-sonnet-4-6')).to.equal('claude');
        expect(resolveLlmProviderBrandKey('openrouter', 'claude/claude-opus-4')).to.equal('claude');
        expect(resolveLlmProviderBrandKey('anthropic')).to.equal('anthropic');
        expect(resolveLlmProviderBrandKey('antigravity')).to.equal('antigravity');
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
        expect(resolveLlmProviderBrand('openrouter', 'anthropic/claude-sonnet-4-6')?.id).to.equal('claude');
        expect(resolveLlmProviderBrand('openrouter', 'anthropic/claude-sonnet-4-6')?.svg).to.include('#D97757');
        expect(resolveLlmProviderBrand('qwen')?.svg).to.include('#6336E7');
        expect(resolveLlmProviderBrand('nvidia')?.svg).to.include('#74B71B');
        expect(resolveLlmProviderBrand('antigravity')?.id).to.equal('antigravity');
        expect(resolveLlmProviderBrand('antigravity')?.svg).to.include('antigravity__mask');
        expect(resolveLlmProviderBrand('codex')?.id).to.equal('codex');
        expect(resolveLlmProviderBrand('codex')?.svg).to.include('codex__grad');
        expect(resolveLlmProviderBrand('codex', 'gpt-5.6-sol')?.id).to.equal('openai');
        expect(resolveLlmProviderBrand('codex', 'gpt-5.6-sol')?.svg).to.include('fill="currentColor"');
        expect(resolveLlmProviderBrand('copilot')?.id).to.equal('copilot');
        expect(resolveLlmProviderBrand('copilot')?.tone).to.equal('light');
        expect(resolveLlmProviderBrand('copilot')?.svg).to.include('fill="currentColor"');
        expect(resolveLlmProviderBrand('copilot')?.svg).to.include('M19.245 5.364');
        expect(resolveLlmProviderBrand('copilot', 'gpt-4o')?.id).to.equal('openai');
        expect(resolveLlmProviderBrand('openrouter')?.svgLight).to.include('#111111');
        expect(resolveLlmProviderBrand('openrouter')?.svgDark).to.include('#C8FF00');
        expect(resolveLlmProviderBrand('grok')?.id).to.equal('grok');
        expect(resolveLlmProviderBrand('grok', 'grok-4.5')?.svgLight).to.include('data:image/png;base64,');
        expect(resolveLlmProviderBrand('grok', 'grok-4.5')?.svgDark).to.include('data:image/png;base64,');
        expect(resolveLlmProviderBrandKey('grok', 'grok-4.5')).to.equal('grok');
    });

    it('returns svg brands for known providers', () => {
        expect(resolveLlmProviderBrand('anthropic')?.imageUrl).to.match(/^data:image\/png;base64,/);
        expect(resolveLlmProviderBrand('claude')?.svg).to.include('#D97757');
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

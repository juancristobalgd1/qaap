import { expect } from 'chai';
import {
    OLLAMA_DEFAULT_HOST,
    QAAP_QAIQ_BYOK_PROVIDERS,
    vendorHasByokCredential,
} from './qaap-qaiq-byok-provider-registry';
import {
    filterQaiqModelsWithConfiguredCredentials,
    formatQaiqModelIdShortLabel,
    groupQaiqModelsByProvider,
    isQaiqByokLanguageModelId,
    listQaiqModelsFromPreferences,
    listQaiqModelsFromRegisteredLanguageModels,
    listOpenClaudeFallbackModels,
    mergeQaiqModelOptions,
} from './qaap-qaiq-model-catalog';

describe('formatQaiqModelIdShortLabel', () => {
    it('strips a leading org/ segment from OpenRouter-style ids', () => {
        expect(formatQaiqModelIdShortLabel('nvidia/llama-nemotron-rerank-vl-1b-v2:free'))
            .to.equal('llama-nemotron-rerank-vl-1b-v2:free');
        expect(formatQaiqModelIdShortLabel('tencent/hy3:free')).to.equal('hy3:free');
    });

    it('keeps ids without a path segment as-is', () => {
        expect(formatQaiqModelIdShortLabel('claude-sonnet-4')).to.equal('claude-sonnet-4');
        expect(formatQaiqModelIdShortLabel('gpt-4o')).to.equal('gpt-4o');
    });
});

describe('QAAP_QAIQ_BYOK_PROVIDERS', () => {
    it('defines credential and model prefs for every provider', () => {
        for (const provider of QAAP_QAIQ_BYOK_PROVIDERS) {
            expect(provider.vendor.trim(), provider.vendor).to.not.equal('');
            expect(provider.credentialPref.trim(), provider.vendor).to.not.equal('');
            expect(provider.modelListPrefs.length, provider.vendor).to.be.greaterThan(0);
            expect(provider.label.trim(), provider.vendor).to.not.equal('');
        }
    });
});

describe('listQaiqModelsFromPreferences', () => {
    it('returns models for every configured BYOK provider', () => {
        for (const provider of QAAP_QAIQ_BYOK_PROVIDERS) {
            const models = listQaiqModelsFromPreferences(key => {
                if (key === provider.credentialPref) {
                    return 'configured';
                }
                if (provider.modelListPrefs.includes(key)) {
                    return ['test-model'];
                }
                return undefined;
            });
            expect(models.some(model => model.vendor === provider.vendor), provider.vendor).to.be.true;
        }
    });

    it('returns OpenRouter models when API key is configured', () => {
        const models = listQaiqModelsFromPreferences(key => {
            if (key === 'ai-features.openrouter.openrouterApiKey') {
                return 'sk-test';
            }
            if (key === 'ai-features.openrouter.openrouterModels') {
                return [];
            }
            return undefined;
        });
        expect(models.some(m => m.vendor === 'openrouter')).to.be.true;
    });

    it('drops excluded OpenRouter slugs from the QAIQ model picker', () => {
        const models = listQaiqModelsFromPreferences(key => {
            if (key === 'ai-features.openrouter.openrouterApiKey') {
                return 'sk-test';
            }
            if (key === 'ai-features.openrouter.openrouterModels') {
                return [
                    'deepseek/deepseek-v4-flash:free',
                    'nvidia/nemotron-3-super-120b-a12b:free',
                ];
            }
            return undefined;
        });
        expect(models.some(m => m.modelId === 'deepseek/deepseek-v4-flash:free')).to.be.false;
        expect(models.some(m => m.modelId === 'nvidia/nemotron-3-super-120b-a12b:free')).to.be.true;
    });

    it('returns Hugging Face models when API key is configured', () => {
        const models = listQaiqModelsFromPreferences(key => {
            if (key === 'ai-features.huggingFace.apiKey') {
                return 'hf_test';
            }
            if (key === 'ai-features.huggingFace.models') {
                return [];
            }
            return undefined;
        });
        expect(models.some(m => m.vendor === 'huggingface')).to.be.true;
    });

    it('does not return models from explicit lists without an API key', () => {
        const models = listQaiqModelsFromPreferences(key => {
            if (key === 'ai-features.openrouter.openrouterModels') {
                return ['nvidia/nemotron-3-super-120b-a12b:free'];
            }
            return undefined;
        });
        expect(models.some(m => m.vendor === 'openrouter')).to.be.false;
    });

    it('returns explicit models when the provider API key is configured', () => {
        const models = listQaiqModelsFromPreferences(key => {
            if (key === 'ai-features.openrouter.openrouterApiKey') {
                return 'sk-test';
            }
            if (key === 'ai-features.openrouter.openrouterModels') {
                return ['nvidia/nemotron-3-super-120b-a12b:free'];
            }
            return undefined;
        });
        expect(models.some(m => m.vendor === 'openrouter' && m.modelId === 'nvidia/nemotron-3-super-120b-a12b:free')).to.be.true;
    });

    it('does not treat the default Ollama host as configured', () => {
        const models = listQaiqModelsFromPreferences(key => {
            if (key === 'ai-features.ollama.ollamaHost') {
                return OLLAMA_DEFAULT_HOST;
            }
            return undefined;
        });
        expect(models.some(m => m.vendor === 'ollama')).to.be.false;
    });

    it('includes providers configured only via runtime env vars', () => {
        const models = listQaiqModelsFromPreferences(
            () => undefined,
            key => (key === 'OPENROUTER_API_KEY' ? 'sk-env' : undefined),
        );
        expect(models.some(m => m.vendor === 'openrouter')).to.be.true;
    });

    it('merges workspace and browser model lists', () => {
        const merged = mergeQaiqModelOptions(
            [{ vendor: 'openrouter', provider: 'openai', modelId: 'a', label: 'a' }],
            [{ vendor: 'nvidia', provider: 'openai', modelId: 'b', label: 'b' }],
            [{ vendor: 'openrouter', provider: 'openai', modelId: 'a', label: 'a' }],
        );
        expect(merged).to.have.length(2);
    });

    it('skips providers without credentials', () => {
        expect(vendorHasByokCredential(() => undefined, 'huggingface')).to.be.false;
        expect(vendorHasByokCredential(key => {
            if (key === 'ai-features.huggingFace.apiKey') {
                return 'hf_key';
            }
            return undefined;
        }, 'huggingface')).to.be.true;
        expect(vendorHasByokCredential(key => {
            if (key === 'ai-features.google.apiKey') {
                return 'google_key';
            }
            return undefined;
        }, 'gemini')).to.be.true;
    });

    it('maps registered language models only when the provider has credentials', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.anthropic.AnthropicApiKey') {
                return 'sk-ant';
            }
            return undefined;
        };
        const models = listQaiqModelsFromRegisteredLanguageModels([
            { id: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron free' },
            { id: 'anthropic/claude-opus-4-7', name: 'Claude Opus 4.7' },
            { id: 'copilot/gpt-4o', name: 'Copilot' },
        ], readPref);
        expect(models).to.have.length(1);
        expect(models.some(m => m.vendor === 'anthropic')).to.be.true;
        expect(models.some(m => m.vendor === 'openrouter')).to.be.false;
        expect(isQaiqByokLanguageModelId('copilot/gpt-4o')).to.be.false;
    });

    it('includes every registered model when no credential reader is provided', () => {
        const models = listQaiqModelsFromRegisteredLanguageModels([
            { id: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron free' },
            { id: 'anthropic/claude-opus-4-7', name: 'Claude Opus 4.7' },
            { id: 'copilot/gpt-4o', name: 'Copilot' },
        ]);
        expect(models).to.have.length(2);
        expect(models.some(m => m.vendor === 'openrouter')).to.be.true;
        expect(models.some(m => m.vendor === 'anthropic')).to.be.true;
    });

    it('filters merged model lists by configured credentials', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.nvidia.nvidiaApiKey') {
                return 'nvapi-test';
            }
            return undefined;
        };
        const filtered = filterQaiqModelsWithConfiguredCredentials([
            { vendor: 'openrouter', provider: 'openai', modelId: 'a', label: 'a' },
            { vendor: 'nvidia', provider: 'openai', modelId: 'b', label: 'b' },
        ], readPref);
        expect(filtered).to.have.length(1);
        expect(filtered[0]?.vendor).to.equal('nvidia');
    });

    it('groups models by vendor', () => {
        const grouped = groupQaiqModelsByProvider([
            { vendor: 'openrouter', provider: 'openai', modelId: 'a', label: 'a' },
            { vendor: 'nvidia', provider: 'openai', modelId: 'b', label: 'b' },
        ]);
        expect(grouped.get('openrouter')).to.have.length(1);
        expect(grouped.get('nvidia')).to.have.length(1);
    });
});

describe('listOpenClaudeFallbackModels', () => {
    it('exposes the built-in provider presets when Settings has no catalog', () => {
        const models = listOpenClaudeFallbackModels();
        expect(models.map(model => model.modelId)).to.include.members([
            'claude-sonnet-4-6',
            'claude-opus-4-7',
            'gpt-4o',
            'gemini-3.1-pro',
            'mistral-large-latest',
            'qwen2.5-coder:7b',
        ]);
        expect(models.every(model => model.label.trim().length > 0)).to.be.true;
    });
});

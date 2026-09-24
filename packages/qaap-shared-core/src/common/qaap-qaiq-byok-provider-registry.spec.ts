import { expect } from 'chai';
import {
    applyByokCredentialEnv,
    findCustomOpenAiEndpointForModelId,
    findQaiqByokProvider,
    hasAnyConfiguredByokCredential,
    isQaapAiSettingsPrefKey,
    isQaapIsolatedAiSettingsPrefKey,
    listByokModelIds,
    formatQaiqModelProviderLabel,
    listCustomOpenAiModels,
    listQaapAiSettingsPrefKeys,
    parseTheiaLanguageModelId,
    QAAP_CUSTOM_OPENAI_API_KEY_PREF,
    QAAP_CUSTOM_OPENAI_BASE_URL_PREF,
    QAAP_CUSTOM_OPENAI_ENDPOINTS_PREF,
    QAAP_CUSTOM_OPENAI_MODEL_PREF,
    QAAP_CUSTOM_OPENAI_VENDOR,
    resolveVendorForModelId,
} from './qaap-qaiq-byok-provider-registry';

describe('qaap-qaiq-byok-provider-registry', () => {
    it('persists non-secret provider options per user and lists no unregistered providers', () => {
        const keys = listQaapAiSettingsPrefKeys();
        expect(keys).to.include('ai-features.openAiOfficial.useResponseApi');
        expect(keys).to.include('ai-features.anthropicCustom.customAnthropicModels');
        expect(keys).to.include('ai-features.vercelAi.openaiApiKey');
        expect(keys.some(key => key.startsWith('ai-features.mistral.'))).to.equal(false);
        expect(findQaiqByokProvider('mistral')).to.equal(undefined);
    });

    it('persists every ai-features.* key per user, isolating credentials/BYOK keys from the shared scope', () => {
        expect(isQaapAiSettingsPrefKey('ai-features.chat.defaultChatAgent')).to.equal(true);
        expect(isQaapAiSettingsPrefKey('editor.fontSize')).to.equal(false);
        expect(isQaapIsolatedAiSettingsPrefKey('ai-features.openrouter.openrouterApiKey')).to.equal(true);
        expect(isQaapIsolatedAiSettingsPrefKey('ai-features.mcp.mcpServers')).to.equal(true);
        expect(isQaapIsolatedAiSettingsPrefKey('ai-features.chat.defaultChatAgent')).to.equal(false);
    });

    it('takes NVIDIA fallbacks from qaap-ai-nvidia and lists no invented Ollama model', () => {
        const nvidia = findQaiqByokProvider('nvidia')!;
        expect(listByokModelIds(() => undefined, nvidia)).to.include('meta/llama-3.3-70b-instruct');
        expect(listByokModelIds(() => undefined, findQaiqByokProvider('ollama')!)).to.deep.equal([]);
    });

    it('resolves alias vendors to the canonical provider', () => {
        expect(findQaiqByokProvider('gemini')?.vendor).to.equal('google');
        expect(parseTheiaLanguageModelId('gemini/gemini-2.5-flash')?.vendor).to.equal('google');
        expect(parseTheiaLanguageModelId('gemini/gemini-2.5-flash')?.provider).to.equal('gemini');
    });

    it('formats labels from the registry', () => {
        expect(formatQaiqModelProviderLabel('huggingface')).to.equal('Hugging Face');
        expect(formatQaiqModelProviderLabel('gemini')).to.equal('Google Gemini');
    });

    it('maps credential env vars from the registry', () => {
        const env: NodeJS.ProcessEnv = {};
        applyByokCredentialEnv(env, 'huggingface', key => {
            if (key === 'ai-features.huggingFace.apiKey') {
                return 'hf_test';
            }
            return undefined;
        });
        expect(env.HUGGINGFACE_API_KEY).to.equal('hf_test');
        expect(env.HF_TOKEN).to.equal('hf_test');
        expect(env.OPENAI_API_KEY).to.equal('hf_test');
        expect(env.OPENAI_BASE_URL).to.equal('https://router.huggingface.co/v1');
    });

    it('resolveVendorForModelId maps bare Hugging Face model ids from Settings lists', () => {
        const readPref = (key: string): unknown => {
            if (key === 'ai-features.huggingFace.apiKey') {
                return 'hf_test';
            }
            if (key === 'ai-features.huggingFace.models') {
                return ['Qwen/Qwen3-Coder-Next', 'meta-llama/Llama-3.2-3B-Instruct'];
            }
            return undefined;
        };
        expect(resolveVendorForModelId(readPref, 'Qwen/Qwen3-Coder-Next')).to.equal('huggingface');
        expect(resolveVendorForModelId(readPref, 'huggingface/Qwen/Qwen3-Coder-Next')).to.equal('huggingface');
    });

    it('maps custom OpenAI-compatible endpoints for QAIQ', () => {
        const readPref = (key: string): unknown => {
            if (key === QAAP_CUSTOM_OPENAI_ENDPOINTS_PREF) {
                return [
                    {
                        id: 'qwen-local',
                        model: 'qwen2.5-coder',
                        url: 'https://qwen.example/v1',
                        apiKey: 'sk-qwen',
                    },
                    {
                        id: 'deepseek-remote',
                        model: 'deepseek-coder',
                        url: 'https://deepseek.example/v1',
                        apiKey: 'sk-deepseek',
                    },
                ];
            }
            return undefined;
        };
        expect(parseTheiaLanguageModelId(`${QAAP_CUSTOM_OPENAI_VENDOR}/qwen2.5-coder`)).to.deep.include({
            vendor: QAAP_CUSTOM_OPENAI_VENDOR,
            provider: 'openai',
            modelId: 'qwen2.5-coder',
        });
        expect(listCustomOpenAiModels(readPref)).to.deep.equal([{
            vendor: QAAP_CUSTOM_OPENAI_VENDOR,
            provider: 'openai',
            modelId: 'qwen2.5-coder',
            label: 'qwen2.5-coder',
        }, {
            vendor: QAAP_CUSTOM_OPENAI_VENDOR,
            provider: 'openai',
            modelId: 'deepseek-coder',
            label: 'deepseek-coder',
        }]);
        expect(resolveVendorForModelId(readPref, 'qwen2.5-coder')).to.equal(QAAP_CUSTOM_OPENAI_VENDOR);
        expect(resolveVendorForModelId(readPref, 'deepseek-remote')).to.equal(QAAP_CUSTOM_OPENAI_VENDOR);
        expect(findCustomOpenAiEndpointForModelId(readPref, 'deepseek-remote')?.url).to.equal('https://deepseek.example/v1');

        const env: NodeJS.ProcessEnv = {};
        applyByokCredentialEnv(env, QAAP_CUSTOM_OPENAI_VENDOR, readPref);
        expect(env.OPENAI_API_KEY).to.equal('sk-qwen');
        expect(env.OPENAI_BASE_URL).to.equal('https://qwen.example/v1');
    });

    it('maps simple AI Features custom endpoint fields for QAIQ', () => {
        const readPref = (key: string): unknown => {
            if (key === QAAP_CUSTOM_OPENAI_MODEL_PREF) {
                return 'deepseek-coder';
            }
            if (key === QAAP_CUSTOM_OPENAI_BASE_URL_PREF) {
                return 'https://simple.example/v1';
            }
            if (key === QAAP_CUSTOM_OPENAI_API_KEY_PREF) {
                return 'sk-simple';
            }
            return undefined;
        };
        expect(listCustomOpenAiModels(readPref)).to.deep.equal([{
            vendor: QAAP_CUSTOM_OPENAI_VENDOR,
            provider: 'openai',
            modelId: 'deepseek-coder',
            label: 'deepseek-coder',
        }]);

        const env: NodeJS.ProcessEnv = {};
        applyByokCredentialEnv(env, QAAP_CUSTOM_OPENAI_VENDOR, readPref);
        expect(env.OPENAI_API_KEY).to.equal('sk-simple');
        expect(env.OPENAI_BASE_URL).to.equal('https://simple.example/v1');
    });

    it('hasAnyConfiguredByokCredential is true when any provider key is set', () => {
        expect(hasAnyConfiguredByokCredential(() => undefined)).to.equal(false);
        expect(hasAnyConfiguredByokCredential(key =>
            key === 'ai-features.openrouter.openrouterApiKey' ? 'sk-or' : undefined,
        )).to.equal(true);
        expect(hasAnyConfiguredByokCredential(() => undefined, envKey =>
            envKey === 'OPENROUTER_API_KEY' ? 'sk-or' : undefined,
        )).to.equal(true);
    });
});

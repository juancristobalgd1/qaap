// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Reads one Settings preference by its id. Declared here (not imported) to keep this module free of cycles. */
type QaapPiPreferenceReader = (key: string) => unknown;

/** Settings prefix of the API-key preferences that exist only for Pi (the other Pi providers reuse BYOK prefs). */
const QAAP_PI_OWN_PREF_PREFIX = 'ai-features.pi.';

/** One API-key provider that Pi reads from its environment. Entering the key in Settings activates it for Pi. */
export interface QaapPiProviderDescriptor {
    /** Pi provider id (`pi --provider` and the `provider/model` prefix of Pi's model list). */
    readonly piProvider: string;
    /** Settings label of the provider. */
    readonly label: string;
    /** Environment variable Pi reads the key from. */
    readonly env: string;
    /** Settings preference holding the key. Every preference this registry adds ends in `ApiKey`. */
    readonly pref: string;
}

/** Every API-key provider Pi supports. Providers that already have a Settings section reuse its preference. */
export const QAAP_PI_PROVIDERS: readonly QaapPiProviderDescriptor[] = [
    { piProvider: 'openrouter', label: 'OpenRouter', env: 'OPENROUTER_API_KEY', pref: 'ai-features.openrouter.openrouterApiKey' },
    { piProvider: 'anthropic', label: 'Anthropic', env: 'ANTHROPIC_API_KEY', pref: 'ai-features.anthropic.AnthropicApiKey' },
    { piProvider: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY', pref: 'ai-features.openAiOfficial.openAiApiKey' },
    { piProvider: 'google', label: 'Google Gemini', env: 'GEMINI_API_KEY', pref: 'ai-features.google.apiKey' },
    { piProvider: 'nvidia', label: 'NVIDIA NIM', env: 'NVIDIA_API_KEY', pref: 'ai-features.nvidia.nvidiaApiKey' },
    { piProvider: 'huggingface', label: 'Hugging Face', env: 'HF_TOKEN', pref: 'ai-features.huggingFace.apiKey' },
    { piProvider: 'deepseek', label: 'DeepSeek', env: 'DEEPSEEK_API_KEY', pref: 'ai-features.pi.deepseekApiKey' },
    { piProvider: 'groq', label: 'Groq', env: 'GROQ_API_KEY', pref: 'ai-features.pi.groqApiKey' },
    { piProvider: 'cerebras', label: 'Cerebras', env: 'CEREBRAS_API_KEY', pref: 'ai-features.pi.cerebrasApiKey' },
    { piProvider: 'xai', label: 'xAI', env: 'XAI_API_KEY', pref: 'ai-features.pi.xaiApiKey' },
    { piProvider: 'mistral', label: 'Mistral', env: 'MISTRAL_API_KEY', pref: 'ai-features.pi.mistralApiKey' },
    { piProvider: 'zai', label: 'Z.ai', env: 'ZAI_API_KEY', pref: 'ai-features.pi.zaiApiKey' },
    { piProvider: 'minimax', label: 'MiniMax', env: 'MINIMAX_API_KEY', pref: 'ai-features.pi.minimaxApiKey' },
    { piProvider: 'moonshotai', label: 'Moonshot AI', env: 'MOONSHOT_API_KEY', pref: 'ai-features.pi.moonshotaiApiKey' },
    { piProvider: 'kimi-coding', label: 'Kimi Coding', env: 'KIMI_API_KEY', pref: 'ai-features.pi.kimiCodingApiKey' },
    { piProvider: 'fireworks', label: 'Fireworks', env: 'FIREWORKS_API_KEY', pref: 'ai-features.pi.fireworksApiKey' },
    { piProvider: 'together', label: 'Together AI', env: 'TOGETHER_API_KEY', pref: 'ai-features.pi.togetherApiKey' },
    { piProvider: 'baseten', label: 'Baseten', env: 'BASETEN_API_KEY', pref: 'ai-features.pi.basetenApiKey' },
    { piProvider: 'vercel-ai-gateway', label: 'Vercel AI Gateway', env: 'AI_GATEWAY_API_KEY', pref: 'ai-features.pi.vercelAiGatewayApiKey' },
    { piProvider: 'opencode', label: 'OpenCode Zen', env: 'OPENCODE_API_KEY', pref: 'ai-features.pi.opencodeApiKey' },
];

export namespace QaapPiProviders {

    /** Settings ids of the API-key preferences this registry adds (the other providers reuse existing prefs). */
    export function newPrefIds(): string[] {
        return QAAP_PI_PROVIDERS
            .map(descriptor => descriptor.pref)
            .filter(pref => pref.startsWith(QAAP_PI_OWN_PREF_PREFIX));
    }

    /** Descriptors whose preference is one this registry adds. */
    export function ownDescriptors(): readonly QaapPiProviderDescriptor[] {
        return QAAP_PI_PROVIDERS.filter(descriptor => descriptor.pref.startsWith(QAAP_PI_OWN_PREF_PREFIX));
    }

    /** Sets each provider's environment variable from its non-empty trimmed key; other variables stay untouched. */
    export function applyEnv(env: Record<string, string | undefined>, readPref: QaapPiPreferenceReader): void {
        for (const descriptor of QAAP_PI_PROVIDERS) {
            const key = readKey(readPref, descriptor.pref);
            if (key !== undefined) {
                env[descriptor.env] = key;
            }
        }
    }

    /** Sorted Pi provider ids that have a non-empty key in Settings. */
    export function configuredProviders(readPref: QaapPiPreferenceReader): string[] {
        return QAAP_PI_PROVIDERS
            .filter(descriptor => readKey(readPref, descriptor.pref) !== undefined)
            .map(descriptor => descriptor.piProvider)
            .sort();
    }

    function readKey(readPref: QaapPiPreferenceReader, pref: string): string | undefined {
        const value = readPref(pref);
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isExcludedOpenRouterModelSlug } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';
import type { QaapQaiqModelOption } from './qaap-agent-task-client';
import { qaiqModelSupportsToolCalls } from './qaap-agent-tool-support';

/**
 * Curated Hermes picker slugs (OpenRouter-style `org/model`).
 * Keep in sync with the Hermes agent model-catalog.json `providers.openrouter.models` list,
 * except OpenRouter `:free` / router slugs that currently 404 (`No endpoints found`).
 * https://hermes-agent.nousresearch.com/docs/api/model-catalog.json
 */
const HERMES_NATIVE_MODEL_IDS: readonly string[] = [
    'anthropic/claude-fable-5',
    'anthropic/claude-opus-5',
    'anthropic/claude-opus-5-fast',
    'anthropic/claude-opus-4.8',
    'anthropic/claude-opus-4.8-fast',
    'anthropic/claude-sonnet-5',
    'anthropic/claude-haiku-4.5',
    'openai/gpt-5.6-sol',
    'openai/gpt-5.6-sol-pro',
    'openai/gpt-5.6-terra',
    'openai/gpt-5.6-terra-pro',
    'openai/gpt-5.6-luna',
    'openai/gpt-5.6-luna-pro',
    'openai/gpt-5.5',
    'openai/gpt-5.5-pro',
    'openai/gpt-5.4-mini',
    'google/gemini-3.1-pro-preview',
    'google/gemini-3.7-flash',
    'x-ai/grok-4.6',
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-pro-0813',
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-flash-0731',
    'qwen/qwen3.8-max',
    'moonshotai/kimi-k3',
    'minimax/minimax-m3',
    'z-ai/glm-5.2',
    'z-ai/glm-5.1',
    'xiaomi/mimo-v2.5-pro',
    'stepfun/step-3.7-flash',
    'nvidia/nemotron-3-super-120b-a12b',
    'sakana/fugu-ultra',
];

const HERMES_MODEL_LABELS: Readonly<Record<string, string>> = {
    'anthropic/claude-fable-5': 'Claude Fable 5',
    'anthropic/claude-opus-5': 'Claude Opus 5',
    'anthropic/claude-opus-5-fast': 'Claude Opus 5 Fast',
    'anthropic/claude-opus-4.8': 'Claude Opus 4.8',
    'anthropic/claude-opus-4.8-fast': 'Claude Opus 4.8 Fast',
    'anthropic/claude-sonnet-5': 'Claude Sonnet 5',
    'anthropic/claude-haiku-4.5': 'Claude Haiku 4.5',
    'openai/gpt-5.6-sol': 'GPT-5.6 Sol',
    'openai/gpt-5.6-sol-pro': 'GPT-5.6 Sol Pro',
    'openai/gpt-5.6-terra': 'GPT-5.6 Terra',
    'openai/gpt-5.6-terra-pro': 'GPT-5.6 Terra Pro',
    'openai/gpt-5.6-luna': 'GPT-5.6 Luna',
    'openai/gpt-5.6-luna-pro': 'GPT-5.6 Luna Pro',
    'openai/gpt-5.5': 'GPT-5.5',
    'openai/gpt-5.5-pro': 'GPT-5.5 Pro',
    'openai/gpt-5.4-mini': 'GPT-5.4 Mini',
    'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'google/gemini-3.7-flash': 'Gemini 3.7 Flash',
    'x-ai/grok-4.6': 'Grok 4.6',
    'deepseek/deepseek-v4-pro': 'DeepSeek V4 Pro',
    'deepseek/deepseek-v4-pro-0813': 'DeepSeek V4 Pro 0813',
    'deepseek/deepseek-v4-flash': 'DeepSeek V4 Flash',
    'deepseek/deepseek-v4-flash-0731': 'DeepSeek V4 Flash 0731',
    'qwen/qwen3.8-max': 'Qwen 3.8 Max',
    'moonshotai/kimi-k3': 'Kimi K3',
    'minimax/minimax-m3': 'MiniMax M3',
    'z-ai/glm-5.2': 'GLM 5.2',
    'z-ai/glm-5.1': 'GLM 5.1',
    'xiaomi/mimo-v2.5-pro': 'MiMo V2.5 Pro',
    'stepfun/step-3.7-flash': 'Step 3.7 Flash',
    'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super 120B',
    'sakana/fugu-ultra': 'Fugu Ultra',
};

function hermesProviderForOrg(org: string): QaapQaiqModelOption['provider'] {
    if (org === 'anthropic') {
        return 'anthropic';
    }
    if (org === 'google' || org === 'gemini') {
        return 'gemini';
    }
    if (org === 'mistral') {
        return 'mistral';
    }
    if (org === 'ollama') {
        return 'ollama';
    }
    return 'openai';
}

function hermesVendorForOrg(org: string): string {
    if (org === 'gemini') {
        return 'google';
    }
    return org || 'hermes';
}

export function hermesNativeModelOption(modelId: string, label?: string): QaapQaiqModelOption | undefined {
    const id = modelId.trim();
    if (!id || isExcludedOpenRouterModelSlug(id) || qaiqModelSupportsToolCalls(id) === false) {
        return undefined;
    }
    const org = id.includes('/') ? id.slice(0, id.indexOf('/')) : 'hermes';
    return {
        provider: hermesProviderForOrg(org),
        vendor: hermesVendorForOrg(org),
        modelId: id,
        label: label?.trim() || HERMES_MODEL_LABELS[id] || id,
    };
}

/** Models exposed by the Hermes CLI picker. This is not the QAIQ BYOK catalog. */
export function listHermesNativeModels(): QaapQaiqModelOption[] {
    const models: QaapQaiqModelOption[] = [];
    for (const modelId of HERMES_NATIVE_MODEL_IDS) {
        const option = hermesNativeModelOption(modelId);
        if (option) {
            models.push(option);
        }
    }
    return models;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapQaiqModelOption } from './qaap-agent-task-client';
import {
    formatQaiqModelProviderLabel,
    listByokModelsFromDescriptor,
    listCustomOpenAiModels,
    parseTheiaLanguageModelId,
    QAAP_QAIQ_BYOK_PROVIDERS,
    vendorHasByokCredential,
    type QaapPreferenceReader,
} from './qaap-qaiq-byok-provider-registry';

export type { QaapPreferenceReader } from './qaap-qaiq-byok-provider-registry';

/**
 * OpenClaude ships these provider/model presets in its built-in model catalog. They are only a
 * fallback for an empty Settings catalog; configured BYOK models always take precedence.
 */
const OPENCLAUDE_FALLBACK_MODELS: readonly QaapQaiqModelOption[] = [
    { vendor: 'anthropic', provider: 'anthropic', modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { vendor: 'anthropic', provider: 'anthropic', modelId: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { vendor: 'anthropic', provider: 'anthropic', modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { vendor: 'openai', provider: 'openai', modelId: 'gpt-4o', label: 'GPT-4o' },
    { vendor: 'openai', provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
    { vendor: 'google', provider: 'gemini', modelId: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { vendor: 'mistral', provider: 'mistral', modelId: 'mistral-large-latest', label: 'Mistral Large Latest' },
    { vendor: 'ollama', provider: 'ollama', modelId: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B' },
];

export function listOpenClaudeFallbackModels(): QaapQaiqModelOption[] {
    return OPENCLAUDE_FALLBACK_MODELS.map(model => ({ ...model }));
}

type AliasMap = Record<string, { readonly selectedModel?: string } | undefined>;

const ALIAS_KEYS = ['default/code', 'default/universal', 'default/code-completion', 'default/summarize'] as const;

/** Subscription / gateway providers that must not appear in the QAIQ BYOK picker. */
export const QAAP_QAIQ_EXCLUDED_LANGUAGE_MODEL_PREFIXES = ['copilot/', 'vercel-ai/', 'vercel/'] as const;

export function isQaiqByokLanguageModelId(id: string): boolean {
    const normalized = id.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return !QAAP_QAIQ_EXCLUDED_LANGUAGE_MODEL_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function qaiqModelOptionKey(option: QaapQaiqModelOption): string {
    return `${option.provider}|${option.vendor}|${option.modelId}`;
}

/** Union model lists (e.g. workspace snapshot + browser preferences) without duplicates. */
export function mergeQaiqModelOptions(
    ...sources: readonly (readonly QaapQaiqModelOption[])[]
): QaapQaiqModelOption[] {
    const deduped = new Map<string, QaapQaiqModelOption>();
    for (const models of sources) {
        for (const option of models) {
            const key = qaiqModelOptionKey(option);
            if (!deduped.has(key)) {
                deduped.set(key, option);
            }
        }
    }
    return [...deduped.values()];
}

/** Keep only models whose BYOK vendor has a configured credential in AI Features. */
export function filterQaiqModelsWithConfiguredCredentials(
    models: readonly QaapQaiqModelOption[],
    readPref: QaapPreferenceReader,
    readEnv?: (key: string) => string | undefined,
): QaapQaiqModelOption[] {
    return models.filter(model => vendorHasByokCredential(readPref, model.vendor, readEnv));
}

/** Mirrors AI Configuration: registered BYOK language models with a configured credential. */
export function listQaiqModelsFromRegisteredLanguageModels(
    models: ReadonlyArray<{ readonly id: string; readonly name?: string }>,
    readPref?: QaapPreferenceReader,
    readEnv?: (key: string) => string | undefined,
): QaapQaiqModelOption[] {
    const deduped = new Map<string, QaapQaiqModelOption>();
    for (const model of models) {
        if (!isQaiqByokLanguageModelId(model.id)) {
            continue;
        }
        const binding = parseTheiaLanguageModelId(model.id);
        if (!binding) {
            continue;
        }
        if (readPref && !vendorHasByokCredential(readPref, binding.vendor, readEnv)) {
            continue;
        }
        const key = qaiqModelOptionKey(binding);
        if (!deduped.has(key)) {
            deduped.set(key, {
                ...binding,
                label: model.name?.trim() || binding.label || binding.modelId,
            });
        }
    }
    return [...deduped.values()];
}

/** Models available for QAIQ from Settings (API keys + model lists + aliases). */
export function listQaiqModelsFromPreferences(
    readPref: QaapPreferenceReader,
    readEnv?: (key: string) => string | undefined,
): QaapQaiqModelOption[] {
    const deduped = new Map<string, QaapQaiqModelOption>();

    const add = (option: QaapQaiqModelOption): void => {
        const key = qaiqModelOptionKey(option);
        if (!deduped.has(key)) {
            deduped.set(key, option);
        }
    };

    const aliases = readPref('ai-features.languageModelAliases') as AliasMap | undefined;
    if (aliases && typeof aliases === 'object') {
        const addAlias = (binding: QaapQaiqModelOption | undefined): void => {
            if (binding && vendorHasByokCredential(readPref, binding.vendor, readEnv)) {
                add(binding);
            }
        };
        for (const key of ALIAS_KEYS) {
            addAlias(parseTheiaLanguageModelId(aliases[key]?.selectedModel));
        }
        for (const entry of Object.values(aliases)) {
            addAlias(parseTheiaLanguageModelId(entry?.selectedModel));
        }
    }

    for (const provider of QAAP_QAIQ_BYOK_PROVIDERS) {
        for (const model of listByokModelsFromDescriptor(readPref, provider, readEnv)) {
            add(model);
        }
    }
    for (const model of listCustomOpenAiModels(readPref, readEnv)) {
        add(model);
    }

    return [...deduped.values()];
}

export function groupQaiqModelsByProvider(models: readonly QaapQaiqModelOption[]): Map<string, QaapQaiqModelOption[]> {
    const grouped = new Map<string, QaapQaiqModelOption[]>();
    for (const model of models) {
        const provider = model.vendor || model.provider;
        const list = grouped.get(provider) ?? [];
        list.push(model);
        grouped.set(provider, list);
    }
    return grouped;
}

/** Formats a selected model label so its provider is visible, e.g. "Anthropic · claude-4-sonnet". */
export function formatQaiqModelSelectionLabel(model: { readonly vendor: string; readonly modelId: string }): string {
    const vendor = model.vendor?.trim();
    if (!vendor || vendor === 'unknown') {
        return model.modelId;
    }
    return `${formatQaiqModelProviderLabel(vendor)} · ${model.modelId}`;
}

/**
 * Compact model-id label for tight UI (sticky composer toolbar): drops a leading
 * `org/` segment (OpenRouter-style `nvidia/llama-…` → `llama-…`). Keeps ids without `/` as-is.
 */
export function formatQaiqModelIdShortLabel(modelId: string): string {
    const trimmed = modelId.trim();
    if (!trimmed) {
        return trimmed;
    }
    const slash = trimmed.indexOf('/');
    if (slash <= 0 || slash >= trimmed.length - 1) {
        return trimmed;
    }
    return trimmed.slice(slash + 1);
}

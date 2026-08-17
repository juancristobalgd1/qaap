// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS,
    NATIVE_MODEL_PICKER_AGENT_IDS,
} from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import type { QaapQaiqModelOption } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { listHermesNativeModels } from '@theia/qaap-mobile-shell/lib/common/qaap-hermes-model-catalog';
import { listOpenClaudeNativeModels } from '@theia/qaap-mobile-shell/lib/common/qaap-openclaude-model-catalog';

/** Keep in sync with {@link SETTINGS_MODEL_CATALOG_AGENT_IDS} in qaap-agent-model-selection. */
export const SETTINGS_MODEL_CATALOG_AGENT_IDS = new Set(['qaiq']);

export function agentUsesSettingsModelCatalog(agentId: string | undefined): boolean {
    const normalized = agentId?.trim().toLowerCase();
    return !!normalized && SETTINGS_MODEL_CATALOG_AGENT_IDS.has(normalized);
}

export function agentUsesNativeModelCatalog(agentId: string | undefined): boolean {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized || normalized === 'shell' || agentUsesSettingsModelCatalog(normalized)) {
        return false;
    }
    if (NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS.has(normalized)) {
        return false;
    }
    return NATIVE_MODEL_PICKER_AGENT_IDS.has(normalized);
}

function nativeOption(
    agentId: string,
    modelId: string,
    label?: string,
    provider: QaapQaiqModelOption['provider'] = 'openai',
): QaapQaiqModelOption {
    return {
        provider,
        vendor: agentId,
        modelId,
        label: label ?? modelId,
    };
}

/**
 * Models exposed by the Antigravity CLI `/model` menu (Google API labels).
 * Keep in sync with the TUI strings — agy stores and resolves them verbatim in settings.
 * As of mid-July 2026 (agy 1.1.x): Gemini 3.5 Flash is the default frontier Flash;
 * Claude rows remain Sonnet/Opus 4.6 in the official picker (not Sonnet 5 / Opus 4.8 yet).
 */
export const ANTIGRAVITY_API_MODELS: readonly {
    readonly label: string;
    readonly provider: QaapQaiqModelOption['provider'];
}[] = [
    { label: 'Gemini 3.5 Flash (Medium)', provider: 'gemini' },
    { label: 'Gemini 3.5 Flash (High)', provider: 'gemini' },
    { label: 'Gemini 3.5 Flash (Low)', provider: 'gemini' },
    { label: 'Gemini 3.1 Pro (Low)', provider: 'gemini' },
    { label: 'Gemini 3.1 Pro (High)', provider: 'gemini' },
    { label: 'Claude Sonnet 4.6 (Thinking)', provider: 'anthropic' },
    { label: 'Claude Opus 4.6 (Thinking)', provider: 'anthropic' },
    { label: 'GPT-OSS 120B (Medium)', provider: 'openai' },
];

export function listStaticAntigravityModels(agentId: string): QaapQaiqModelOption[] {
    const id = agentId.trim().toLowerCase();
    return ANTIGRAVITY_API_MODELS.map(entry => nativeOption(id, entry.label, entry.label, entry.provider));
}

/** Curated fallback when a CLI is missing on the VPS or its list command fails. */
export function listStaticNativeAgentModels(agentId: string): QaapQaiqModelOption[] {
    const id = agentId.trim().toLowerCase();
    switch (id) {
        case 'qwen':
            return [
                nativeOption(id, 'qwen3-coder-plus', 'Qwen3 Coder Plus'),
                nativeOption(id, 'qwen3-coder-flash', 'Qwen3 Coder Flash'),
                nativeOption(id, 'qwen3.5-plus', 'Qwen3.5 Plus'),
            ];
        case 'codex':
            // Keep in sync with the Codex CLI /model menu (GPT-5.6 GA, July 2026).
            return [
                nativeOption(id, 'gpt-5.6-sol', 'GPT-5.6 Sol'),
                nativeOption(id, 'gpt-5.6-terra', 'GPT-5.6 Terra'),
                nativeOption(id, 'gpt-5.6-luna', 'GPT-5.6 Luna'),
                nativeOption(id, 'gpt-5.5', 'GPT-5.5 Legado'),
            ];
        case 'claude':
            // Keep in sync with the Claude Code CLI /model menu (mid-July 2026).
            return [
                nativeOption(id, 'claude-fable-5', 'Fable 5', 'anthropic'),
                nativeOption(id, 'claude-opus-4-8', 'Opus 4.8', 'anthropic'),
                nativeOption(id, 'claude-sonnet-5', 'Sonnet 5', 'anthropic'),
                nativeOption(id, 'claude-haiku-4-5', 'Haiku 4.5', 'anthropic'),
                nativeOption(id, 'claude-sonnet-4-6', 'Sonnet 4.6 Legado', 'anthropic'),
                nativeOption(id, 'claude-opus-4-7', 'Opus 4.7 Legado', 'anthropic'),
            ];
        case 'openclaude':
            // OpenClaude is a separate harness. It accepts the QAIQ provider flags, but its
            // picker must not inherit the user's QAIQ Settings catalog.
            return listOpenClaudeNativeModels();
        case 'hermes':
            // Hermes uses OpenRouter-style slugs (`org/model`) via top-level `hermes --model`.
            return listHermesNativeModels();
        case 'copilot':
            // Keep in sync with Copilot CLI model IDs (v1.0.70+ GPT-5.6; Sonnet 5 / Opus 4.8).
            return [
                nativeOption(id, 'gpt-5.6-sol', 'GPT-5.6 Sol'),
                nativeOption(id, 'gpt-5.6-terra', 'GPT-5.6 Terra'),
                nativeOption(id, 'gpt-5.6-luna', 'GPT-5.6 Luna'),
                nativeOption(id, 'claude-sonnet-5', 'Claude Sonnet 5', 'anthropic'),
                nativeOption(id, 'claude-opus-4.8', 'Claude Opus 4.8', 'anthropic'),
            ];
        case 'antigravity':
        case 'gemini':
            return listStaticAntigravityModels(id);
        case 'opencode':
            return [
                nativeOption(id, 'opencode/claude-sonnet-4-6', 'Claude Sonnet 4.6'),
                nativeOption(id, 'opencode/gpt-5.2-codex', 'GPT-5.2 Codex'),
                nativeOption(id, 'opencode/gemini-3.1-pro', 'Gemini 3.1 Pro', 'gemini'),
            ];
        case 'grok':
            return [
                nativeOption(id, 'grok-4.5', 'Grok 4.5'),
            ];
        default:
            return [];
    }
}

export function parseNativeModelLines(agentId: string, lines: readonly string[]): QaapQaiqModelOption[] {
    const deduped = new Map<string, QaapQaiqModelOption>();
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const modelId = line;
        const key = modelId.toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, nativeOption(agentId, modelId));
        }
    }
    return [...deduped.values()];
}

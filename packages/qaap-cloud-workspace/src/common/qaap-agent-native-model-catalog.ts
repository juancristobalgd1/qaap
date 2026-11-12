// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    NATIVE_MODEL_CATALOG_EXCLUDED_AGENT_IDS,
    NATIVE_MODEL_PICKER_AGENT_IDS,
} from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import type { QaapQaiqModelOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { QaapAntigravityCliBin } from '@theia/qaap-shared-core/lib/common/qaap-antigravity-cli';
import { listHermesNativeModels } from '@theia/qaap-shared-core/lib/common/qaap-hermes-model-catalog';
import { listOpenClaudeNativeModels } from '@theia/qaap-shared-core/lib/common/qaap-openclaude-model-catalog';
import { OPENCODE_FREE_MODEL_OPTIONS, OPENCODE_PAID_MODEL_OPTIONS } from '@theia/qaap-shared-core/lib/common/qaap-opencode-model-catalog';

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
 * Models exposed by the Antigravity CLI (`agy models`, 2026-11 capture). Antigravity stores and
 * resolves the friendly label verbatim, so the label is the model id (see {@link parseAgyModelLines}).
 * The first row is the default. Refresh from `agy models` when the CLI changes.
 */
export const ANTIGRAVITY_API_MODELS: readonly {
    readonly label: string;
    readonly provider: QaapQaiqModelOption['provider'];
}[] = [
    { label: 'Gemini 3.8 Flash (High)', provider: 'gemini' },
    { label: 'Gemini 3.8 Flash (Medium)', provider: 'gemini' },
    { label: 'Gemini 3.8 Flash (Low)', provider: 'gemini' },
    { label: 'Claude Sonnet 4.6 (Thinking)', provider: 'anthropic' },
    { label: 'Claude Opus 4.6 (Thinking)', provider: 'anthropic' },
    { label: 'GPT-OSS 120B (Medium)', provider: 'openai' },
];

/**
 * Models the Gemini CLI accepts with `-m` (`gemini --help`, `@google/gemini-cli` 0.62 `VALID_GEMINI_MODELS`,
 * captured 2026-11; the local 0.49 bundle lists the same stable ids). Only chat models a user picks: the
 * newest pro and flash-lite generations, the newest flash, and `auto` (the CLI routes between pro and flash
 * itself). The first row is the CLI default. Refresh when `VALID_GEMINI_MODELS` changes.
 */
export const GEMINI_CLI_MODEL_OPTIONS: readonly {
    readonly modelId: string;
    readonly label: string;
}[] = [
    { modelId: 'auto', label: 'Auto' },
    { modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
    { modelId: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { modelId: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { modelId: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { modelId: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

/**
 * The picker list for the Antigravity harness. `gemini` (the resolved CLI, or the `gemini` agent id) lists
 * Gemini CLI model ids that `-m` accepts; `agy` (and an unresolved bin) lists the agy catalog labels.
 */
export function listStaticAntigravityModels(agentId: string, antigravityBin?: QaapAntigravityCliBin): QaapQaiqModelOption[] {
    const id = agentId.trim().toLowerCase();
    if (antigravityBin === 'gemini' || id === 'gemini') {
        return GEMINI_CLI_MODEL_OPTIONS.map(entry => nativeOption(id, entry.modelId, entry.label, 'gemini'));
    }
    return ANTIGRAVITY_API_MODELS.map(entry => nativeOption(id, entry.label, entry.label, entry.provider));
}

/** One Pi catalog entry: id `provider/model` (what `pi --model` takes), grouped by provider, label without the leading `~`. */
function piOption(provider: string, model: string): QaapQaiqModelOption {
    return {
        provider: 'openai',
        vendor: provider,
        modelId: `${provider}/${model}`,
        label: model.replace(/^~/, ''),
    };
}

const PI_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const PI_MODEL_PATTERN = /^~?[a-z0-9][a-z0-9._:~@+/-]*$/i;

/**
 * Parses the whitespace table printed by `pi --list-models` (`provider model context max-out thinking images`).
 * The header, blank lines and anything that is not a provider + model pair are ignored.
 */
export function parsePiModelLines(lines: readonly string[]): QaapQaiqModelOption[] {
    const deduped = new Map<string, QaapQaiqModelOption>();
    for (const raw of lines) {
        const columns = raw.trim().split(/\s+/);
        const [provider, model, context] = columns;
        // Data rows carry a context-window column such as `1M` or `131.1K`; prose lines do not.
        if (columns.length < 3 || !/^\d[\d.]*[KMGB]?$/i.test(context)) {
            continue;
        }
        if (provider.toLowerCase() === 'provider' && model.toLowerCase() === 'model') {
            continue;
        }
        if (!PI_PROVIDER_PATTERN.test(provider) || !PI_MODEL_PATTERN.test(model)) {
            continue;
        }
        const option = piOption(provider, model);
        const key = option.modelId.toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, option);
        }
    }
    return [...deduped.values()];
}

/**
 * Curated fallback when a CLI is missing on the VPS or its list command fails. `antigravityBin` selects the
 * Antigravity list for the resolved CLI (see {@link listStaticAntigravityModels}); other agents ignore it.
 */
export function listStaticNativeAgentModels(agentId: string, antigravityBin?: QaapAntigravityCliBin): QaapQaiqModelOption[] {
    const id = agentId.trim().toLowerCase();
    switch (id) {
        case 'qwen':
            return [
                nativeOption(id, 'qwen3-coder-plus', 'Qwen3 Coder Plus'),
                nativeOption(id, 'qwen3-coder-flash', 'Qwen3 Coder Flash'),
                nativeOption(id, 'qwen3.5-plus', 'Qwen3.5 Plus'),
            ];
        case 'codex':
            // Keep in sync with `codex debug models` (visible rows, CLI order; captured 2026-11, codex 0.167.0).
            // The first row is the CLI's own top-priority visible model, so it is the default.
            return [
                nativeOption(id, 'gpt-6-luna', 'GPT-6-Luna'),
                nativeOption(id, 'gpt-5.6-terra', 'GPT-5.6-Terra'),
                nativeOption(id, 'gpt-5.6-luna', 'GPT-5.6-Luna'),
            ];
        case 'claude':
            // Claude Code has no model-list command, so this is the source of truth (verified against the
            // installed CLI binary, 2026-11). First row is the default; at most two legacy rows follow.
            return [
                nativeOption(id, 'claude-fable-5-1', 'Fable 5.1', 'anthropic'),
                nativeOption(id, 'claude-opus-5-5', 'Opus 5.5', 'anthropic'),
                nativeOption(id, 'claude-sonnet-5-5', 'Sonnet 5.5', 'anthropic'),
                nativeOption(id, 'claude-haiku-5-5', 'Haiku 5.5', 'anthropic'),
                nativeOption(id, 'claude-fable-5', 'Fable 5 Legacy', 'anthropic'),
                nativeOption(id, 'claude-sonnet-5', 'Sonnet 5 Legacy', 'anthropic'),
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
            return listStaticAntigravityModels(id, antigravityBin);
        case 'opencode':
            // Free models first, then the paid catalog (locked per owner by the runner's access rule).
            return [
                ...OPENCODE_FREE_MODEL_OPTIONS.map(model => nativeOption(id, model.modelId, model.label)),
                ...OPENCODE_PAID_MODEL_OPTIONS.map(model => nativeOption(id, model.modelId, model.label)),
            ];
        case 'pi':
            // Cold-cache fallback; `pi --list-models` replaces it. Ids are `provider/model`.
            return [
                piOption('openrouter', '~anthropic/claude-sonnet-latest'),
                piOption('openrouter', '~anthropic/claude-opus-latest'),
                piOption('openrouter', '~anthropic/claude-haiku-latest'),
                piOption('openrouter', '~openai/gpt-mini-latest'),
                piOption('openrouter', '~google/gemini-pro-latest'),
                piOption('openrouter', '~deepseek/deepseek-pro-latest'),
            ];
        case 'grok':
            // `grok models` (2026-11) marks grok-4.7 as the default.
            return [
                nativeOption(id, 'grok-4.7', 'Grok 4.7'),
            ];
        case 'cursor':
            // Cursor replaces this fallback with the account-scoped result of `cursor-agent models`
            // whenever the CLI is authenticated. These are the stable public IDs documented by
            // Cursor for a cold picker, so the row remains useful before the first refresh.
            return [
                nativeOption(id, 'auto', 'Auto'),
                nativeOption(id, 'gpt-5', 'GPT-5'),
                nativeOption(id, 'sonnet-4-thinking', 'Sonnet 4 Thinking'),
                nativeOption(id, 'composer-2.5', 'Composer 2.5'),
                nativeOption(id, 'grok-4.5', 'Grok 4.5'),
            ];
        default:
            return [];
    }
}

export function parseNativeModelLines(agentId: string, lines: readonly string[]): QaapQaiqModelOption[] {
    const normalizedAgentId = agentId.trim().toLowerCase();
    if (normalizedAgentId === 'pi') {
        return parsePiModelLines(lines);
    }
    const deduped = new Map<string, QaapQaiqModelOption>();
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const modelId = line;
        // OpenCode can print a multiline filesystem error while probing its model
        // catalog. Only its provider-qualified IDs are valid picker entries.
        if (normalizedAgentId === 'opencode' && !/^opencode\/[a-z0-9][a-z0-9._-]*$/i.test(modelId)) {
            continue;
        }
        const key = modelId.toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, nativeOption(agentId, modelId));
        }
    }
    return [...deduped.values()];
}

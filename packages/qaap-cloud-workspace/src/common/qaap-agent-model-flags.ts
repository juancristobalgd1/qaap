// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { LEGACY_OPENCLAUDE_AGENT_ID, QAIQ_AGENT_ID } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { QaapAntigravityCliBin } from '@theia/qaap-shared-core/lib/common/qaap-antigravity-cli';
import {
    formatQaiqProviderFlags,
    type QaapQaiqModelBinding,
} from './qaap-qaiq-model-binding';

function shellQuote(value: string): string {
    if (/^[a-zA-Z0-9_./:@+-]+$/.test(value)) {
        return value;
    }
    return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

/**
 * Model ids Gemini CLI accepts (`gemini-2.5-pro`, `models/gemini-…`, and the `auto` routing alias that the
 * gemini catalog lists first); anything else is not a flag value.
 */
const GEMINI_MODEL_ID_PATTERN = /^(auto$|(gemini|models\/gemini)-[a-z0-9.\-]+$)/i;

/** An `agy models` id (`gemini-3.8-flash-medium`): lower-case slug only. Labels with spaces or capitals never match. */
const AGY_MODEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * CLI flags inserted into agent templates (`{model_flags}` / `{qaiq_flags}`).
 * Returns an empty string when the agent has no known model switch.
 * `antigravityBin` is the Antigravity CLI the host resolved: Gemini CLI takes `-m`, `agy` takes `--model`
 * with the catalog id it lists, and the community CLI takes no flag.
 */
export function formatModelFlagsForAgent(agentId: string, binding: QaapQaiqModelBinding, antigravityBin?: QaapAntigravityCliBin): string {
    const normalized = agentId.toLowerCase();
    if (normalized === QAIQ_AGENT_ID || normalized === LEGACY_OPENCLAUDE_AGENT_ID) {
        return formatQaiqProviderFlags(binding);
    }
    if (normalized === 'codex' || normalized === 'grok') {
        return `-m ${shellQuote(binding.modelId)}`;
    }
    if (normalized === 'hermes') {
        // Top-level `hermes --model <org/model>` (the template already pins `--provider openrouter`).
        return `--model ${shellQuote(binding.modelId)}`;
    }
    if (normalized === 'antigravity' || normalized === 'gemini') {
        // Gemini only takes real model ids: a catalog label (agy's "Gemini 3.8 Flash (High)") would fail,
        // so an unrecognized id gets no flag and gemini runs its default model (`auto`, the catalog's first row).
        if (antigravityBin === 'gemini') {
            return GEMINI_MODEL_ID_PATTERN.test(binding.modelId.trim()) ? `-m ${shellQuote(binding.modelId.trim())}` : '';
        }
        if (antigravityBin === 'agy') {
            // Only a slug that looks like an `agy models` id. A label ("Gemini 3.8 Flash (High)"), an empty id
            // or `auto` gets no flag, so agy runs its own default model.
            const modelId = binding.modelId.trim();
            return AGY_MODEL_SLUG_PATTERN.test(modelId) && modelId !== 'auto' ? `--model ${modelId}` : '';
        }
        return '';
    }
    return `--model ${shellQuote(binding.modelId)}`;
}

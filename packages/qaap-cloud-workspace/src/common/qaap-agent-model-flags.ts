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

/** Model ids Gemini CLI accepts (`gemini-2.5-pro`, `models/gemini-…`); anything else is not a flag value. */
const GEMINI_MODEL_ID_PATTERN = /^(gemini|models\/gemini)-[a-z0-9.\-]+$/i;

/**
 * CLI flags inserted into agent templates (`{model_flags}` / `{qaiq_flags}`).
 * Returns an empty string when the agent has no known model switch.
 * `antigravityBin` is the Antigravity CLI the host resolved: Gemini CLI takes `-m`, while `agy` reads its
 * model from settings (qaap-antigravity-settings) and takes no flag.
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
        // agy reads the model from ~/.gemini/antigravity-cli/settings.json (see qaap-antigravity-settings).
        // Gemini only takes real model ids: a catalog label (agy's "Gemini 3.8 Flash (High)") would fail,
        // so an unrecognized id gets no flag and gemini runs its default model.
        if (antigravityBin === 'gemini') {
            return GEMINI_MODEL_ID_PATTERN.test(binding.modelId.trim()) ? `-m ${shellQuote(binding.modelId.trim())}` : '';
        }
        return '';
    }
    return `--model ${shellQuote(binding.modelId)}`;
}

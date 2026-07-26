// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { agentUsesSettingsModelCatalog } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-model-selection';
import type { QaapAgentTaskKind, QaapCreateAgentTaskQaiqModel } from './qaap-agent-task';
import { resolveRequestAgentModel } from './qaap-agent-task';
import {
    parseTheiaLanguageModelId,
    resolveQaapQaiqModelBinding,
    type QaapPreferenceReader,
    type QaapQaiqModelBinding,
} from './qaap-qaiq-model-binding';

// `QaapAgentTaskKind` now lives in `qaap-agent-task.ts` (it's part of `QaapCreateAgentTaskRequest`'s
// public shape); re-exported here so existing importers of this module keep working.
export type { QaapAgentTaskKind } from './qaap-agent-task';

type AliasMap = Record<string, { readonly selectedModel?: string } | undefined>;

const IMPLEMENTATION_PATTERN = new RegExp(
    [
        String.raw`\b(commit|refactor|implement|fix|patch|migrate|deploy|push|merge|write tests?|add feature|open pr|pull request)\b`,
        String.raw`\b(implementa|refactoriza|corrige|arregla|despliega|commit|rama|pr\b|escribe tests?)\b`,
    ].join('|'),
    'i',
);

const EXPLORATION_PATTERN = new RegExp(
    [
        String.raw`\b(explore|find|where|how does|explain|summarize|list files?|grep|search|read only|understand|what is|show me|locate|map out)\b`,
        String.raw`\b(explora|busca|encuentra|dónde|explica|resume|lista|localiza|qué es|muéstrame|mapea)\b`,
    ].join('|'),
    'i',
);

/** Classify the user turn for model routing when no explicit picker model was sent. */
export function classifyAgentTaskKind(prompt: string, interactionModeId?: string): QaapAgentTaskKind {
    const text = prompt.trim();
    if (!text) {
        return 'general';
    }
    const mode = interactionModeId?.trim().toLowerCase();
    if (mode === 'ask') {
        return 'exploration';
    }
    if (IMPLEMENTATION_PATTERN.test(text)) {
        return 'implementation';
    }
    if (EXPLORATION_PATTERN.test(text)) {
        return 'exploration';
    }
    return 'general';
}

function resolveAliasBinding(readPref: QaapPreferenceReader, aliasKey: string): QaapQaiqModelBinding | undefined {
    const aliases = readPref('ai-features.languageModelAliases') as AliasMap | undefined;
    return parseTheiaLanguageModelId(aliases?.[aliasKey]?.selectedModel);
}

/** Pick a model binding from Settings aliases based on task kind. */
export function resolveRoutedQaiqModelBinding(
    readPref: QaapPreferenceReader,
    kind: QaapAgentTaskKind,
): QaapQaiqModelBinding | undefined {
    switch (kind) {
        case 'exploration':
            return resolveAliasBinding(readPref, 'default/universal')
                ?? resolveAliasBinding(readPref, 'default/summarize')
                ?? resolveQaapQaiqModelBinding(readPref);
        case 'implementation':
            return resolveAliasBinding(readPref, 'default/code')
                ?? resolveQaapQaiqModelBinding(readPref);
        default:
            return resolveQaapQaiqModelBinding(readPref);
    }
}

export function bindingToAgentModel(binding: QaapQaiqModelBinding): QaapCreateAgentTaskQaiqModel {
    return {
        provider: binding.provider,
        vendor: binding.vendor,
        modelId: binding.modelId,
    };
}

export interface ResolveEffectiveAgentModelRequest {
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    readonly prompt?: string;
    readonly command?: string;
    readonly interactionModeId?: string;
    /**
     * Classification hint from the task's creator (e.g. a workflow node) — see
     * {@link QaapCreateAgentTaskRequest.taskKind}. Takes precedence over the text-heuristic
     * classifier ({@link classifyAgentTaskKind}) but never over an explicit {@link agentModel}.
     */
    readonly taskKind?: QaapAgentTaskKind;
}

/**
 * Explicit composer/thread model wins. Otherwise route by task kind, but ONLY for agents whose
 * catalog IS the Settings catalog (QAIQ): the routed aliases are QAIQ provider bindings
 * (NVIDIA/OpenRouter/…), and applying one to a native-catalog CLI (claude, codex, grok, …)
 * produces `--model <foreign-vendor-model>` → model_not_found. Native CLIs without an explicit
 * pick run on their own default model.
 *
 * Precedence for the task kind used to route: explicit {@link ResolveEffectiveAgentModelRequest.agentModel}
 * (short-circuits above) > caller-supplied {@link ResolveEffectiveAgentModelRequest.taskKind} >
 * text-heuristic {@link classifyAgentTaskKind} over the prompt/command.
 */
export function resolveEffectiveRequestAgentModel(
    request: ResolveEffectiveAgentModelRequest,
    readPref: QaapPreferenceReader,
    agentId: string,
): QaapCreateAgentTaskQaiqModel | undefined {
    const explicit = resolveRequestAgentModel(request);
    if (explicit) {
        return explicit;
    }
    if (!agentUsesSettingsModelCatalog(agentId)) {
        return undefined;
    }
    let kind: QaapAgentTaskKind;
    if (request.taskKind) {
        kind = request.taskKind;
    } else {
        // Preserve prior behavior exactly when no taskKind hint is supplied: an empty prompt/command
        // means there is nothing to classify, so no routing is attempted at all (not even 'general').
        const prompt = (request.prompt ?? request.command ?? '').trim();
        if (!prompt) {
            return undefined;
        }
        kind = classifyAgentTaskKind(prompt, request.interactionModeId);
    }
    const binding = resolveRoutedQaiqModelBinding(readPref, kind);
    return binding ? bindingToAgentModel(binding) : undefined;
}

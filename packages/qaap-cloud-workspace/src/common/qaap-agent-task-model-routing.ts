// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { agentUsesSettingsModelCatalog } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-model-selection';
import type { QaapQaiqModelOption } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import type { QaapAgentTaskKind, QaapCreateAgentTaskQaiqModel } from './qaap-agent-task';
import { resolveRequestAgentModel } from './qaap-agent-task';
import {
    resolveNativeAgentModelForTaskKind,
    type QaapNativeModelRoutingTable,
} from './qaap-agent-native-model-routing';
import { vendorHasByokCredential } from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-byok-provider-registry';
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
        // 'review' and 'general' both land here: the Settings alias set has no reviewer slot, and
        // inventing one by reusing `default/code` would hand the review to the writer's model.
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

/**
 * Drop a Settings/alias model the runtime cannot actually call (no BYOK pref and no matching
 * env credential) in favour of a credentialed env fallback such as Ollama. Theia ships
 * `openai/gpt-5.5` as the default `default/code` alias; without this, QAIQ is launched against
 * Codex/OpenAI and fails in ~1s on a skip-auth host that only has `OLLAMA_HOST`.
 *
 * Native-catalog agents (claude, codex, …) must not go through this — their vendor strings are
 * not BYOK registry keys, so they would be replaced with the QAIQ env fallback.
 */
export function coerceRunnableAgentModel(
    model: QaapCreateAgentTaskQaiqModel | undefined,
    readPref: QaapPreferenceReader,
    readEnv: (key: string) => string | undefined,
    fallback: QaapCreateAgentTaskQaiqModel | undefined,
): QaapCreateAgentTaskQaiqModel | undefined {
    if (model && vendorHasByokCredential(readPref, model.vendor, readEnv)) {
        return model;
    }
    if (fallback && vendorHasByokCredential(readPref, fallback.vendor, readEnv)) {
        return fallback;
    }
    return model;
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

/** Everything the native-CLI branch needs; omit it and native agents keep their default model. */
export interface QaapAgentModelRoutingContext {
    /**
     * The agent's live model catalog (CLI discovery first, curated static list as fallback — see
     * `listNativeAgentModels`). It is the authority that makes a pin emittable.
     */
    readonly listNativeModels?: (agentId: string) => readonly QaapQaiqModelOption[];
    /** Operator override parsed from `QAAP_AGENT_TASK_MODELS`; defaults apply when omitted. */
    readonly nativeTable?: QaapNativeModelRoutingTable;
}

/**
 * Explicit composer/thread model wins, always. Otherwise route by task kind, on two separate paths
 * because the two catalogs are not interchangeable:
 *
 * - QAIQ (the Settings alias catalog): routed aliases are provider bindings (NVIDIA/OpenRouter/…).
 *   Applying one to a native CLI would produce `--model <foreign-vendor-model>` → model_not_found,
 *   so this path stays QAIQ-only, exactly as before.
 * - Native CLIs (claude, codex, …): routed through {@link resolveNativeAgentModelForTaskKind},
 *   which only ever emits a model the agent itself lists. No verifiable pin → no flag → CLI default.
 *
 * The native path additionally requires a caller-supplied {@link ResolveEffectiveAgentModelRequest.taskKind}
 * and never falls back to the text heuristic. That is deliberate: only a caller that evaluated the
 * work (a workflow node) sends `taskKind`, while the composer sends none and displays the model it
 * will use in a chip. Routing a composer turn on guessed intent would swap the model underneath
 * that chip — the UI would be lying about what ran. Workflow turns have no such chip, and their
 * assignment is recorded in the run transcript.
 *
 * Precedence for the task kind used to route: explicit {@link ResolveEffectiveAgentModelRequest.agentModel}
 * (short-circuits above) > caller-supplied {@link ResolveEffectiveAgentModelRequest.taskKind} >
 * text-heuristic {@link classifyAgentTaskKind} over the prompt/command (QAIQ only).
 */
export function resolveEffectiveRequestAgentModel(
    request: ResolveEffectiveAgentModelRequest,
    readPref: QaapPreferenceReader,
    agentId: string,
    context?: QaapAgentModelRoutingContext,
): QaapCreateAgentTaskQaiqModel | undefined {
    const explicit = resolveRequestAgentModel(request);
    if (explicit) {
        return explicit;
    }
    if (!agentUsesSettingsModelCatalog(agentId)) {
        return resolveNativeRequestAgentModel(request, agentId, context);
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

function resolveNativeRequestAgentModel(
    request: ResolveEffectiveAgentModelRequest,
    agentId: string,
    context: QaapAgentModelRoutingContext | undefined,
): QaapCreateAgentTaskQaiqModel | undefined {
    if (!request.taskKind || !context?.listNativeModels) {
        return undefined;
    }
    return resolveNativeAgentModelForTaskKind(
        agentId,
        request.taskKind,
        context.listNativeModels(agentId) ?? [],
        context.nativeTable,
    );
}

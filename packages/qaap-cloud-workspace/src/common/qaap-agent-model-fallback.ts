// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapCreateAgentTaskQaiqModel } from './qaap-agent-task';
import {
    agentUsesNativeModelCatalog,
    agentUsesSettingsModelCatalog,
    listStaticNativeAgentModels,
} from './qaap-agent-native-model-catalog';
import {
    findQaiqByokProvider,
    type QaapQaiqByokProviderDescriptor,
} from '@theia/qaap-mobile-shell/lib/common/qaap-qaiq-byok-provider-registry';
import { detectAgentFailureKind } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import {
    agentTurnLooksLikeToolCallEmittedAsText,
    looksLikeToolCallJsonText,
    qaiqModelSupportsToolCalls,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-tool-support';

/** Max alternate models to try after the first pick fails (inclusive of the original). */
export const MAX_AGENT_MODEL_FALLBACK_ATTEMPTS = 4;

export function agentModelKey(model: QaapCreateAgentTaskQaiqModel | undefined): string | undefined {
    const modelId = model?.modelId?.trim();
    if (!modelId) {
        return undefined;
    }
    const vendor = model?.vendor?.trim().toLowerCase() || 'unknown';
    return `${vendor}/${modelId}`;
}

function optionToAgentModel(option: {
    readonly provider: QaapCreateAgentTaskQaiqModel['provider'];
    readonly vendor: string;
    readonly modelId: string;
}): QaapCreateAgentTaskQaiqModel {
    return {
        provider: option.provider,
        vendor: option.vendor,
        modelId: option.modelId,
    };
}

function modelsFromByokDescriptor(descriptor: QaapQaiqByokProviderDescriptor): QaapCreateAgentTaskQaiqModel[] {
    const fallback = descriptor.fallbackModels ?? [];
    return fallback.map(modelId => optionToAgentModel({
        provider: descriptor.provider,
        vendor: descriptor.vendor,
        modelId,
    }));
}

/** Ordered model candidates for one agent — current pick first, then curated fallbacks. */
export function buildAgentModelFallbackChain(
    agentId: string,
    current: QaapCreateAgentTaskQaiqModel | undefined,
): readonly QaapCreateAgentTaskQaiqModel[] {
    const normalized = agentId.trim().toLowerCase();
    let candidates: QaapCreateAgentTaskQaiqModel[] = [];
    if (agentUsesSettingsModelCatalog(normalized)) {
        const vendor = current?.vendor?.trim().toLowerCase() ?? 'openrouter';
        const descriptor = findQaiqByokProvider(vendor);
        if (descriptor) {
            candidates = modelsFromByokDescriptor(descriptor);
        }
    } else if (agentUsesNativeModelCatalog(normalized)) {
        candidates = listStaticNativeAgentModels(normalized).map(optionToAgentModel);
    }
    const chain: QaapCreateAgentTaskQaiqModel[] = [];
    const seen = new Set<string>();
    const push = (model: QaapCreateAgentTaskQaiqModel | undefined): void => {
        const key = agentModelKey(model);
        if (!model || !key || seen.has(key)) {
            return;
        }
        seen.add(key);
        chain.push(model);
    };
    push(current);
    for (const model of candidates) {
        // Confirmed tool-less models can never carry an agent turn — skip them as fallbacks.
        if (qaiqModelSupportsToolCalls(model.modelId) === false) {
            continue;
        }
        push(model);
    }
    return chain.slice(0, MAX_AGENT_MODEL_FALLBACK_ATTEMPTS);
}

/** Next untried model in the chain, or undefined when the chain is exhausted. */
export function resolveNextFallbackAgentModel(
    agentId: string,
    current: QaapCreateAgentTaskQaiqModel | undefined,
    triedModelKeys: ReadonlySet<string>,
): QaapCreateAgentTaskQaiqModel | undefined {
    const chain = buildAgentModelFallbackChain(agentId, current);
    for (const model of chain) {
        const key = agentModelKey(model);
        if (key && !triedModelKeys.has(key)) {
            return model;
        }
    }
    return undefined;
}

/** True when a failed turn produced no user-visible agent answer worth keeping. */
export function agentTurnHasRetryableEmptyOutput(
    agentMessage: { readonly content?: string; readonly segments?: readonly { readonly type: string; readonly content?: string; readonly finished?: boolean }[] } | undefined,
): boolean {
    if (!agentMessage) {
        return true;
    }
    if (agentMessage.segments?.length) {
        const hasText = agentMessage.segments.some(
            segment => segment.type === 'text' && !!segment.content?.trim(),
        );
        const hasFinishedTool = agentMessage.segments.some(
            segment => segment.type === 'tool' && segment.finished,
        );
        return !hasText && !hasFinishedTool;
    }
    return !agentMessage.content?.trim();
}

function collectAgentMessageDetails(agentMessage: {
    readonly content?: string;
    readonly segments?: readonly {
        readonly type: string;
        readonly content?: string;
        readonly result?: string;
    }[];
}): string {
    return [
        agentMessage.content,
        ...(agentMessage.segments ?? []).flatMap(segment => [segment.content, segment.result]),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n');
}

/**
 * True when a provider explicitly reports exhausted credits/quota. Unlike a normal model error,
 * this is safe to retry with the next curated model because repeating the same model cannot help.
 */
export function agentTurnHasRetryableQuotaFailure(
    agentMessage: {
        readonly content?: string;
        readonly segments?: readonly {
            readonly type: string;
            readonly content?: string;
            readonly result?: string;
        }[];
    } | undefined,
): boolean {
    if (!agentMessage) {
        return false;
    }
    return detectAgentFailureKind(collectAgentMessageDetails(agentMessage)) === 'quota';
}

/**
 * True when the provider reports the selected model no longer exists or is inaccessible
 * (decommissioned free-tier models are common on OpenRouter). Same reasoning as quota:
 * repeating the SAME model cannot help — the next curated model is the only way forward,
 * even when the turn already produced partial work.
 */
export function agentTurnHasRetryableModelFailure(
    agentMessage: {
        readonly content?: string;
        readonly segments?: readonly {
            readonly type: string;
            readonly content?: string;
            readonly result?: string;
        }[];
    } | undefined,
): boolean {
    if (!agentMessage) {
        return false;
    }
    return detectAgentFailureKind(collectAgentMessageDetails(agentMessage)) === 'model_unavailable';
}

/**
 * True when the turn shows the selected model cannot drive tools: either the provider said so
 * explicitly ("No endpoints found that support tool use"), or the turn "succeeded" by emitting
 * tool-call-shaped JSON as plain text without running a single tool (models without native
 * function calling). Retrying the SAME model cannot help — only a tool-capable fallback can.
 */
export function agentTurnHasRetryableToolSupportFailure(
    agentMessage: {
        readonly content?: string;
        readonly segments?: readonly {
            readonly type: string;
            readonly content?: string;
            readonly result?: string;
        }[];
    } | undefined,
): boolean {
    if (!agentMessage) {
        return false;
    }
    if (detectAgentFailureKind(collectAgentMessageDetails(agentMessage)) === 'tool_unsupported') {
        return true;
    }
    if (agentMessage.segments?.length) {
        return agentTurnLooksLikeToolCallEmittedAsText(agentMessage.segments);
    }
    return looksLikeToolCallJsonText(agentMessage.content);
}

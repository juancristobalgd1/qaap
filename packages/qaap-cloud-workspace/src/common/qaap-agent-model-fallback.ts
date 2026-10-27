// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentTask, QaapCreateAgentTaskQaiqModel } from './qaap-agent-task';
import type { QaapAgentModelFallbackReason } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { agentSupportsModelPicker } from '@theia/qaap-shared-core/lib/common/qaap-agent-model-selection';
import {
    agentUsesNativeModelCatalog,
    agentUsesSettingsModelCatalog,
    listStaticNativeAgentModels,
} from './qaap-agent-native-model-catalog';
import {
    findQaiqByokProvider,
    type QaapQaiqByokProviderDescriptor,
} from '@theia/qaap-shared-core/lib/common/qaap-qaiq-byok-provider-registry';
import { detectAgentFailureKind, type QaapAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import {
    agentTurnLooksLikeToolCallEmittedAsText,
    looksLikeToolCallJsonText,
    qaiqModelSupportsToolCalls,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-support';

/** Max alternate models to try after the first pick fails (inclusive of the original). */
export const MAX_AGENT_MODEL_FALLBACK_ATTEMPTS = 4;

/**
 * Failure kinds that belong to the user's account rather than to the model: every model of the
 * agent runs on the same key and the same plan, so a fallback would fail the same way. Shared by
 * the conversation path ({@link agentTurnQualifiesForModelFallback}) and the standalone task path.
 */
export const AGENT_ACCOUNT_LEVEL_FAILURE_KINDS: ReadonlySet<QaapAgentFailureKind> = new Set<QaapAgentFailureKind>([
    'auth',
    'quota',
    'provider_key_rejected',
    'provider_credits',
    'provider_free_limit',
    'cli_missing',
]);

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
 * True when a provider explicitly reports exhausted credits/quota.
 * Used for classification / inbox lanes — Work Hub no longer auto-retries
 * quota by silently switching model/effort (Antigravity encodes effort in
 * the model label). The failure dialog asks the user to pick another model.
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

/**
 * Why a settled turn is being re-run on another model, for the transcript notice: the selected model
 * was reported unavailable, or the turn produced no usable answer for any other reason.
 */
export function resolveAgentModelFallbackReason(
    agentMessage: QaapAgentModelFallbackEvidence | undefined,
): QaapAgentModelFallbackReason {
    return agentTurnHasRetryableModelFailure(agentMessage) ? 'model-unavailable' : 'turn-failed';
}

/** Agent output a fallback decision reads: a transcript message, or the parsed log of a task. */
export interface QaapAgentModelFallbackEvidence {
    readonly content?: string;
    readonly segments?: readonly {
        readonly type: string;
        readonly content?: string;
        readonly result?: string;
        readonly finished?: boolean;
    }[];
}

/**
 * Gate shared by every fallback decision: the agent has a model chain at all, and nothing proved
 * that the user's key (which every model of the agent shares) is what stopped the turn — a
 * pre-spawn refusal for a missing key, or a preflight verdict of a rejected key / no credits.
 */
export function agentTurnMayFallBackToAnotherModel(
    turnAgentId: string,
    task: Pick<QaapAgentTask, 'providerKeyVerdict' | 'preflightFailure'>,
): boolean {
    if (!agentSupportsModelPicker(turnAgentId)) {
        return false;
    }
    if (task.preflightFailure === 'provider_key_missing') {
        return false;
    }
    return task.providerKeyVerdict !== 'key_rejected' && task.providerKeyVerdict !== 'no_credits';
}

/**
 * Whether a settled agent turn should be re-run on the next model of its agent's fallback chain.
 * One contract for every caller — conversation turns (imperative and turn-graph) and standalone
 * tasks — so the paths cannot drift:
 * - only agents with a model picker have a chain;
 * - never after a pre-spawn refusal for a missing key, or a preflight proving the BYOK key is
 *   rejected or out of credits: every model of the agent runs on the same key;
 * - a tool-support failure qualifies in any state (it also arrives on clean exits);
 * - otherwise only a `failed` turn with no usable output or a `model_unavailable` classification.
 *   Account-level kinds (see {@link AGENT_ACCOUNT_LEVEL_FAILURE_KINDS}) are deliberately neither; an `interrupted`
 *   turn went quiet rather than failing, so the user gets Continue instead of a silent model swap.
 */
export function agentTurnQualifiesForModelFallback(
    turnAgentId: string,
    task: Pick<QaapAgentTask, 'state' | 'providerKeyVerdict' | 'preflightFailure'>,
    agentMessage: QaapAgentModelFallbackEvidence | undefined,
): boolean {
    if (!agentTurnMayFallBackToAnotherModel(turnAgentId, task)) {
        return false;
    }
    if (agentTurnHasRetryableToolSupportFailure(agentMessage)) {
        return true;
    }
    if (task.state !== 'failed') {
        return false;
    }
    // An account-level failure (quota, a usage cap, a key the provider refuses) repeats on every model
    // of the chain: switching model silently would spend or retry on the same account.
    const failureKind = agentMessage ? detectAgentFailureKind(collectAgentMessageDetails(agentMessage)) : undefined;
    if (failureKind && AGENT_ACCOUNT_LEVEL_FAILURE_KINDS.has(failureKind)) {
        return false;
    }
    return agentTurnHasRetryableEmptyOutput(agentMessage) || agentTurnHasRetryableModelFailure(agentMessage);
}

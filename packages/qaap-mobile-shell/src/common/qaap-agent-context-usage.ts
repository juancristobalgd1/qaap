// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

/** Keep in sync with {@link DEFAULT_QAAP_MODEL_CONTEXT_WINDOW} in qaap-qaiq-model-binding. */
export const DEFAULT_QAAP_CONTEXT_WINDOW = 128_000;

/** Latest provider-reported context snapshot for a VPS agent conversation. */
export interface QaapAgentContextUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheCreationInputTokens?: number;
    readonly cacheReadInputTokens?: number;
    readonly reasoningTokens?: number;
}

export interface ClaudeStreamUsageLike {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
}

export function usageFromClaudeStream(usage: ClaudeStreamUsageLike | undefined): QaapAgentContextUsage | undefined {
    if (!usage) {
        return undefined;
    }
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheCreationInputTokens = usage.cache_creation_input_tokens;
    const cacheReadInputTokens = usage.cache_read_input_tokens;
    if (inputTokens === 0 && outputTokens === 0 && !cacheCreationInputTokens && !cacheReadInputTokens) {
        return undefined;
    }
    return {
        inputTokens,
        outputTokens,
        ...(cacheCreationInputTokens ? { cacheCreationInputTokens } : {}),
        ...(cacheReadInputTokens ? { cacheReadInputTokens } : {}),
    };
}

export function totalTokensFromContextUsage(usage: QaapAgentContextUsage | undefined): number {
    if (!usage) {
        return 0;
    }
    return usage.inputTokens
        + usage.outputTokens
        + (usage.cacheCreationInputTokens ?? 0)
        + (usage.cacheReadInputTokens ?? 0)
        + (usage.reasoningTokens ?? 0);
}

export function mergeQaapAgentContextUsage(
    prior: QaapAgentContextUsage | undefined,
    delta: QaapAgentContextUsage | undefined,
): QaapAgentContextUsage | undefined {
    if (!delta) {
        return prior;
    }
    if (!prior) {
        return { ...delta };
    }
    const cacheCreationInputTokens = (prior.cacheCreationInputTokens ?? 0) + (delta.cacheCreationInputTokens ?? 0);
    const cacheReadInputTokens = (prior.cacheReadInputTokens ?? 0) + (delta.cacheReadInputTokens ?? 0);
    const reasoningTokens = (prior.reasoningTokens ?? 0) + (delta.reasoningTokens ?? 0);
    return {
        inputTokens: prior.inputTokens + delta.inputTokens,
        outputTokens: prior.outputTokens + delta.outputTokens,
        ...(cacheCreationInputTokens > 0 ? { cacheCreationInputTokens } : {}),
        ...(cacheReadInputTokens > 0 ? { cacheReadInputTokens } : {}),
        ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    };
}

export function estimateTokensFromText(text: string | undefined): number {
    return Math.max(0, Math.ceil((text?.length ?? 0) / 4));
}

/** Rough token estimate from transcript text when the agent CLI does not report usage. */
export function estimateConversationTokensFromMessages(
    messages: ReadonlyArray<{ readonly content: string; readonly segments?: ReadonlyArray<{ readonly type: string; readonly content?: string; readonly args?: string; readonly result?: string }> }>,
    contextPreamble?: string,
): number {
    let tokens = estimateTokensFromText(contextPreamble);
    for (const message of messages) {
        const segments = message.segments ?? [];
        if (segments.length === 0) {
            tokens += estimateTokensFromText(message.content);
            continue;
        }
        let chars = 0;
        for (const segment of segments) {
            if (segment.type === 'text' || segment.type === 'thinking') {
                chars += segment.content?.length ?? 0;
            } else if (segment.type === 'tool') {
                chars += (segment.args?.length ?? 0) + (segment.result?.length ?? 0);
            }
        }
        tokens += Math.max(0, Math.ceil(chars / 4));
    }
    return tokens;
}

export interface EstimatedConversationContextBreakdown {
    readonly promptContextTokens: number;
    readonly summarizedConversationTokens: number;
    readonly conversationTokens: number;
    readonly totalTokens: number;
}

export function estimateConversationContextBreakdown(
    messages: ReadonlyArray<{ readonly content: string; readonly segments?: ReadonlyArray<{ readonly type: string; readonly content?: string; readonly args?: string; readonly result?: string }> }>,
    contextPreamble?: string,
    contextCompaction?: { readonly status: string; readonly summary?: string; readonly compactedMessageCount: number },
): EstimatedConversationContextBreakdown {
    const completeCompaction = contextCompaction?.status === 'complete' && !!contextCompaction.summary?.trim()
        ? contextCompaction
        : undefined;
    const promptContextTokens = estimateTokensFromText(contextPreamble);
    const summarizedConversationTokens = estimateTokensFromText(completeCompaction?.summary);
    const activeMessages = completeCompaction ? messages.slice(completeCompaction.compactedMessageCount) : messages;
    const conversationTokens = estimateConversationTokensFromMessages(activeMessages);
    return {
        promptContextTokens,
        summarizedConversationTokens,
        conversationTokens,
        totalTokens: promptContextTokens + summarizedConversationTokens + conversationTokens,
    };
}

export function resolveConversationContextWindowSize(
    contextWindowSize: number | undefined,
): number {
    if (typeof contextWindowSize === 'number' && Number.isFinite(contextWindowSize) && contextWindowSize > 0) {
        return contextWindowSize;
    }
    return DEFAULT_QAAP_CONTEXT_WINDOW;
}

export function resolveVpsConversationTotalTokens(
    conv: Pick<QaapAgentConversationDTO, 'messages' | 'contextPreamble' | 'contextUsage' | 'contextUsageEstimated' | 'contextCompaction'>,
): { readonly totalTokens: number; readonly estimated: boolean } {
    const reported = totalTokensFromContextUsage(conv.contextUsage);
    if (reported > 0) {
        return { totalTokens: reported, estimated: false };
    }
    if (conv.contextUsageEstimated) {
        return {
            totalTokens: estimateConversationContextBreakdown(
                conv.messages,
                conv.contextPreamble,
                conv.contextCompaction,
            ).totalTokens,
            estimated: true,
        };
    }
    return { totalTokens: 0, estimated: false };
}

export function resolveVpsContextUsageFromSummary(
    summary: QaapAgentConversationSummaryDTO | undefined,
    full?: QaapAgentConversationDTO,
): { readonly totalTokens: number; readonly contextWindowSize: number; readonly usage?: QaapAgentContextUsage; readonly estimated: boolean } {
    if (full) {
        const { totalTokens, estimated } = resolveVpsConversationTotalTokens(full);
        return {
            totalTokens,
            estimated,
            usage: full.contextUsage,
            contextWindowSize: resolveConversationContextWindowSize(full.contextWindowSize),
        };
    }
    if (!summary) {
        return { totalTokens: 0, contextWindowSize: DEFAULT_QAAP_CONTEXT_WINDOW, estimated: false };
    }
    const reported = totalTokensFromContextUsage(summary.contextUsage);
    const contextWindowSize = resolveConversationContextWindowSize(summary.contextWindowSize);
    if (reported > 0) {
        return { totalTokens: reported, contextWindowSize, usage: summary.contextUsage, estimated: false };
    }
    if (summary.contextUsageEstimated && summary.estimatedContextTokens !== undefined) {
        return {
            totalTokens: summary.estimatedContextTokens,
            contextWindowSize,
            estimated: true,
        };
    }
    return { totalTokens: 0, contextWindowSize, estimated: false };
}

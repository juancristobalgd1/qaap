// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageEvent } from '@theia/qaap-shared-core/lib/common/qaap-usage-protocol';

/** Which turn the parsed lines belong to. */
export interface QaapClaudeUsageContext {
    readonly taskId: string;
    readonly turnId: string;
    readonly agentId: string;
}

/**
 * How the Claude Code run is paid for, from the `system/init` line's `apiKeySource`. `none` means the CLI
 * authenticated with the user's claude.ai OAuth login, so `total_cost_usd` is a notional API-equivalent and not
 * spend (`subscription`). Any key source (ANTHROPIC_API_KEY, apiKeyHelper, Bedrock...) is metered (`api`).
 */
export function resolveClaudeBilling(apiKeySource: unknown): QaapUsageEvent['billing'] {
    if (typeof apiKeySource !== 'string' || !apiKeySource.trim()) {
        return 'unknown';
    }
    return apiKeySource === 'none' ? 'subscription' : 'api';
}

const asCount = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * Stateful reader of Claude Code `--output-format stream-json` lines. Feed it every stdout line: it remembers
 * the billing mode from `system/init` and returns one usage event per `result` line. `total_cost_usd` is the
 * running total of the session (a stdio run keeps one process across turns), hence `cumulative: true` with
 * `costSource: 'reported'`; the CLI's own price table made the number, Qaap does not re-derive it.
 */
export class QaapClaudeUsageParser {

    protected billing: QaapUsageEvent['billing'] = 'unknown';
    protected model: string | undefined;

    constructor(protected readonly context: QaapClaudeUsageContext) { }

    parseLine(line: string): QaapUsageEvent | undefined {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
            return undefined;
        }
        let message: Record<string, unknown>;
        try {
            message = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
            return undefined;
        }
        if (message.type === 'system' && message.subtype === 'init') {
            this.billing = resolveClaudeBilling(message.apiKeySource);
            this.model = typeof message.model === 'string' ? message.model : undefined;
            return undefined;
        }
        if (message.type !== 'result') {
            return undefined;
        }
        const usage = (message.usage && typeof message.usage === 'object' ? message.usage : {}) as Record<string, unknown>;
        const cost = typeof message.total_cost_usd === 'number' && Number.isFinite(message.total_cost_usd) && message.total_cost_usd >= 0
            ? message.total_cost_usd
            : undefined;
        const details = (usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
            ? usage.output_tokens_details
            : {}) as Record<string, unknown>;
        return {
            ...this.context,
            ...(this.model ? { model: this.model } : {}),
            provider: 'anthropic',
            inputTokens: asCount(usage.input_tokens),
            outputTokens: asCount(usage.output_tokens),
            cacheReadTokens: asCount(usage.cache_read_input_tokens),
            cacheWriteTokens: asCount(usage.cache_creation_input_tokens),
            ...(details.thinking_tokens !== undefined ? { reasoningTokens: asCount(details.thinking_tokens) } : {}),
            ...(cost !== undefined ? { costUsd: cost } : {}),
            costSource: cost !== undefined ? 'reported' : 'none',
            billing: this.billing,
            cumulative: true,
        };
    }
}

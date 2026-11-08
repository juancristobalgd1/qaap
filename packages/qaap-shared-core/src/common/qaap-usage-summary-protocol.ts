// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Time window of a usage summary. `24h` yields hourly buckets, the others daily buckets. */
export type QaapUsageRange = '24h' | '7d' | '30d' | '90d';

/** Agent CLIs whose local logs are read for usage. */
export type QaapUsageProviderId = 'claude' | 'codex' | 'opencode' | 'pi' | 'grok' | 'copilot';

export interface QaapUsageTokenBreakdown {
    /** Uncached input tokens. */
    input: number;
    /** Input tokens served from the prompt cache. */
    cachedInput: number;
    /** Input tokens written to the prompt cache. */
    cacheWrite: number;
    output: number;
    reasoning: number;
}

export interface QaapUsageProviderRow {
    provider: QaapUsageProviderId;
    sessions: number;
    tokens: number;
    costUsd: number;
    /** Tokens for models without a known price, excluded from `costUsd`. */
    unpricedTokens: number;
    breakdown: QaapUsageTokenBreakdown;
}

export interface QaapUsageBucket {
    /** ISO timestamp of the bucket start in the requested timezone. */
    start: string;
    perProvider: { [provider: string]: { tokens: number; costUsd: number } };
}

export interface QaapUsageSummary {
    range: QaapUsageRange;
    timezone: string;
    generatedAt: string;
    totals: {
        sessions: number;
        tokens: number;
        costUsd: number;
        cacheSavingsUsd: number;
        breakdown: QaapUsageTokenBreakdown;
    };
    /** Ordered by cost, descending. */
    providers: QaapUsageProviderRow[];
    /** Hourly buckets when `range` is `24h`, daily buckets otherwise. */
    buckets: QaapUsageBucket[];
    /** Malformed or inconsistent records that were skipped. */
    skippedRecords: number;
    /** True while the first scan has not finished; the response is partial. */
    scanning: boolean;
}

export interface QaapUsageLimitWindow {
    id: string;
    label: string;
    usedPercent: number;
    resetsAt?: string;
    windowMinutes?: number;
}

export interface QaapUsageProviderLimits {
    provider: QaapUsageProviderId | 'antigravity';
    /** `loading` while the first local log scan is still running; the client should retry shortly. */
    status: 'ok' | 'loading' | 'unavailable' | 'error';
    reason?: string;
    windows: QaapUsageLimitWindow[];
    observedAt?: string;
}

export interface QaapUsageLimits {
    providers: QaapUsageProviderLimits[];
}

/** GET with query `range`, `tz` and optional `provider`: one id or a comma-separated list (`claude,codex`); empty means all. */
export const QAAP_USAGE_SUMMARY_PATH = '/qaap/api/usage/summary';
/** GET. */
export const QAAP_USAGE_LIMITS_PATH = '/qaap/api/usage/limits';

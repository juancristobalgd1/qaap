// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageTokenBreakdown } from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';

/** Defensive helpers shared by the log readers. Log formats change between CLI releases, so every field is checked. */
export namespace QaapUsageParsing {

    export const MILLISECONDS_PER_MINUTE = 60_000;

    /** Parses one JSON value and returns it only when it is a plain object. */
    export function parseObject(text: string): Record<string, unknown> | undefined {
        try {
            return objectOf(JSON.parse(text));
        } catch {
            return undefined;
        }
    }

    export function objectOf(value: unknown): Record<string, unknown> | undefined {
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    }

    export function isFiniteNumber(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /** A count is valid when it is a finite, non-negative number. Absent counts (undefined or null) are not invalid. */
    export function isInvalidCount(value: unknown): boolean {
        if (value === undefined || value === null) {
            return false;
        }
        return !(isFiniteNumber(value) && value >= 0);
    }

    export function hasInvalidCount(values: readonly unknown[]): boolean {
        return values.some(value => isInvalidCount(value));
    }

    /** The count, or zero when the field is absent. Call `hasInvalidCount` first. */
    export function count(value: unknown): number {
        return isFiniteNumber(value) && value >= 0 ? value : 0;
    }

    /**
     * Epoch milliseconds from an ISO string, a `YYYY-MM-DD HH:MM:SS` UTC string (SQLite `datetime`),
     * or a number already in milliseconds. Returns `undefined` when the value is unusable.
     */
    export function timestampMs(value: unknown): number | undefined {
        if (isFiniteNumber(value)) {
            return value > 0 ? value : undefined;
        }
        if (typeof value !== 'string' || !value.trim()) {
            return undefined;
        }
        const trimmed = value.trim();
        const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed);
        const parsed = Date.parse(sqlite ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
        return Number.isNaN(parsed) ? undefined : parsed;
    }

    /** Start of the minute containing `ms`; the aggregation granularity of the ledger. */
    export function minuteOf(ms: number): number {
        return Math.floor(ms / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE;
    }

    /**
     * Uncached input when a provider reports total prompt tokens that already include cache reads and writes.
     * Never negative.
     */
    export function uncachedInput(totalInput: number, cacheRead: number, cacheWrite: number): number {
        return Math.max(0, totalInput - cacheRead - cacheWrite);
    }

    /** Reasoning tokens are a subset of output tokens in every log format we read. */
    export function isReasoningConsistent(tokens: { output: number; reasoning: number }): boolean {
        return tokens.reasoning <= tokens.output;
    }

    /** All tokens that were processed (cache writes and cache reads included, reasoning already inside output). */
    export function processedTokens(tokens: QaapUsageTokenBreakdown): number {
        return tokens.input + tokens.cachedInput + tokens.cacheWrite + tokens.output;
    }

    export function isEmpty(tokens: QaapUsageTokenBreakdown): boolean {
        return processedTokens(tokens) === 0;
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageProviderId, QaapUsageTokenBreakdown } from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import type { QaapUsageLineContext, QaapUsageRateLimitObservation, QaapUsageRecord } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/**
 * Usage aggregated per minute, session and model. Records that carry a `dedupeKey` stay one entry each, so
 * that a message logged twice can be counted once when the ledger is summed.
 */
export interface QaapUsageLedgerEntry {
    provider: QaapUsageProviderId;
    sessionId: string;
    model: string;
    minuteMs: number;
    tokens: QaapUsageTokenBreakdown;
    reportedCostUsd?: number;
    dedupeKey?: string;
}

/** What the scanner remembers about one log file between scans. */
export interface QaapUsageFileState {
    size: number;
    mtimeMs: number;
    /** Byte offset just after the last complete line that was consumed. */
    offset: number;
    context: QaapUsageLineContext;
    entries: Map<string, QaapUsageLedgerEntry>;
    skipped: number;
    rateLimits?: QaapUsageRateLimitObservation;
}

/** Per-file usage state. Files are the unit of replacement, so a changed or deleted log drops only its own usage. */
export class QaapUsageLedger {

    protected readonly files = new Map<string, QaapUsageFileState>();

    get(file: string): QaapUsageFileState | undefined {
        return this.files.get(file);
    }

    set(file: string, state: QaapUsageFileState): void {
        this.files.set(file, state);
    }

    /** Keeps only the files for which `keep` is true. */
    retain(keep: (file: string) => boolean): void {
        for (const file of [...this.files.keys()]) {
            if (!keep(file)) {
                this.files.delete(file);
            }
        }
    }

    /** Adds a parsed record to a file's entries. Duplicates of a keyed message are dropped, the first one wins. */
    static merge(entries: Map<string, QaapUsageLedgerEntry>, record: QaapUsageRecord): void {
        const minuteMs = QaapUsageParsing.minuteOf(record.timestampMs);
        const key = record.dedupeKey
            ? `${record.provider}|${record.dedupeKey}`
            : `${record.provider}|${record.sessionId}|${record.model}|${minuteMs}`;
        const existing = entries.get(key);
        if (!existing) {
            entries.set(key, {
                provider: record.provider,
                sessionId: record.sessionId,
                model: record.model,
                minuteMs,
                tokens: { ...record.tokens },
                reportedCostUsd: record.reportedCostUsd,
                dedupeKey: record.dedupeKey,
            });
            return;
        }
        if (record.dedupeKey) {
            return;
        }
        existing.tokens = {
            input: existing.tokens.input + record.tokens.input,
            cachedInput: existing.tokens.cachedInput + record.tokens.cachedInput,
            cacheWrite: existing.tokens.cacheWrite + record.tokens.cacheWrite,
            output: existing.tokens.output + record.tokens.output,
            reasoning: existing.tokens.reasoning + record.tokens.reasoning,
        };
        if (record.reportedCostUsd !== undefined) {
            existing.reportedCostUsd = (existing.reportedCostUsd ?? 0) + record.reportedCostUsd;
        }
    }

    /** Every entry of every file, in file insertion order. */
    * allEntries(): IterableIterator<QaapUsageLedgerEntry> {
        for (const state of this.files.values()) {
            yield* state.entries.values();
        }
    }

    skippedRecords(): number {
        let total = 0;
        for (const state of this.files.values()) {
            total += state.skipped;
        }
        return total;
    }

    /** The most recent rate-limit observation across all files, or `undefined` when none was seen. */
    latestRateLimits(): QaapUsageRateLimitObservation | undefined {
        let latest: QaapUsageRateLimitObservation | undefined;
        for (const state of this.files.values()) {
            if (state.rateLimits && (!latest || state.rateLimits.observedAtMs > latest.observedAtMs)) {
                latest = state.rateLimits;
            }
        }
        return latest;
    }
}

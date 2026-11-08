// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapUsageBucket,
    QaapUsageProviderId,
    QaapUsageProviderRow,
    QaapUsageRange,
    QaapUsageSummary,
    QaapUsageTokenBreakdown,
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import type { QaapUsageLedger, QaapUsageLedgerEntry } from './qaap-usage-ledger';
import { QaapUsagePriceList } from './qaap-usage-prices';
import { QaapUsageParsing } from './qaap-usage-parsing';
import { QaapUsageTime } from './qaap-usage-time';

/** Days covered by each range. The 24h range is bucketed by hour instead. */
const RANGE_DAYS: Record<Exclude<QaapUsageRange, '24h'>, number> = { '7d': 7, '30d': 30, '90d': 90 };
const HOURS_IN_24H = 24;

export interface QaapUsageAggregationOptions {
    range: QaapUsageRange;
    timezone: string;
    /** Only these providers are summarized; empty or undefined means all of them. */
    providers?: readonly QaapUsageProviderId[];
    nowMs: number;
    scanning: boolean;
}

/** Turns the ledger into the summary the Usage panel shows. Pure apart from reading the ledger. */
export class QaapUsageAggregator {

    constructor(protected readonly prices: QaapUsagePriceList) { }

    summarize(ledger: QaapUsageLedger, options: QaapUsageAggregationOptions): QaapUsageSummary {
        const window = this.window(options);
        const perProvider = new Map<QaapUsageProviderId, ProviderAccumulator>();
        const totals = emptyAccumulator();
        const buckets: BucketAccumulator[] = window.starts.map(start => ({ start, perProvider: new Map() }));
        const seenDedupeKeys = new Set<string>();
        const providerFilter = options.providers && options.providers.length > 0 ? new Set(options.providers) : undefined;

        for (const entry of ledger.allEntries()) {
            if (providerFilter && !providerFilter.has(entry.provider)) {
                continue;
            }
            if (entry.minuteMs < window.startMs || entry.minuteMs > options.nowMs) {
                continue;
            }
            if (entry.dedupeKey) {
                const dedupeId = `${entry.provider}|${entry.dedupeKey}`;
                if (seenDedupeKeys.has(dedupeId)) {
                    continue;
                }
                seenDedupeKeys.add(dedupeId);
            }
            const priced = this.priceOf(entry);
            const bucketIndex = window.indexOf(entry.minuteMs);
            this.add(totals, entry, priced);
            this.addToProvider(perProvider, entry, priced);
            if (bucketIndex !== undefined) {
                this.addToBucket(buckets[bucketIndex], entry, priced);
            }
        }

        const providers = [...perProvider.entries()]
            .map(([provider, accumulator]) => toProviderRow(provider, accumulator))
            .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
        return {
            range: options.range,
            timezone: options.timezone,
            generatedAt: new Date(options.nowMs).toISOString(),
            totals: {
                sessions: providers.reduce((sum, row) => sum + row.sessions, 0),
                tokens: totals.tokens,
                costUsd: totals.costUsd,
                cacheSavingsUsd: totals.cacheSavingsUsd,
                breakdown: { ...totals.breakdown },
            },
            providers,
            buckets: buckets.map(bucket => ({
                start: new Date(bucket.start).toISOString(),
                perProvider: Object.fromEntries([...bucket.perProvider.entries()].map(([provider, value]) => [provider, { ...value }])),
            } satisfies QaapUsageBucket)),
            skippedRecords: ledger.skippedRecords(),
            scanning: options.scanning,
        };
    }

    /** Start of the window and of each bucket, in epoch milliseconds. */
    protected window(options: QaapUsageAggregationOptions): UsageWindow {
        if (options.range === '24h') {
            const currentHour = QaapUsageTime.startOfHour(options.nowMs);
            const startMs = currentHour - (HOURS_IN_24H - 1) * QaapUsageTime.HOUR;
            const starts = Array.from({ length: HOURS_IN_24H }, (_, index) => startMs + index * QaapUsageTime.HOUR);
            return {
                startMs,
                starts,
                indexOf: minuteMs => {
                    const index = Math.floor((minuteMs - startMs) / QaapUsageTime.HOUR);
                    return index >= 0 && index < HOURS_IN_24H ? index : undefined;
                },
            };
        }
        const days = RANGE_DAYS[options.range];
        const today = QaapUsageTime.localDateKey(options.nowMs, options.timezone);
        const firstKey = QaapUsageTime.addDays(today, -(days - 1));
        const keys = Array.from({ length: days }, (_, index) => QaapUsageTime.addDays(firstKey, index));
        const starts = keys.map(key => QaapUsageTime.startOfLocalDay(key, options.timezone));
        const indexByKey = new Map(keys.map((key, index) => [key, index]));
        return {
            startMs: starts[0],
            starts,
            indexOf: minuteMs => indexByKey.get(QaapUsageTime.localDateKey(minuteMs, options.timezone)),
        };
    }

    protected priceOf(entry: QaapUsageLedgerEntry): PricedEntry {
        const tokens = entry.tokens;
        if (entry.reportedCostUsd !== undefined) {
            return { costUsd: entry.reportedCostUsd, cacheSavingsUsd: 0, unpriced: false };
        }
        const cost = this.prices.costOf(entry.model, tokens);
        if (!cost) {
            return { costUsd: 0, cacheSavingsUsd: 0, unpriced: true };
        }
        return { costUsd: cost.costUsd, cacheSavingsUsd: cost.cacheSavingsUsd, unpriced: false };
    }

    protected add(target: Accumulator, entry: QaapUsageLedgerEntry, priced: PricedEntry): void {
        target.tokens += QaapUsageParsing.processedTokens(entry.tokens);
        target.costUsd += priced.costUsd;
        target.cacheSavingsUsd += priced.cacheSavingsUsd;
        addBreakdown(target.breakdown, entry.tokens);
    }

    protected addToProvider(perProvider: Map<QaapUsageProviderId, ProviderAccumulator>, entry: QaapUsageLedgerEntry, priced: PricedEntry): void {
        let accumulator = perProvider.get(entry.provider);
        if (!accumulator) {
            accumulator = { ...emptyAccumulator(), sessions: new Set<string>(), unpricedTokens: 0 };
            perProvider.set(entry.provider, accumulator);
        }
        this.add(accumulator, entry, priced);
        accumulator.sessions.add(entry.sessionId);
        if (priced.unpriced) {
            accumulator.unpricedTokens += QaapUsageParsing.processedTokens(entry.tokens);
        }
    }

    protected addToBucket(bucket: BucketAccumulator, entry: QaapUsageLedgerEntry, priced: PricedEntry): void {
        let value = bucket.perProvider.get(entry.provider);
        if (!value) {
            value = { tokens: 0, costUsd: 0 };
            bucket.perProvider.set(entry.provider, value);
        }
        value.tokens += QaapUsageParsing.processedTokens(entry.tokens);
        value.costUsd += priced.costUsd;
    }
}

interface UsageWindow {
    startMs: number;
    starts: number[];
    indexOf(minuteMs: number): number | undefined;
}

interface PricedEntry {
    costUsd: number;
    cacheSavingsUsd: number;
    unpriced: boolean;
}

interface Accumulator {
    tokens: number;
    costUsd: number;
    cacheSavingsUsd: number;
    breakdown: QaapUsageTokenBreakdown;
}

interface ProviderAccumulator extends Accumulator {
    sessions: Set<string>;
    unpricedTokens: number;
}

interface BucketAccumulator {
    start: number;
    perProvider: Map<QaapUsageProviderId, { tokens: number; costUsd: number }>;
}

function emptyAccumulator(): Accumulator {
    return { tokens: 0, costUsd: 0, cacheSavingsUsd: 0, breakdown: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 } };
}

function addBreakdown(target: QaapUsageTokenBreakdown, tokens: QaapUsageTokenBreakdown): void {
    target.input += tokens.input;
    target.cachedInput += tokens.cachedInput;
    target.cacheWrite += tokens.cacheWrite;
    target.output += tokens.output;
    target.reasoning += tokens.reasoning;
}

function toProviderRow(provider: QaapUsageProviderId, accumulator: ProviderAccumulator): QaapUsageProviderRow {
    return {
        provider,
        sessions: accumulator.sessions.size,
        tokens: accumulator.tokens,
        costUsd: accumulator.costUsd,
        unpricedTokens: accumulator.unpricedTokens,
        breakdown: { ...accumulator.breakdown },
    };
}

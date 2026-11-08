// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageTokenBreakdown } from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import { QAAP_USAGE_MODEL_PRICES } from './qaap-usage-model-prices-data';

/** List price in USD per million tokens. Cache rates fall back to the input rate when absent. */
export interface QaapUsageModelPrice {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
}

export interface QaapUsageCost {
    costUsd: number;
    /** What prompt caching saved against paying the input rate for the cached tokens. */
    cacheSavingsUsd: number;
}

/**
 * List prices from the compiled-in `QAAP_USAGE_MODEL_PRICES` table, a snapshot of the LiteLLM price catalogue
 * for the models the local agent CLIs use. Reported CLI costs never pass through here.
 */
export class QaapUsagePriceList {

    private static bundled: QaapUsagePriceList | undefined;

    protected constructor(protected readonly prices: ReadonlyMap<string, QaapUsageModelPrice>) { }

    /** The compiled-in table, built once per process. */
    static loadBundled(): QaapUsagePriceList {
        if (!QaapUsagePriceList.bundled) {
            QaapUsagePriceList.bundled = QaapUsagePriceList.fromJson(QAAP_USAGE_MODEL_PRICES);
        }
        return QaapUsagePriceList.bundled;
    }

    /** Builds a table from a parsed JSON object; entries without numeric input and output rates are dropped. */
    static fromJson(value: unknown): QaapUsagePriceList {
        const prices = new Map<string, QaapUsageModelPrice>();
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            for (const [model, entry] of Object.entries(value as Record<string, unknown>)) {
                const price = QaapUsagePriceList.toPrice(entry);
                if (price) {
                    prices.set(QaapUsagePriceList.normalizeModelId(model), price);
                }
            }
        }
        return new QaapUsagePriceList(prices);
    }

    /**
     * Lower-cases the id, drops a provider prefix (`anthropic/…`), a `:free` or `-free` suffix and a
     * trailing `-YYYYMMDD` release date, so that gateway and dated ids match the catalogue.
     */
    static normalizeModelId(model: string): string {
        return model.trim().toLowerCase()
            .replace(/^.*\//, '')
            .replace(/:free$/, '')
            .replace(/-free$/, '')
            .replace(/-\d{8}$/, '');
    }

    /** The list price for a model id, or `undefined` when the catalogue does not know it. */
    lookup(model: string): QaapUsageModelPrice | undefined {
        return this.prices.get(QaapUsagePriceList.normalizeModelId(model));
    }

    /** Cost of a token breakdown at list price, or `undefined` for unpriced models. */
    costOf(model: string, tokens: QaapUsageTokenBreakdown): QaapUsageCost | undefined {
        const price = this.lookup(model);
        if (!price) {
            return undefined;
        }
        const cacheReadRate = price.cacheRead ?? price.input;
        const cacheWriteRate = price.cacheWrite ?? price.input;
        const costUsd = (
            tokens.input * price.input
            + tokens.cachedInput * cacheReadRate
            + tokens.cacheWrite * cacheWriteRate
            + tokens.output * price.output
        ) / QaapUsagePriceList.TOKENS_PER_PRICE_UNIT;
        const cacheSavingsUsd = tokens.cachedInput * (price.input - cacheReadRate) / QaapUsagePriceList.TOKENS_PER_PRICE_UNIT;
        return { costUsd, cacheSavingsUsd: Math.max(0, cacheSavingsUsd) };
    }

    protected static readonly TOKENS_PER_PRICE_UNIT = 1_000_000;

    protected static toPrice(entry: unknown): QaapUsageModelPrice | undefined {
        if (typeof entry !== 'object' || entry === null) {
            return undefined;
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.input !== 'number' || typeof record.output !== 'number' || !Number.isFinite(record.input) || !Number.isFinite(record.output)) {
            return undefined;
        }
        const price: QaapUsageModelPrice = { input: record.input, output: record.output };
        if (typeof record.cacheRead === 'number' && Number.isFinite(record.cacheRead)) {
            price.cacheRead = record.cacheRead;
        }
        if (typeof record.cacheWrite === 'number' && Number.isFinite(record.cacheWrite)) {
            price.cacheWrite = record.cacheWrite;
        }
        return price;
    }
}

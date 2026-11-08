// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageLineContext, QaapUsageParseResult } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/**
 * Reads Pi agent sessions (`~/.pi/agent/sessions/**\/*.jsonl`). Pi reports `totalTokens` but no output count,
 * so output is derived as the remainder after input and cache tokens.
 */
export namespace QaapUsagePiReader {

    /** Parses one JSONL line. `context` is updated in place by the `session` line. */
    export function parseLine(line: string, context: QaapUsageLineContext): QaapUsageParseResult | undefined {
        const entry = QaapUsageParsing.parseObject(line);
        if (!entry) {
            return { skipped: true };
        }
        if (entry.type === 'session') {
            if (typeof entry.id === 'string' && entry.id) {
                context.sessionId = entry.id;
            }
            return undefined;
        }
        if (entry.type !== 'message') {
            return undefined;
        }
        const message = QaapUsageParsing.objectOf(entry.message);
        if (message?.role !== 'assistant') {
            return undefined;
        }
        const usage = QaapUsageParsing.objectOf(message.usage);
        if (!usage) {
            return undefined;
        }
        const timestampMs = QaapUsageParsing.timestampMs(entry.timestamp) ?? QaapUsageParsing.timestampMs(message.timestamp);
        const cost = QaapUsageParsing.objectOf(usage.cost);
        const counts = [usage.input, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
        if (QaapUsageParsing.hasInvalidCount(counts) || timestampMs === undefined) {
            return { skipped: true };
        }
        const input = QaapUsageParsing.count(usage.input);
        const cacheRead = QaapUsageParsing.count(usage.cacheRead);
        const cacheWrite = QaapUsageParsing.count(usage.cacheWrite);
        const total = QaapUsageParsing.count(usage.totalTokens);
        const output = total - input - cacheRead - cacheWrite;
        if (output < 0) {
            return { skipped: true };
        }
        const tokens = { input, cachedInput: cacheRead, cacheWrite, output, reasoning: 0 };
        if (QaapUsageParsing.isEmpty(tokens)) {
            return undefined;
        }
        const reportedCostUsd = QaapUsageParsing.isFiniteNumber(cost?.total) && cost.total >= 0 ? cost.total : undefined;
        return {
            record: {
                provider: 'pi',
                sessionId: context.sessionId ?? context.fallbackSessionId,
                model: typeof message.model === 'string' && message.model ? message.model : 'unknown',
                timestampMs,
                tokens,
                reportedCostUsd,
                dedupeKey: typeof entry.id === 'string' && entry.id ? `pi:${entry.id}` : undefined,
            },
        };
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageParseResult } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/** Reads Copilot CLI usage rows (`~/.copilot/session-store.db`, table `assistant_usage_events`). */
export namespace QaapUsageCopilotReader {

    /** Parses one row of `assistant_usage_events`; `row` is untrusted data from the database. */
    export function parseRow(row: unknown): QaapUsageParseResult | undefined {
        const entry = QaapUsageParsing.objectOf(row);
        if (!entry) {
            return { skipped: true };
        }
        const counts = [entry.input_tokens, entry.output_tokens, entry.cache_read_tokens, entry.cache_write_tokens, entry.reasoning_tokens];
        const timestampMs = QaapUsageParsing.timestampMs(entry.created_at);
        if (QaapUsageParsing.hasInvalidCount(counts) || timestampMs === undefined || typeof entry.session_id !== 'string' || !entry.session_id) {
            return { skipped: true };
        }
        const cacheRead = QaapUsageParsing.count(entry.cache_read_tokens);
        const cacheWrite = QaapUsageParsing.count(entry.cache_write_tokens);
        const tokens = {
            input: QaapUsageParsing.uncachedInput(QaapUsageParsing.count(entry.input_tokens), cacheRead, cacheWrite),
            cachedInput: cacheRead,
            cacheWrite,
            output: QaapUsageParsing.count(entry.output_tokens),
            reasoning: QaapUsageParsing.count(entry.reasoning_tokens),
        };
        if (QaapUsageParsing.isEmpty(tokens)) {
            return undefined;
        }
        if (!QaapUsageParsing.isReasoningConsistent(tokens)) {
            return { skipped: true };
        }
        return {
            record: {
                provider: 'copilot',
                sessionId: entry.session_id,
                model: typeof entry.model === 'string' && entry.model ? entry.model : 'unknown',
                timestampMs,
                tokens,
                dedupeKey: QaapUsageParsing.isFiniteNumber(entry.id) ? `copilot:${entry.id}` : undefined,
            },
        };
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageParseResult, QaapUsageRecord } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/**
 * Reads Grok session summaries (`~/.grok/sessions/**\/usage.json`). Per-turn entries are preferred; the session
 * totals are used only when no turn list exists. Grok reports no trustworthy cost, so list prices apply.
 */
export namespace QaapUsageGrokReader {

    /** Parses one `usage.json` document into zero or more records. */
    export function parseDocument(text: string, fallbackSessionId: string): QaapUsageParseResult[] {
        const document = QaapUsageParsing.parseObject(text);
        if (!document) {
            return [{ skipped: true }];
        }
        const sessionId = typeof document.sessionId === 'string' && document.sessionId ? document.sessionId : fallbackSessionId;
        const updatedMs = QaapUsageParsing.timestampMs(document.updatedAt);
        const turns = Array.isArray(document.turns) ? document.turns : [];
        if (turns.length > 0) {
            return turns.map(turn => parseEntry(QaapUsageParsing.objectOf(turn), sessionId, updatedMs, true));
        }
        const session = QaapUsageParsing.objectOf(document.session);
        return session ? [parseEntry(session, sessionId, updatedMs, false)] : [];
    }

    function parseEntry(entry: Record<string, unknown> | undefined, sessionId: string, updatedMs: number | undefined, isTurn: boolean): QaapUsageParseResult {
        if (!entry) {
            return { skipped: true };
        }
        const counts = [entry.inputTokens, entry.outputTokens, entry.cachedReadTokens, entry.cacheCreationTokens, entry.reasoningTokens];
        const timestampMs = QaapUsageParsing.timestampMs(entry.endedAt) ?? updatedMs;
        if (QaapUsageParsing.hasInvalidCount(counts) || timestampMs === undefined) {
            return { skipped: true };
        }
        const cacheRead = QaapUsageParsing.count(entry.cachedReadTokens);
        const cacheWrite = QaapUsageParsing.count(entry.cacheCreationTokens);
        const tokens = {
            input: QaapUsageParsing.uncachedInput(QaapUsageParsing.count(entry.inputTokens), cacheRead, cacheWrite),
            cachedInput: cacheRead,
            cacheWrite,
            output: QaapUsageParsing.count(entry.outputTokens),
            reasoning: QaapUsageParsing.count(entry.reasoningTokens),
        };
        if (QaapUsageParsing.isEmpty(tokens)) {
            return {};
        }
        const record: QaapUsageRecord = {
            provider: 'grok',
            sessionId,
            model: typeof entry.primaryModelId === 'string' && entry.primaryModelId ? entry.primaryModelId : 'unknown',
            timestampMs,
            tokens,
            dedupeKey: isTurn && QaapUsageParsing.isFiniteNumber(entry.turnNumber) ? `grok:${sessionId}:${entry.turnNumber}` : `grok:${sessionId}:session`,
        };
        return { record };
    }
}

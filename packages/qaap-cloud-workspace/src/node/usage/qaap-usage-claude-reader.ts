// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageLineContext, QaapUsageParseResult } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/** Reads Claude Code session logs (`<config>/projects/**\/*.jsonl`, subagent logs included). */
export namespace QaapUsageClaudeReader {

    /** Placeholder model Claude Code writes for locally generated messages; they cost nothing. */
    export const SYNTHETIC_MODEL = '<synthetic>';

    /** Parses one JSONL line. Returns `undefined` for lines that carry no usage. */
    export function parseLine(line: string, context: QaapUsageLineContext): QaapUsageParseResult | undefined {
        const entry = QaapUsageParsing.parseObject(line);
        if (!entry) {
            return { skipped: true };
        }
        if (entry.type !== 'assistant') {
            return undefined;
        }
        const message = QaapUsageParsing.objectOf(entry.message);
        const usage = QaapUsageParsing.objectOf(message?.usage);
        if (!message || !usage) {
            return undefined;
        }
        const model = typeof message.model === 'string' && message.model ? message.model : 'unknown';
        if (model === SYNTHETIC_MODEL) {
            return undefined;
        }
        const details = QaapUsageParsing.objectOf(usage.output_tokens_details);
        const counts = [
            usage.input_tokens,
            usage.cache_read_input_tokens,
            usage.cache_creation_input_tokens,
            usage.output_tokens,
            details?.thinking_tokens,
        ];
        const timestampMs = QaapUsageParsing.timestampMs(entry.timestamp);
        if (QaapUsageParsing.hasInvalidCount(counts) || timestampMs === undefined) {
            return { skipped: true };
        }
        const tokens = {
            input: QaapUsageParsing.count(usage.input_tokens),
            cachedInput: QaapUsageParsing.count(usage.cache_read_input_tokens),
            cacheWrite: QaapUsageParsing.count(usage.cache_creation_input_tokens),
            output: QaapUsageParsing.count(usage.output_tokens),
            reasoning: QaapUsageParsing.count(details?.thinking_tokens),
        };
        if (QaapUsageParsing.isEmpty(tokens)) {
            return undefined;
        }
        if (!QaapUsageParsing.isReasoningConsistent(tokens)) {
            return { skipped: true };
        }
        const sessionId = typeof entry.sessionId === 'string' && entry.sessionId ? entry.sessionId : context.fallbackSessionId;
        const messageId = typeof message.id === 'string' ? message.id : undefined;
        const requestId = typeof entry.requestId === 'string' ? entry.requestId : '';
        return {
            record: {
                provider: 'claude',
                sessionId,
                model,
                timestampMs,
                tokens,
                // Claude Code writes one line per content block; each carries the same message usage.
                dedupeKey: messageId ? `${messageId}:${requestId}` : undefined,
            },
        };
    }
}

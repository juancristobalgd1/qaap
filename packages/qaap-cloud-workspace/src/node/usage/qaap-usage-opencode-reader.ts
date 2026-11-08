// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageParseResult } from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/**
 * Reads OpenCode storage (`<data>/opencode/storage`). Token usage lives in `step-finish` parts; the model and
 * creation time live in the message file that the part points to. The CLI reports the cost itself.
 */
export namespace QaapUsageOpenCodeReader {

    export interface MessageMeta {
        model: string;
        createdMs?: number;
    }

    /** Reads the model and creation time from one message file. */
    export function parseMessage(text: string): { id: string; meta: MessageMeta } | undefined {
        const message = QaapUsageParsing.parseObject(text);
        if (!message || typeof message.id !== 'string' || !message.id) {
            return undefined;
        }
        const model = QaapUsageParsing.objectOf(message.model);
        const time = QaapUsageParsing.objectOf(message.time);
        return {
            id: message.id,
            meta: {
                model: typeof model?.modelID === 'string' && model.modelID ? model.modelID : 'unknown',
                createdMs: QaapUsageParsing.timestampMs(time?.created),
            },
        };
    }

    /**
     * Reads one part file. `lookup` resolves the owning message; when it is missing the model is `unknown`
     * and the time falls back to `fallbackTimestampMs`. Returns `undefined` for parts that are not `step-finish`.
     */
    export function parsePart(
        text: string,
        lookup: (messageId: string) => MessageMeta | undefined,
        fallbackTimestampMs: number,
    ): QaapUsageParseResult | undefined {
        const part = QaapUsageParsing.parseObject(text);
        if (!part) {
            return { skipped: true };
        }
        if (part.type !== 'step-finish') {
            return undefined;
        }
        const tokens = QaapUsageParsing.objectOf(part.tokens);
        const cache = QaapUsageParsing.objectOf(tokens?.cache);
        const counts = [tokens?.input, tokens?.output, tokens?.reasoning, cache?.read, cache?.write];
        if (!tokens || typeof part.sessionID !== 'string' || !part.sessionID || QaapUsageParsing.hasInvalidCount(counts)) {
            return { skipped: true };
        }
        const usage = {
            input: QaapUsageParsing.count(tokens.input),
            cachedInput: QaapUsageParsing.count(cache?.read),
            cacheWrite: QaapUsageParsing.count(cache?.write),
            output: QaapUsageParsing.count(tokens.output),
            reasoning: QaapUsageParsing.count(tokens.reasoning),
        };
        if (QaapUsageParsing.isEmpty(usage)) {
            return undefined;
        }
        if (!QaapUsageParsing.isReasoningConsistent(usage)) {
            return { skipped: true };
        }
        const meta = typeof part.messageID === 'string' ? lookup(part.messageID) : undefined;
        const reportedCostUsd = QaapUsageParsing.isFiniteNumber(part.cost) && part.cost >= 0 ? part.cost : undefined;
        return {
            record: {
                provider: 'opencode',
                sessionId: part.sessionID,
                model: meta?.model ?? 'unknown',
                timestampMs: meta?.createdMs ?? fallbackTimestampMs,
                tokens: usage,
                reportedCostUsd,
                dedupeKey: typeof part.id === 'string' && part.id ? `opencode:${part.id}` : undefined,
            },
        };
    }
}

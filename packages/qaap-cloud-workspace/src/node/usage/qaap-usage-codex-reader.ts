// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapUsageLineContext,
    QaapUsageParseResult,
    QaapUsageRateLimitObservation,
    QaapUsageRateLimitWindowReading,
} from './qaap-usage-record';
import { QaapUsageParsing } from './qaap-usage-parsing';

/**
 * Reads Codex rollout logs (`~/.codex/sessions/**\/rollout-*.jsonl`). Each `token_count` event carries the
 * usage of one turn in `last_token_usage`, so the per-turn values are summed and the running total is ignored.
 */
export namespace QaapUsageCodexReader {

    /** Parses one JSONL line. `context` is updated in place by `session_meta` and `turn_context` lines. */
    export function parseLine(line: string, context: QaapUsageLineContext): QaapUsageParseResult | undefined {
        const entry = QaapUsageParsing.parseObject(line);
        if (!entry) {
            return { skipped: true };
        }
        const payload = QaapUsageParsing.objectOf(entry.payload);
        if (entry.type === 'session_meta') {
            if (typeof payload?.id === 'string' && payload.id) {
                context.sessionId = payload.id;
            }
            return undefined;
        }
        if (entry.type === 'turn_context') {
            if (typeof payload?.model === 'string' && payload.model) {
                context.model = payload.model;
            }
            return undefined;
        }
        if (entry.type !== 'event_msg' || payload?.type !== 'token_count') {
            return undefined;
        }
        const timestampMs = QaapUsageParsing.timestampMs(entry.timestamp);
        const rateLimits = parseRateLimits(payload.rate_limits, timestampMs);
        const last = QaapUsageParsing.objectOf(QaapUsageParsing.objectOf(payload.info)?.last_token_usage);
        if (!last) {
            return rateLimits ? { rateLimits } : undefined;
        }
        const counts = [last.input_tokens, last.cached_input_tokens, last.output_tokens, last.reasoning_output_tokens, last.total_tokens];
        if (QaapUsageParsing.hasInvalidCount(counts) || timestampMs === undefined) {
            return { skipped: true, rateLimits };
        }
        const totalInput = QaapUsageParsing.count(last.input_tokens);
        const cached = QaapUsageParsing.count(last.cached_input_tokens);
        const output = QaapUsageParsing.count(last.output_tokens);
        const reasoning = QaapUsageParsing.count(last.reasoning_output_tokens);
        const reportedTotal = last.total_tokens;
        const inconsistent = cached > totalInput
            || !QaapUsageParsing.isReasoningConsistent({ output, reasoning })
            || (reportedTotal !== undefined && QaapUsageParsing.count(reportedTotal) !== totalInput + output);
        if (inconsistent) {
            return { skipped: true, rateLimits };
        }
        const tokens = { input: totalInput - cached, cachedInput: cached, cacheWrite: 0, output, reasoning };
        if (QaapUsageParsing.isEmpty(tokens)) {
            return rateLimits ? { rateLimits } : undefined;
        }
        return {
            rateLimits,
            record: {
                provider: 'codex',
                sessionId: context.sessionId ?? context.fallbackSessionId,
                model: context.model ?? 'unknown',
                timestampMs,
                tokens,
            },
        };
    }

    function parseRateLimits(value: unknown, timestampMs: number | undefined): QaapUsageRateLimitObservation | undefined {
        const limits = QaapUsageParsing.objectOf(value);
        if (!limits || timestampMs === undefined) {
            return undefined;
        }
        const primary = parseWindow(limits.primary);
        const secondary = parseWindow(limits.secondary);
        if (!primary && !secondary) {
            return undefined;
        }
        return { observedAtMs: timestampMs, primary, secondary };
    }

    function parseWindow(value: unknown): QaapUsageRateLimitWindowReading | undefined {
        const window = QaapUsageParsing.objectOf(value);
        if (!window || !QaapUsageParsing.isFiniteNumber(window.used_percent) || !QaapUsageParsing.isFiniteNumber(window.window_minutes)) {
            return undefined;
        }
        const resetsAtMs = QaapUsageParsing.isFiniteNumber(window.resets_at) ? window.resets_at * 1000 : undefined;
        return { usedPercent: window.used_percent, windowMinutes: window.window_minutes, resetsAtMs };
    }
}

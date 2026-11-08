// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapUsageProviderId, QaapUsageTokenBreakdown } from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';

/** One usage event read from a provider log, before aggregation. */
export interface QaapUsageRecord {
    provider: QaapUsageProviderId;
    sessionId: string;
    model: string;
    timestampMs: number;
    /** `input` is uncached input; `output` already includes `reasoning`. */
    tokens: QaapUsageTokenBreakdown;
    /** Cost the CLI reported itself (OpenCode, Pi). Takes precedence over list prices. */
    reportedCostUsd?: number;
    /** Stable id of the upstream message, so that duplicate log entries count once. */
    dedupeKey?: string;
}

/** Last rate-limit windows a Codex log reported, with the time they were observed. */
export interface QaapUsageRateLimitObservation {
    observedAtMs: number;
    primary?: QaapUsageRateLimitWindowReading;
    secondary?: QaapUsageRateLimitWindowReading;
}

export interface QaapUsageRateLimitWindowReading {
    usedPercent: number;
    windowMinutes: number;
    resetsAtMs?: number;
}

/** Outcome of parsing one log line or document entry. Absent fields mean nothing was found. */
export interface QaapUsageParseResult {
    record?: QaapUsageRecord;
    rateLimits?: QaapUsageRateLimitObservation;
    /** Malformed or internally inconsistent entry. */
    skipped?: boolean;
}

/** State a line reader shares across the lines of one file, including across incremental reads. */
export interface QaapUsageLineContext {
    /** Session id taken from the file name, used when the log does not announce one. */
    fallbackSessionId: string;
    /** Session id announced by the log (Codex `session_meta`, Pi `session`). */
    sessionId?: string;
    /** Most recent model announced by the log (Codex `turn_context`). */
    model?: string;
}

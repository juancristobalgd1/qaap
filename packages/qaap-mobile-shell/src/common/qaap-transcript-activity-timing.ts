// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { formatTranscriptActivityStepDuration } from './qaap-transcript-activity-step-state';

interface TranscriptActivityTimingEntry {
    startedAt: number;
    finishedAt?: number;
}

type TimedToolSegment = Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> & {
    readonly startedAt?: number;
    readonly finishedAt?: number;
};

export interface TranscriptActivityTimingObserveOptions {
    /** When true, the tail thinking segment stays live until the turn settles. */
    readonly streaming?: boolean;
}

function timingKey(messageId: string, segmentIndex: number): string {
    return `${messageId}:${segmentIndex}`;
}

function isThinkingSegmentSettled(
    segmentIndex: number,
    segments: readonly QaapAgentMessageSegmentDTO[],
    streaming: boolean,
): boolean {
    if (segmentIndex < segments.length - 1) {
        return true;
    }
    return !streaming;
}

/** Client-side step timing while SSE patches arrive (backend may also supply startedAt/finishedAt). */
export class TranscriptActivityTimingStore {
    protected readonly entries = new Map<string, TranscriptActivityTimingEntry>();

    observe(
        messageId: string,
        segments: readonly QaapAgentMessageSegmentDTO[],
        now = Date.now(),
        options?: TranscriptActivityTimingObserveOptions,
    ): void {
        const streaming = options?.streaming === true;
        segments.forEach((segment, segmentIndex) => {
            const key = timingKey(messageId, segmentIndex);
            if (segment.type === 'thinking') {
                const settled = isThinkingSegmentSettled(segmentIndex, segments, streaming);
                const existing = this.entries.get(key);
                if (!existing) {
                    if (settled) {
                        return;
                    }
                    this.entries.set(key, { startedAt: now });
                }
                const entry = this.entries.get(key)!;
                if (settled && entry.finishedAt === undefined) {
                    entry.finishedAt = now;
                }
                return;
            }
            if (segment.type !== 'tool') {
                return;
            }
            const wireStarted = (segment as TimedToolSegment).startedAt;
            const wireFinished = (segment as TimedToolSegment).finishedAt;
            const existing = this.entries.get(key);
            if (!existing) {
                if (segment.finished && wireStarted === undefined && wireFinished === undefined) {
                    return;
                }
                this.entries.set(key, {
                    startedAt: wireStarted ?? now,
                    finishedAt: wireFinished,
                });
                return;
            }
            if (wireStarted !== undefined && wireStarted < existing.startedAt) {
                existing.startedAt = wireStarted;
            }
            if (wireFinished !== undefined) {
                existing.finishedAt = wireFinished;
            } else if (segment.finished && existing.finishedAt === undefined) {
                existing.finishedAt = now;
            }
        });
    }

    resolveDurationMs(
        messageId: string,
        segmentIndex: number | undefined,
        segment?: QaapAgentMessageSegmentDTO,
        now = Date.now(),
    ): number | undefined {
        if (segmentIndex === undefined) {
            return undefined;
        }
        const key = timingKey(messageId, segmentIndex);
        const entry = this.entries.get(key);
        const wireStarted = segment?.type === 'tool'
            ? (segment as TimedToolSegment).startedAt
            : undefined;
        const wireFinished = segment?.type === 'tool'
            ? (segment as TimedToolSegment).finishedAt
            : undefined;
        const startedAt = wireStarted ?? entry?.startedAt;
        if (startedAt === undefined) {
            return undefined;
        }
        const finishedAt = wireFinished ?? entry?.finishedAt;
        if (finishedAt === undefined) {
            if (segment?.type === 'tool' && !segment.finished) {
                return Math.max(0, now - startedAt);
            }
            if (segment?.type === 'thinking') {
                return Math.max(0, now - startedAt);
            }
            return undefined;
        }
        return Math.max(0, finishedAt - startedAt);
    }

    resolveTimestamp(
        messageId: string,
        segmentIndex: number | undefined,
        segment?: QaapAgentMessageSegmentDTO,
    ): number | undefined {
        if (segmentIndex === undefined) {
            return undefined;
        }
        const wireFinished = segment?.type === 'tool'
            ? (segment as TimedToolSegment).finishedAt
            : undefined;
        if (wireFinished !== undefined) {
            return wireFinished;
        }
        const entry = this.entries.get(timingKey(messageId, segmentIndex));
        if (segment?.type === 'thinking') {
            return entry?.finishedAt ?? entry?.startedAt;
        }
        return entry?.finishedAt;
    }

    clearConversation(messageIds: readonly string[]): void {
        const prefixes = new Set(messageIds.map(id => `${id}:`));
        for (const key of [...this.entries.keys()]) {
            for (const prefix of prefixes) {
                if (key.startsWith(prefix)) {
                    this.entries.delete(key);
                    break;
                }
            }
        }
    }
}

export function formatTranscriptActivityStepMeta(
    durationMs: number | undefined,
    timestampMs?: number,
    now = Date.now(),
): string | undefined {
    const parts: string[] = [];
    if (durationMs !== undefined && Number.isFinite(durationMs)) {
        parts.push(formatTranscriptActivityStepDuration(durationMs));
    }
    const relative = formatTranscriptActivityStepRelativeTime(timestampMs, now);
    if (relative) {
        parts.push(relative);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Compact relative stamp for settled steps — "just now", "2m ago". */
export function formatTranscriptActivityStepRelativeTime(
    timestampMs: number | undefined,
    now = Date.now(),
): string | undefined {
    if (timestampMs === undefined || !Number.isFinite(timestampMs)) {
        return undefined;
    }
    const delta = Math.max(0, now - timestampMs);
    if (delta < 45_000) {
        return 'just now';
    }
    if (delta < 3_600_000) {
        const minutes = Math.max(1, Math.round(delta / 60_000));
        return `${minutes}m ago`;
    }
    const hours = Math.max(1, Math.round(delta / 3_600_000));
    return `${hours}h ago`;
}

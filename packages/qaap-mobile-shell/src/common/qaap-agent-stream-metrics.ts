// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentWireCompressionEncoding } from './qaap-agent-wire-encoding';

/** Opt-in stream pipeline metrics — enable with `localStorage.setItem('qaap.streamMetrics', '1')`. */
export const QAAP_STREAM_METRICS_STORAGE_KEY = 'qaap.streamMetrics';

export type QaapStreamMetricsSide = 'server' | 'client';

export type QaapStreamMetricsTransport = 'ws' | 'sse' | 'unknown';

export type QaapTurnLatencyMark =
    | 'ui_submit_clicked'
    | 'optimistic_render_done'
    | 'pre_post_get_start'
    | 'pre_post_get_end'
    | 'post_message_start'
    | 'post_message_end'
    | 'backend_user_message_persisted'
    | 'task_created'
    | 'build_agent_command_start'
    | 'build_agent_command_end'
    | 'spawn_start'
    | 'spawn_end'
    | 'first_stdout_chunk'
    | 'first_transcript_delta_rendered';

export interface QaapConversationStreamMetricsSnapshot {
    readonly side: QaapStreamMetricsSide;
    readonly conversationId: string;
    readonly transport: QaapStreamMetricsTransport;
    readonly durationMs: number;
    readonly eventsTotal: number;
    readonly eventsPerSecond: number;
    readonly bytesTotal: number;
    readonly bytesPerEvent: number;
    readonly messageEvents: number;
    readonly messageDeltaEvents: number;
    readonly updatedEvents: number;
    readonly compressedFields: number;
    readonly compressionSavedBytes: number;
    readonly latencyMarks: Partial<Record<QaapTurnLatencyMark, number>>;
}

interface ActiveTurnMetrics {
    readonly startedAt: number;
    eventsTotal: number;
    bytesTotal: number;
    messageEvents: number;
    messageDeltaEvents: number;
    updatedEvents: number;
    compressedFields: number;
    compressionSavedBytes: number;
    transport: QaapStreamMetricsTransport;
    latencyMarks: Partial<Record<QaapTurnLatencyMark, number>>;
}

export function isQaapStreamMetricsEnabled(): boolean {
    if (typeof localStorage !== 'undefined') {
        try {
            if (localStorage.getItem(QAAP_STREAM_METRICS_STORAGE_KEY) === '1') {
                return true;
            }
        } catch {
            /* private mode */
        }
    }
    if (typeof process !== 'undefined' && process.env.QAAP_STREAM_METRICS === '1') {
        return true;
    }
    return false;
}

/** Per-conversation counters for one streaming turn (server or browser). */
export class QaapConversationStreamMetricsCollector {

    protected readonly active = new Map<string, ActiveTurnMetrics>();

    constructor(protected readonly side: QaapStreamMetricsSide) { }

    setTransport(conversationId: string, transport: QaapStreamMetricsTransport): void {
        if (!isQaapStreamMetricsEnabled()) {
            return;
        }
        const turn = this.ensureTurn(conversationId);
        turn.transport = transport;
    }

    recordWireEvent(
        conversationId: string,
        eventType: string,
        payload: unknown,
        options?: {
            readonly uncompressedPayload?: unknown;
            readonly compressedFieldCount?: number;
        },
    ): QaapConversationStreamMetricsSnapshot | undefined {
        if (!isQaapStreamMetricsEnabled() || !conversationId) {
            return undefined;
        }
        const turn = this.ensureTurn(conversationId);
        const bytes = estimateJsonBytes(payload);
        turn.eventsTotal++;
        turn.bytesTotal += bytes;
        if (eventType === 'message') {
            turn.messageEvents++;
        } else if (eventType === 'message_delta') {
            turn.messageDeltaEvents++;
        } else if (eventType === 'updated') {
            turn.updatedEvents++;
        }
        if (options?.compressedFieldCount) {
            turn.compressedFields += options.compressedFieldCount;
        }
        if (options?.uncompressedPayload !== undefined) {
            const uncompressedBytes = estimateJsonBytes(options.uncompressedPayload);
            if (uncompressedBytes > bytes) {
                turn.compressionSavedBytes += uncompressedBytes - bytes;
            }
        }
        return undefined;
    }

    recordLatencyMark(
        conversationId: string | undefined,
        mark: QaapTurnLatencyMark,
        at = Date.now(),
    ): void {
        if (!isQaapStreamMetricsEnabled() || !conversationId) {
            return;
        }
        const turn = this.ensureTurn(conversationId);
        if (turn.latencyMarks[mark] === undefined) {
            turn.latencyMarks[mark] = at;
        }
    }

    finishTurn(conversationId: string): QaapConversationStreamMetricsSnapshot | undefined {
        if (!isQaapStreamMetricsEnabled()) {
            return undefined;
        }
        const turn = this.active.get(conversationId);
        if (!turn) {
            return undefined;
        }
        this.active.delete(conversationId);
        return this.toSnapshot(conversationId, turn);
    }

    protected ensureTurn(conversationId: string): ActiveTurnMetrics {
        const existing = this.active.get(conversationId);
        if (existing) {
            return existing;
        }
        const created: ActiveTurnMetrics = {
            startedAt: Date.now(),
            eventsTotal: 0,
            bytesTotal: 0,
            messageEvents: 0,
            messageDeltaEvents: 0,
            updatedEvents: 0,
            compressedFields: 0,
            compressionSavedBytes: 0,
            transport: 'unknown',
            latencyMarks: {},
        };
        this.active.set(conversationId, created);
        return created;
    }

    protected toSnapshot(conversationId: string, turn: ActiveTurnMetrics): QaapConversationStreamMetricsSnapshot {
        const durationMs = Math.max(1, Date.now() - turn.startedAt);
        const eventsTotal = turn.eventsTotal;
        const bytesTotal = turn.bytesTotal;
        return {
            side: this.side,
            conversationId,
            transport: turn.transport,
            durationMs,
            eventsTotal,
            eventsPerSecond: round2((eventsTotal * 1000) / durationMs),
            bytesTotal,
            bytesPerEvent: eventsTotal > 0 ? Math.round(bytesTotal / eventsTotal) : 0,
            messageEvents: turn.messageEvents,
            messageDeltaEvents: turn.messageDeltaEvents,
            updatedEvents: turn.updatedEvents,
            compressedFields: turn.compressedFields,
            compressionSavedBytes: turn.compressionSavedBytes,
            latencyMarks: this.toRelativeLatencyMarks(turn),
        };
    }

    protected toRelativeLatencyMarks(turn: ActiveTurnMetrics): Partial<Record<QaapTurnLatencyMark, number>> {
        const base = turn.latencyMarks.ui_submit_clicked ?? turn.startedAt;
        const relative: Partial<Record<QaapTurnLatencyMark, number>> = {};
        for (const [mark, at] of Object.entries(turn.latencyMarks) as [QaapTurnLatencyMark, number][]) {
            relative[mark] = Math.max(0, at - base);
        }
        return relative;
    }
}

export function formatQaapStreamMetricsLog(snapshot: QaapConversationStreamMetricsSnapshot): string {
    return [
        `[Qaap stream metrics/${snapshot.side}]`,
        `conv=${snapshot.conversationId}`,
        `transport=${snapshot.transport}`,
        `duration=${round2(snapshot.durationMs / 1000)}s`,
        `events=${snapshot.eventsTotal} (${snapshot.eventsPerSecond}/s)`,
        `bytes=${formatBytes(snapshot.bytesTotal)} (${formatBytes(snapshot.bytesPerEvent)}/event)`,
        `deltas=${snapshot.messageDeltaEvents}`,
        `compressedFields=${snapshot.compressedFields}`,
        `saved=${formatBytes(snapshot.compressionSavedBytes)}`,
        `latency=${formatLatencyMarks(snapshot.latencyMarks)}`,
    ].join(' ');
}

export function logQaapStreamMetrics(snapshot: QaapConversationStreamMetricsSnapshot | undefined): void {
    if (!snapshot) {
        return;
    }
    const line = formatQaapStreamMetricsLog(snapshot);
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info(line);
    }
}

export function countCompressedWireFields(payload: unknown): number {
    if (!payload || typeof payload !== 'object') {
        return 0;
    }
    let count = 0;
    visitWirePayload(payload, value => {
        if (isCompressionEncoding(value)) {
            count++;
        }
    });
    return count;
}

function visitWirePayload(value: unknown, onEncoding: (encoding: QaapAgentWireCompressionEncoding) => void): void {
    if (!value || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            visitWirePayload(entry, onEncoding);
        }
        return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (key.endsWith('Encoding') && isCompressionEncoding(entry)) {
            onEncoding(entry);
        }
        visitWirePayload(entry, onEncoding);
    }
}

function isCompressionEncoding(value: unknown): value is QaapAgentWireCompressionEncoding {
    return value === 'deflate-base64';
}

function estimateJsonBytes(payload: unknown): number {
    try {
        const json = JSON.stringify(payload);
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(json).length;
        }
        return json.length;
    } catch {
        return 0;
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
        return `${round2(bytes / 1024)}KB`;
    }
    return `${round2(bytes / (1024 * 1024))}MB`;
}

function formatLatencyMarks(marks: Partial<Record<QaapTurnLatencyMark, number>>): string {
    const keys = Object.keys(marks) as QaapTurnLatencyMark[];
    if (keys.length === 0) {
        return 'none';
    }
    return keys.map(key => `${key}:${marks[key]}ms`).join(',');
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

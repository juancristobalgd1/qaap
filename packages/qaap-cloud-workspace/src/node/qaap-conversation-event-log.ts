// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { randomUUID } from 'crypto';
import type { QaapAgentConversationEvent } from '../common/qaap-agent-conversation';

/** Ring bound: most recent events retained for replay. */
export const QAAP_CONVERSATION_EVENT_LOG_MAX_EVENTS = 4096;
/** Ring bound: serialized bytes retained for replay. */
export const QAAP_CONVERSATION_EVENT_LOG_MAX_BYTES = 8 * 1024 * 1024;

/** One sequenced, serialized conversation event. */
export interface QaapConversationLogEntry {
    readonly seq: number;
    readonly event: QaapAgentConversationEvent;
    /** Thread the event belongs to, when it is thread-scoped. */
    readonly conversationId: string | undefined;
    /** `JSON.stringify(event)` — reused for every subscriber so the payload is serialized once. */
    readonly json: string;
}

export interface QaapConversationEventLogOptions {
    readonly maxEvents?: number;
    readonly maxBytes?: number;
    readonly epoch?: string;
}

/** Thread id an event is scoped to. */
export function qaapConversationEventThreadId(event: QaapAgentConversationEvent): string | undefined {
    switch (event.type) {
        case 'created':
        case 'updated':
            return event.conversation.id;
        default:
            return event.conversationId;
    }
}

/** Frame text for an entry: the event JSON with its `seq` appended (protocol v2). */
export function qaapConversationEntryToFrame(entry: QaapConversationLogEntry): string {
    return `${entry.json.slice(0, -1)},"seq":${entry.seq}}`;
}

/**
 * In-memory, bounded, monotonically sequenced log of conversation events. `epoch` identifies this
 * backend boot so cursors from a previous process are never replayed against a restarted log.
 * Sequence numbers are contiguous, so a cursor is covered iff the next event is still retained.
 * Owner filtering is NOT applied here — callers filter at send time.
 */
export class QaapConversationEventLog {

    readonly epoch: string;
    protected readonly maxEvents: number;
    protected readonly maxBytes: number;
    protected entries: QaapConversationLogEntry[] = [];
    protected head = 0;
    protected bytes = 0;
    protected lastSeq = 0;

    constructor(options: QaapConversationEventLogOptions = {}) {
        this.epoch = options.epoch ?? randomUUID();
        this.maxEvents = Math.max(1, options.maxEvents ?? QAAP_CONVERSATION_EVENT_LOG_MAX_EVENTS);
        this.maxBytes = Math.max(1, options.maxBytes ?? QAAP_CONVERSATION_EVENT_LOG_MAX_BYTES);
    }

    /** Sequence number of the most recent event (0 before the first). */
    get seq(): number {
        return this.lastSeq;
    }

    get size(): number {
        return this.entries.length - this.head;
    }

    get byteSize(): number {
        return this.bytes;
    }

    /** Sequence number of the oldest retained event, or `seq + 1` when the ring is empty. */
    get firstSeq(): number {
        return this.head < this.entries.length ? this.entries[this.head].seq : this.lastSeq + 1;
    }

    /** Stamps the next sequence number on `event` and retains it (evicting the oldest as needed). */
    append(event: QaapAgentConversationEvent): QaapConversationLogEntry {
        const json = JSON.stringify(event);
        const entry: QaapConversationLogEntry = {
            seq: ++this.lastSeq,
            event,
            conversationId: qaapConversationEventThreadId(event),
            json,
        };
        this.entries.push(entry);
        this.bytes += json.length;
        while (this.head < this.entries.length && (this.size > this.maxEvents || this.bytes > this.maxBytes)) {
            this.bytes -= this.entries[this.head].json.length;
            this.head++;
        }
        if (this.head > 1024 && this.head * 2 >= this.entries.length) {
            this.entries = this.entries.slice(this.head);
            this.head = 0;
        }
        return entry;
    }

    /** True when every event after `lastSeq` is still retained (and `lastSeq` is not from the future). */
    covers(lastSeq: number): boolean {
        return Number.isInteger(lastSeq) && lastSeq >= 0 && lastSeq <= this.lastSeq && lastSeq >= this.firstSeq - 1;
    }

    /** Retained events with `seq > lastSeq`, oldest first; `undefined` when the ring no longer covers the gap. */
    since(lastSeq: number): QaapConversationLogEntry[] | undefined {
        if (!this.covers(lastSeq)) {
            return undefined;
        }
        return this.entries.slice(this.head + (lastSeq + 1 - this.firstSeq));
    }

    /** {@link since} guarded by the epoch of the cursor's origin. */
    resume(epoch: string | undefined, lastSeq: number): QaapConversationLogEntry[] | undefined {
        if (epoch !== this.epoch) {
            return undefined;
        }
        return this.since(lastSeq);
    }
}

/** Parses an SSE `Last-Event-ID` of the form `<epoch>:<seq>`. */
export function parseQaapConversationEventId(raw: string | undefined): { epoch: string; seq: number } | undefined {
    if (!raw) {
        return undefined;
    }
    const index = raw.lastIndexOf(':');
    if (index <= 0) {
        return undefined;
    }
    const seq = Number(raw.slice(index + 1));
    if (!Number.isInteger(seq) || seq < 0) {
        return undefined;
    }
    return { epoch: raw.slice(0, index), seq };
}

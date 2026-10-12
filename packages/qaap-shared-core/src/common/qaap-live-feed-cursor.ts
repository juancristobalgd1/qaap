// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Kill switch: set to `0` in `sessionStorage` or `localStorage` to fall back to live protocol v1. */
export const QAAP_LIVE_V2_FLAG_KEY = 'qaap.liveV2';
/** `sessionStorage` key holding the persisted `{epoch, lastSeq}` cursor. */
export const QAAP_LIVE_CURSOR_STORAGE_KEY = 'qaap.liveCursor';

/** Minimal `Storage` surface so the cursor stays testable without a DOM. */
export interface QaapLiveFeedStorage {
    getItem(key: string): string | null | undefined;
    setItem(key: string, value: string): void;
}

function readStorage(storage: QaapLiveFeedStorage | undefined, key: string): string | undefined {
    try {
        return storage?.getItem(key) ?? undefined;
    } catch {
        return undefined;
    }
}

/** Live protocol v2 is on unless `qaap.liveV2=0` is set in either storage (every access is guarded). */
export function isQaapLiveV2Enabled(
    session: QaapLiveFeedStorage | undefined,
    local: QaapLiveFeedStorage | undefined,
): boolean {
    return readStorage(session, QAAP_LIVE_V2_FLAG_KEY) !== '0' && readStorage(local, QAAP_LIVE_V2_FLAG_KEY) !== '0';
}

/** A server → client frame as the cursor sees it; payload fields beyond these are passed through untouched. */
export interface QaapLiveFeedFrame {
    readonly type: string;
    readonly seq?: number;
    readonly epoch?: string;
    readonly conversationId?: string;
    readonly id?: string;
    readonly groups?: ReadonlyArray<unknown>;
    readonly conversation?: { readonly id: string };
}

export interface QaapLiveFeedSink {
    /** Sends a client op; returns false when there is no open socket. */
    send(op: object): boolean;
    /** Applies a `resync` payload exactly like a snapshot. */
    applyResync(frame: QaapLiveFeedFrame): void;
    /** Applies a frame that survived dedupe (summary events, message events, liveness frames, v1 frames). */
    applyFrame(frame: QaapLiveFeedFrame): void;
    /**
     * GETs the thread document and caches it. Must report the document's cursor back through
     * {@link QaapLiveFeedCursor.noteDocument} (directly or via the document cache hook).
     */
    fetchThread(id: string): Promise<void>;
}

function isMessageFrame(frame: QaapLiveFeedFrame): boolean {
    return frame.type === 'message' || frame.type === 'message_delta';
}

/**
 * Client half of live protocol v2: the `{epoch, lastSeq}` resume cursor, per-thread applied
 * cursors, focus bookkeeping and frame dedupe. Frames with `seq <= lastSeq` are dropped; message
 * frames are deduped against the thread's own cursor because a focus replay legitimately carries
 * sequence numbers below the global cursor. I/O is delegated to the {@link QaapLiveFeedSink}.
 */
export class QaapLiveFeedCursor {

    epoch: string | undefined;
    lastSeq = 0;
    protected readonly threadSeq = new Map<string, number>();
    protected readonly focused = new Set<string>();
    /**
     * Threads being refetched (`thread_resync`, `resync`, or a document older than what was applied);
     * live message frames are buffered meanwhile so a fetch slower than the stream cannot livelock.
     */
    protected readonly refetching = new Map<string, { readonly token: number; readonly buffer: QaapLiveFeedFrame[] }>();
    protected refetchTokens = 0;
    /**
     * Focus requests the server has not acknowledged (`focused` marker) yet. Message frames for the
     * thread that arrive meanwhile belong to an earlier focus session and are dropped: accepting them
     * would move the thread cursor past events the new request is about to replay.
     */
    protected readonly pendingFocus = new Map<string, number>();

    constructor(
        protected readonly sink: QaapLiveFeedSink,
        protected readonly storage?: QaapLiveFeedStorage,
    ) { }

    /** Restores the persisted cursor; only valid when the in-memory summaries it describes are still present. */
    restore(): void {
        try {
            const raw = readStorage(this.storage, QAAP_LIVE_CURSOR_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) as { epoch?: unknown; lastSeq?: unknown } : undefined;
            if (parsed && typeof parsed.epoch === 'string' && typeof parsed.lastSeq === 'number') {
                this.epoch = parsed.epoch;
                this.lastSeq = parsed.lastSeq;
            }
        } catch {
            /* ignore corrupt cursor */
        }
    }

    /** First client frame of a (re)connection. */
    helloMessage(): { op: 'hello'; epoch: string | undefined; lastSeq: number | undefined; focus: string[] } {
        return {
            op: 'hello',
            epoch: this.epoch,
            lastSeq: this.epoch === undefined ? undefined : this.lastSeq,
            // Only threads that have seen everything up to the global cursor can be followed from `lastSeq`.
            // Threads still waiting for a document, or behind the cursor, ask for focus with their own
            // `sinceSeq` (see {@link onSocketOpen}); listing them here would deliver events after the hole first.
            focus: [...this.focused].filter(id => !this.refetching.has(id) && (this.threadSeq.get(id) ?? -1) >= this.lastSeq),
        };
    }

    /**
     * Call after the socket opened: sends `hello`, then re-asserts focus with each thread's own cursor
     * for threads that may have missed events (their cursor is behind the global one).
     */
    onSocketOpen(): void {
        this.pendingFocus.clear();
        this.sink.send(this.helloMessage());
        for (const id of this.focused) {
            const seq = this.threadSeq.get(id);
            if (seq !== undefined && seq < this.lastSeq && !this.refetching.has(id)) {
                this.sendFocus(id, seq, this.epoch);
            }
        }
    }

    protected sendFocus(id: string, sinceSeq: number | undefined, epoch: string | undefined): void {
        if (this.sink.send({ op: 'focus', id, sinceSeq, epoch })) {
            this.pendingFocus.set(id, (this.pendingFocus.get(id) ?? 0) + 1);
        }
    }

    isFocused(id: string): boolean {
        return this.focused.has(id);
    }

    /** The thread's document is now needed live (transcript opened). */
    focus(id: string): void {
        if (this.focused.has(id)) {
            return;
        }
        this.focused.add(id);
        const seq = this.threadSeq.get(id);
        if (seq !== undefined) {
            this.sendFocus(id, seq, this.epoch);
        } else {
            void this.sink.fetchThread(id).catch(() => undefined);
        }
    }

    unfocus(id: string): void {
        if (!this.focused.delete(id)) {
            return;
        }
        this.refetching.delete(id);
        this.sink.send({ op: 'unfocus', id });
    }

    /**
     * Reports the cursor of a thread document that was just cached: the document is current through
     * `seq`. Documents from another epoch are ignored. A focused thread whose document is OLDER than
     * what was already applied (a slow GET that lost a race with live frames) is refetched, with live
     * frames buffered meanwhile, rather than patched forward out of order. After a refetch (or the first
     * document) the thread asks the server to replay everything since the cut, so the cut itself never
     * has to line up with when focus took effect.
     */
    noteDocument(id: string, epoch: string | undefined, seq: number | undefined): void {
        if (epoch === undefined || seq === undefined || epoch !== this.epoch) {
            return;
        }
        const refetch = this.refetching.get(id);
        const previous = this.threadSeq.get(id);
        if (refetch) {
            this.refetching.delete(id);
            this.threadSeq.set(id, seq);
            for (const frame of refetch.buffer) {
                if (frame.seq !== undefined && frame.seq > (this.threadSeq.get(id) ?? seq)) {
                    this.threadSeq.set(id, frame.seq);
                    this.sink.applyFrame(frame);
                }
            }
            if (this.focused.has(id)) {
                this.sendFocus(id, seq, epoch);
            }
            return;
        }
        if (previous === seq) {
            return;
        }
        if (previous !== undefined && seq < previous && this.focused.has(id)) {
            this.beginRefetch(id);
            return;
        }
        this.threadSeq.set(id, seq);
        if (previous === undefined && this.focused.has(id)) {
            this.sendFocus(id, seq, epoch);
        }
    }

    /**
     * Entry point for every frame coming off the transport. `viaSse` marks the SSE feed, which (unlike
     * the WebSocket) carries message events for every thread rather than only the focused ones.
     */
    handleFrame(frame: QaapLiveFeedFrame, viaSse = false): void {
        switch (frame.type) {
            case 'resync':
                this.onResync(frame);
                return;
            case 'focused': {
                const pending = this.pendingFocus.get(frame.id ?? '') ?? 0;
                if (frame.id !== undefined) {
                    if (pending > 1) {
                        this.pendingFocus.set(frame.id, pending - 1);
                    } else {
                        this.pendingFocus.delete(frame.id);
                    }
                }
                return;
            }
            case 'thread_resync':
                if (frame.id !== undefined) {
                    this.beginRefetch(frame.id);
                }
                return;
            case 'heartbeat':
            case 'pong':
                if (this.epoch !== undefined && frame.seq !== undefined && frame.seq > this.lastSeq) {
                    this.advance(frame.seq);
                }
                this.sink.applyFrame(frame);
                return;
            default:
                break;
        }
        const seq = frame.seq;
        if (seq === undefined) {
            this.sink.applyFrame(frame); // v1 frame
            return;
        }
        if (isMessageFrame(frame)) {
            this.onMessageFrame(frame, seq, viaSse);
            return;
        }
        if (seq <= this.lastSeq) {
            return;
        }
        this.advance(seq);
        if (frame.type === 'deleted' && frame.conversationId) {
            this.threadSeq.delete(frame.conversationId);
        }
        this.sink.applyFrame(frame);
    }

    /** SSE variant: data carries no `seq`; the `id:` line (`<epoch>:<seq>`) does. */
    handleSseFrame(frame: QaapLiveFeedFrame, lastEventId: string | undefined): void {
        const separator = lastEventId ? lastEventId.lastIndexOf(':') : -1;
        const seq = separator > 0 ? Number(lastEventId!.slice(separator + 1)) : undefined;
        const epoch = separator > 0 ? lastEventId!.slice(0, separator) : undefined;
        if (frame.type === 'resync') {
            this.handleFrame(frame);
            // SSE has no `thread_resync`: documents cut before the resync are stale, refetch the followed ones.
            for (const id of this.focused) {
                this.beginRefetch(id);
            }
            return;
        }
        if (epoch !== undefined && this.epoch !== undefined && epoch !== this.epoch) {
            // Backend restarted behind our back: nothing we hold is comparable any more.
            this.epoch = undefined;
            this.lastSeq = 0;
            this.threadSeq.clear();
        }
        if (this.epoch === undefined && epoch !== undefined) {
            this.epoch = epoch;
            this.lastSeq = 0;
        }
        this.handleFrame(seq !== undefined && Number.isInteger(seq) ? { ...frame, seq } : frame, true);
    }

    /** Query suffix for the SSE URL so a reconnect resumes instead of starting cold. */
    sseResumeQuery(): string {
        return this.epoch === undefined ? '' : `?lastEventId=${encodeURIComponent(`${this.epoch}:${this.lastSeq}`)}`;
    }

    protected onMessageFrame(frame: QaapLiveFeedFrame, seq: number, viaSse: boolean): void {
        const id = frame.conversationId;
        if (id === undefined) {
            return;
        }
        if (!this.focused.has(id)) {
            // A thread's cursor may only move through frames it was following. WebSocket leftovers that were
            // in flight when the thread was unfocused are dropped; SSE frames for unfocused threads keep the
            // legacy behaviour (patch the cached document) but go unstamped and leave the cursor alone.
            const fresh = viaSse && seq > this.lastSeq;
            if (seq > this.lastSeq) {
                this.advance(seq);
            }
            if (fresh) {
                this.sink.applyFrame({ ...frame, seq: undefined });
            }
            return;
        }
        if (!viaSse && this.pendingFocus.has(id)) {
            if (seq > this.lastSeq) {
                this.advance(seq);
            }
            return;
        }
        const refetch = this.refetching.get(id);
        if (refetch) {
            refetch.buffer.push({ ...frame, seq });
            if (seq > this.lastSeq) {
                this.advance(seq);
            }
            return;
        }
        const threadSeq = this.threadSeq.get(id);
        const fresh = threadSeq === undefined ? seq > this.lastSeq : seq > threadSeq;
        if (fresh) {
            this.threadSeq.set(id, seq);
            this.sink.applyFrame(frame);
        }
        if (seq > this.lastSeq) {
            this.advance(seq);
        }
    }

    protected onResync(frame: QaapLiveFeedFrame): void {
        this.epoch = frame.epoch;
        this.lastSeq = frame.seq ?? 0;
        // Documents were cut against the old cursor; focused threads get a `thread_resync` (WS) or a refetch (SSE).
        this.threadSeq.clear();
        this.refetching.clear();
        this.persist();
        this.sink.applyResync(frame);
        for (const id of this.focused) {
            this.beginRefetch(id);
        }
    }

    protected beginRefetch(id: string): void {
        if (!this.focused.has(id) || this.refetching.has(id)) {
            return;
        }
        const token = ++this.refetchTokens;
        this.refetching.set(id, { token, buffer: [] });
        this.threadSeq.delete(id);
        void this.sink.fetchThread(id).catch(() => undefined).finally(() => {
            // Fetch failed or never reported a usable cursor: do not leave the thread buffering forever.
            if (this.refetching.get(id)?.token === token) {
                this.refetching.delete(id);
            }
        });
    }

    protected advance(seq: number): void {
        this.lastSeq = Math.max(this.lastSeq, seq);
        this.persist();
    }

    protected persist(): void {
        if (this.epoch === undefined) {
            return;
        }
        try {
            this.storage?.setItem(QAAP_LIVE_CURSOR_STORAGE_KEY, JSON.stringify({ epoch: this.epoch, lastSeq: this.lastSeq }));
        } catch {
            /* storage unavailable */
        }
    }
}

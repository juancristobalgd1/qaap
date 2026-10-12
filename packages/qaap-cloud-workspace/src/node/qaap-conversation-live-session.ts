// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationCwdGroup } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationWsClientMessage } from '../common/qaap-agent-conversation-ws';
import {
    qaapConversationEntryToFrame,
    type QaapConversationEventLog,
    type QaapConversationLogEntry,
} from './qaap-conversation-event-log';

/** Environment a live v2 session runs against; every dependency is injected so the protocol is unit-testable. */
export interface QaapConversationLiveSessionDeps {
    readonly log: QaapConversationEventLog;
    /** Owner filter, applied at send time (never when logging). */
    readonly isOwned: (entry: QaapConversationLogEntry) => boolean;
    /** Emits the batcher's pending events so the log, the store state and `log.seq` agree. */
    readonly flush: () => void;
    /** Owner-filtered snapshot of all summaries, taken in the same tick as the cut. */
    readonly buildGroups: () => readonly QaapAgentConversationCwdGroup[];
    readonly send: (frame: string) => void;
}

/**
 * Per-connection state of live protocol v2: resume cursor handling, resync, and focus-gated
 * `message` / `message_delta` delivery. Every outgoing frame carries `seq`.
 */
export class QaapConversationLiveSession {

    protected readonly focused = new Set<string>();
    protected started = false;

    constructor(protected readonly deps: QaapConversationLiveSessionDeps) { }

    get isStarted(): boolean {
        return this.started;
    }

    get focusedIds(): ReadonlySet<string> {
        return this.focused;
    }

    /** Dispatches one parsed client frame (`cancel` is handled by the caller). */
    handle(message: QaapAgentConversationWsClientMessage): void {
        switch (message.op) {
            case 'hello':
                this.hello(message.epoch, message.lastSeq, message.focus);
                return;
            case 'focus':
                this.focus(message.id, message.sinceSeq, message.epoch);
                return;
            case 'unfocus':
                this.focused.delete(message.id);
                return;
            case 'ping':
                this.deps.send(JSON.stringify({ type: 'pong', seq: this.deps.log.seq }));
                return;
            default:
                return;
        }
    }

    /**
     * Replays everything the client missed when its `{epoch, lastSeq}` cursor is still covered
     * (followed by a `resumed` frame so the client knows the hello was answered); otherwise sends a `resync` (the `snapshot` payload plus the cursor) and a `thread_resync` for
     * each thread the client believed it was following. Live delivery starts in the same tick.
     */
    hello(epoch: string | undefined, lastSeq: number | undefined, focus: readonly string[]): void {
        if (this.started) {
            return;
        }
        const { log } = this.deps;
        this.deps.flush();
        for (const id of focus) {
            this.focused.add(id);
        }
        const replay = lastSeq === undefined ? undefined : log.resume(epoch, lastSeq);
        if (replay) {
            for (const entry of replay) {
                this.deliver(entry);
            }
            this.deps.send(JSON.stringify({ type: 'resumed', epoch: log.epoch, seq: log.seq }));
        } else {
            this.deps.send(JSON.stringify({ type: 'resync', epoch: log.epoch, seq: log.seq, groups: this.deps.buildGroups() }));
            for (const id of this.focused) {
                this.deps.send(JSON.stringify({ type: 'thread_resync', id, seq: log.seq }));
            }
        }
        this.started = true;
    }

    focus(id: string, sinceSeq: number | undefined, epoch: string | undefined): void {
        const { log } = this.deps;
        this.focused.add(id);
        // Marker first: message frames for this thread that were already in flight (from an earlier focus
        // session) precede it on the wire, everything after it belongs to this focus request.
        this.deps.send(JSON.stringify({ type: 'focused', id, seq: log.seq }));
        if (sinceSeq === undefined) {
            return;
        }
        // No flush: events still in the batcher are not in the log yet and reach this (now focused)
        // session live, after the replay below, so nothing is delivered twice or missed.
        const replay = log.resume(epoch, sinceSeq);
        if (!replay) {
            this.deps.send(JSON.stringify({ type: 'thread_resync', id, seq: log.seq }));
            return;
        }
        for (const entry of replay) {
            if (entry.conversationId === id && (entry.event.type === 'message' || entry.event.type === 'message_delta')) {
                this.deliverIfOwned(entry);
            }
        }
    }

    /** Live subscription callback. */
    onEntry(entry: QaapConversationLogEntry): void {
        if (this.started) {
            this.deliver(entry);
        }
    }

    heartbeat(): void {
        // Before `hello` is answered a seq-bearing heartbeat would move the client's cursor too early.
        if (!this.started) {
            return;
        }
        this.deps.send(JSON.stringify({ type: 'heartbeat', seq: this.deps.log.seq }));
    }

    protected deliver(entry: QaapConversationLogEntry): void {
        const { event } = entry;
        if ((event.type === 'message' || event.type === 'message_delta') && !this.focused.has(event.conversationId)) {
            return;
        }
        this.deliverIfOwned(entry);
    }

    protected deliverIfOwned(entry: QaapConversationLogEntry): void {
        if (this.deps.isOwned(entry)) {
            this.deps.send(qaapConversationEntryToFrame(entry));
        }
    }
}

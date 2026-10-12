// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapThreadStore } from '@theia/qaap-shared-core/lib/common/qaap-thread-store';
import { QaapLiveFeedCursor, type QaapLiveFeedFrame } from '@theia/qaap-shared-core/lib/common/qaap-live-feed-cursor';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { parseQaapAgentConversationWsClientMessage } from '../common/qaap-agent-conversation-ws';
import type { QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import { QaapConversationEventLog, type QaapConversationLogEntry } from './qaap-conversation-event-log';
import { QaapConversationLiveSession } from './qaap-conversation-live-session';

/** mulberry32: tiny seeded PRNG so failures reproduce from the seed alone. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface ServerMessage { id: string; role: 'agent'; content: string; createdAt: number }
interface ServerThread { id: string; cwd: string; rev: number; messages: ServerMessage[] }

const OWN = '/w/alice';
const OTHER = '/w/bob';

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/**
 * One simulated universe: a server (event log + live sessions), a lossy in-order WebSocket, an HTTP
 * channel for `GET /:id` (cut taken when the server processes the request, answered later) and a client
 * built from the real {@link QaapLiveFeedCursor} and {@link QaapThreadStore}.
 */
class World {

    log: QaapConversationEventLog;
    readonly threads = new Map<string, ServerThread>();
    session: QaapConversationLiveSession | undefined;
    connected = false;
    up: string[] = [];
    down: string[] = [];
    getRequests: Array<{ id: string; resolve(): void; reject(error: Error): void }> = [];
    getResponses: Array<{ id: string; doc: QaapAgentConversationDTO | undefined; resolve(): void; reject(error: Error): void }> = [];
    readonly store = new QaapThreadStore();
    readonly cursor: QaapLiveFeedCursor;
    readonly clientFocus = new Set<string>();
    protected nextThread = 0;
    protected nextMessage = 0;
    protected boot = 0;
    readonly trace: string[] = [];

    constructor(readonly rand: () => number, protected readonly ringEvents: number) {
        this.log = new QaapConversationEventLog({ epoch: 'boot-0', maxEvents: ringEvents });
        this.cursor = new QaapLiveFeedCursor({
            send: op => {
                if (!this.connected) {
                    return false;
                }
                this.up.push(JSON.stringify(op));
                return true;
            },
            applyResync: frame => {
                const groups = (frame.groups ?? []) as Array<{ cwd: string; conversations: QaapAgentConversationSummaryDTO[] }>;
                this.store.applySummarySnapshot(groups);
            },
            applyFrame: frame => this.applyClientFrame(frame),
            fetchThread: id => new Promise<void>((resolve, reject) => { this.getRequests.push({ id, resolve, reject }); }),
        });
    }

    int(max: number): number {
        return Math.floor(this.rand() * max);
    }

    pick<T>(items: readonly T[]): T | undefined {
        return items.length ? items[this.int(items.length)] : undefined;
    }

    // ── server ──────────────────────────────────────────────────────────────

    protected summaryOf(thread: ServerThread): QaapAgentConversationSummaryDTO {
        return { id: thread.id, cwd: thread.cwd, title: `title-${thread.id}-${thread.rev}`, status: 'idle', updatedAt: thread.rev } as unknown as QaapAgentConversationSummaryDTO;
    }

    protected emit(event: QaapAgentConversationEvent): void {
        const entry: QaapConversationLogEntry = this.log.append(event);
        this.trace.push(`S emit #${entry.seq} ${event.type} ${entry.conversationId}${this.connected ? '' : ' (offline)'}`);
        this.session?.onEntry(entry);
    }

    mutate(): void {
        const live = [...this.threads.values()];
        const roll = this.rand();
        const thread = this.pick(live);
        if (!thread || roll < 0.12) {
            const id = `t${this.nextThread++}`;
            const created: ServerThread = { id, cwd: this.rand() < 0.2 ? OTHER : OWN, rev: 1, messages: [] };
            this.threads.set(id, created);
            this.emit({ type: 'created', conversation: this.summaryOf(created) as never });
        } else if (roll < 0.22) {
            thread.rev++;
            this.emit({ type: 'updated', conversation: this.summaryOf(thread) as never });
        } else if (roll < 0.52 || thread.messages.length === 0) {
            const message: ServerMessage = { id: `m${this.nextMessage++}`, role: 'agent', content: 'a', createdAt: this.nextMessage };
            thread.messages.push(message);
            this.emit({ type: 'message', conversationId: thread.id, cwd: thread.cwd, message: { ...message } as never });
        } else if (roll < 0.9) {
            const target = thread.messages[thread.messages.length - 1];
            const text = String.fromCharCode(98 + this.int(24));
            target.content += text;
            this.emit({
                type: 'message_delta', conversationId: thread.id, cwd: thread.cwd, messageId: target.id,
                delta: { kind: 'append_content', messageId: target.id, text },
            } as never);
        } else {
            this.threads.delete(thread.id);
            this.emit({ type: 'deleted', conversationId: thread.id, cwd: thread.cwd });
        }
    }

    deliverUp(count: number): void {
        for (let i = 0; i < count && this.up.length; i++) {
            const raw = this.up.shift()!;
            this.trace.push(`S recv ${raw}`);
            const parsed = parseQaapAgentConversationWsClientMessage(JSON.parse(raw));
            if (parsed && this.session) {
                this.session.handle(parsed);
            }
        }
    }

    processGet(): void {
        const request = this.getRequests.shift();
        if (!request) {
            return;
        }
        const thread = this.threads.get(request.id);
        const doc = thread ? {
            id: thread.id, cwd: thread.cwd, messages: thread.messages.map(m => ({ ...m })), updatedAt: 0,
            epoch: this.log.epoch, seq: this.log.seq,
        } as unknown as QaapAgentConversationDTO : undefined;
        this.trace.push(`S get ${request.id} -> seq ${this.log.seq}`);
        this.getResponses.push({ ...request, doc });
    }

    deliverGetResponse(): void {
        const response = this.getResponses.shift();
        if (!response) {
            return;
        }
        if (!response.doc) {
            response.reject(new Error('404'));
            return;
        }
        this.trace.push(`C doc ${response.id} seq=${response.doc.seq}`);
        // Mirrors cacheDocumentExtracted: store the document, then report its cursor.
        this.store.setDocument(response.doc);
        this.cursor.noteDocument(response.doc.id, response.doc.epoch, response.doc.seq);
        response.resolve();
    }

    restart(): void {
        this.boot++;
        this.trace.push('X restart');
        this.log = new QaapConversationEventLog({ epoch: `boot-${this.boot}`, maxEvents: this.ringEvents });
        this.disconnect();
        for (const request of this.getRequests.splice(0)) {
            request.reject(new Error('connection reset'));
        }
        for (const response of this.getResponses.splice(0)) {
            response.reject(new Error('connection reset'));
        }
    }

    // ── transport ───────────────────────────────────────────────────────────

    disconnect(): void {
        this.trace.push('X disconnect');
        this.connected = false;
        this.session = undefined;
        this.up = [];
        this.down = [];
    }

    connect(): void {
        if (this.connected) {
            return;
        }
        this.trace.push('X connect');
        this.connected = true;
        this.session = new QaapConversationLiveSession({
            log: this.log,
            isOwned: entry => {
                const e = entry.event;
                const cwd = e.type === 'created' || e.type === 'updated' ? e.conversation.cwd : (e as { cwd: string }).cwd;
                return cwd.startsWith(OWN);
            },
            flush: () => undefined,
            buildGroups: () => {
                const own = [...this.threads.values()].filter(t => t.cwd === OWN).map(t => this.summaryOf(t));
                return own.length ? [{ cwd: OWN, conversations: own }] as never : [];
            },
            send: frame => { this.down.push(frame); },
        });
        this.cursor.onSocketOpen();
    }

    deliverDown(count: number): void {
        for (let i = 0; i < count && this.down.length; i++) {
            const frame = JSON.parse(this.down.shift()!) as QaapLiveFeedFrame;
            this.trace.push(`C frame ${frame.type} seq=${frame.seq} ${frame.conversationId ?? frame.id ?? ''}`);
            this.cursor.handleFrame(frame);
        }
    }

    // ── client ──────────────────────────────────────────────────────────────

    protected applyClientFrame(frame: QaapLiveFeedFrame): void {
        const event = frame as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        switch (frame.type) {
            case 'created':
            case 'updated':
                this.store.upsertSummary(event.conversation);
                return;
            case 'deleted':
                this.store.removeSummary(event.conversationId, event.cwd);
                return;
            case 'message':
                this.store.appendLiveMessage(event.conversationId, event.message, event.seq);
                return;
            case 'message_delta':
                this.store.applyWireDelta(event.conversationId, event.messageId, event.delta, event.seq);
                return;
            default:
                return;
        }
    }

    toggleFocus(): void {
        const ids = [...this.threads.values()].filter(t => t.cwd === OWN).map(t => t.id);
        const id = this.pick(ids);
        if (!id) {
            return;
        }
        this.trace.push(`C toggle focus ${id}`);
        if (this.clientFocus.has(id)) {
            this.clientFocus.delete(id);
            this.cursor.unfocus(id);
        } else {
            this.clientFocus.add(id);
            this.cursor.focus(id);
        }
    }

    // ── driving ─────────────────────────────────────────────────────────────

    async step(): Promise<void> {
        const roll = this.rand();
        if (roll < 0.34) {
            this.mutate();
        } else if (roll < 0.52) {
            this.deliverDown(1 + this.int(3));
        } else if (roll < 0.62) {
            this.deliverUp(1 + this.int(2));
        } else if (roll < 0.67) {
            this.processGet();
        } else if (roll < 0.72) {
            this.deliverGetResponse();
        } else if (roll < 0.82) {
            this.toggleFocus();
        } else if (roll < 0.9) {
            this.connected ? this.disconnect() : this.connect();
        } else if (roll < 0.91) {
            this.restart();
        } else if (!this.connected) {
            this.connect();
        }
        await tick();
    }

    async quiesce(): Promise<void> {
        this.connect();
        for (let round = 0; round < 500; round++) {
            const busy = this.up.length + this.down.length + this.getRequests.length + this.getResponses.length;
            if (!busy) {
                await tick();
                if (!(this.up.length + this.down.length + this.getRequests.length + this.getResponses.length)) {
                    return;
                }
                continue;
            }
            this.deliverUp(this.up.length);
            while (this.getRequests.length) {
                this.processGet();
            }
            while (this.getResponses.length) {
                this.deliverGetResponse();
            }
            this.deliverDown(this.down.length);
            await tick();
        }
        throw new Error('live feed did not quiesce');
    }

    assertConverged(): void {
        const server = [...this.threads.values()].filter(t => t.cwd === OWN);
        const expectedSummaries = server.map(t => this.summaryOf(t)).map(({ id, cwd, title, updatedAt }) => ({ id, cwd, title, updatedAt }))
            .sort((a, b) => a.id.localeCompare(b.id));
        const actualSummaries = this.store.listAllSummaries().map(({ id, cwd, title, updatedAt }) => ({ id, cwd, title, updatedAt }))
            .sort((a, b) => a.id.localeCompare(b.id));
        expect(actualSummaries, 'summaries').to.deep.equal(expectedSummaries);
        for (const thread of server) {
            if (!this.clientFocus.has(thread.id)) {
                continue;
            }
            const doc = this.store.getDocument(thread.id);
            expect(doc, `focused doc ${thread.id}`).to.not.equal(undefined);
            const messages = doc!.messages.map(m => ({ id: m.id, content: m.content }));
            expect(new Set(messages.map(m => m.id)).size, `duplicate message ids in ${thread.id}`).to.equal(messages.length);
            expect(messages, `doc ${thread.id}`).to.deep.equal(thread.messages.map(m => ({ id: m.id, content: m.content })));
        }
    }
}

describe('live feed v2 reconnect / gap property', function (): void {
    this.timeout(60_000);

    const SEEDS = 400;
    const STEPS = 200;

    for (let seed = 1; seed <= SEEDS; seed++) {
        it(`converges to server state (seed ${seed})`, async () => {
            const rand = prng(seed * 7919);
            const ring = 2 + Math.floor(rand() * 30);
            const world = new World(rand, ring);
            world.connect();
            for (let i = 0; i < STEPS; i++) {
                await world.step();
            }
            await world.quiesce();
            try {
                world.assertConverged();
            } catch (error) {
                throw new Error(`seed ${seed} ring ${ring}: ${(error as Error).message}${process.env.QAAP_LIVE_TRACE ? `\n${world.trace.join('\n')}` : ''}`);
            }
        });
    }
});

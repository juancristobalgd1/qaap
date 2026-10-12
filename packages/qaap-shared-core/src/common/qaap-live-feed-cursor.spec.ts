// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_LIVE_CURSOR_STORAGE_KEY,
    QAAP_LIVE_V2_FLAG_KEY,
    QaapLiveFeedCursor,
    isQaapLiveV2Enabled,
    type QaapLiveFeedFrame,
    type QaapLiveFeedSink,
} from './qaap-live-feed-cursor';

function memoryStorage(initial: Record<string, string> = {}): { map: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } {
    const map = new Map(Object.entries(initial));
    return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

function harness(storage = memoryStorage()): {
    cursor: QaapLiveFeedCursor;
    applied: QaapLiveFeedFrame[];
    resyncs: QaapLiveFeedFrame[];
    sent: Array<Record<string, unknown>>;
    fetches: string[];
    storage: ReturnType<typeof memoryStorage>;
    open: { value: boolean };
} {
    const applied: QaapLiveFeedFrame[] = [];
    const resyncs: QaapLiveFeedFrame[] = [];
    const sent: Array<Record<string, unknown>> = [];
    const fetches: string[] = [];
    const open = { value: true };
    const sink: QaapLiveFeedSink = {
        send: op => { if (open.value) { sent.push(op as Record<string, unknown>); } return open.value; },
        applyResync: frame => { resyncs.push(frame); },
        applyFrame: frame => { applied.push(frame); },
        fetchThread: id => { fetches.push(id); return new Promise<void>(() => undefined); },
    };
    return { cursor: new QaapLiveFeedCursor(sink, storage), applied, resyncs, sent, fetches, storage, open };
}

const message = (id: string, seq: number | undefined): QaapLiveFeedFrame => ({ type: 'message', conversationId: id, seq });
const updated = (id: string, seq: number | undefined): QaapLiveFeedFrame => ({ type: 'updated', conversation: { id }, seq });

describe('isQaapLiveV2Enabled', () => {
    it('is on by default and off when either storage says qaap.liveV2=0', () => {
        expect(isQaapLiveV2Enabled(undefined, undefined)).to.equal(true);
        expect(isQaapLiveV2Enabled(memoryStorage(), memoryStorage())).to.equal(true);
        expect(isQaapLiveV2Enabled(memoryStorage({ [QAAP_LIVE_V2_FLAG_KEY]: '0' }), memoryStorage())).to.equal(false);
        expect(isQaapLiveV2Enabled(memoryStorage(), memoryStorage({ [QAAP_LIVE_V2_FLAG_KEY]: '0' }))).to.equal(false);
        expect(isQaapLiveV2Enabled(memoryStorage({ [QAAP_LIVE_V2_FLAG_KEY]: '1' }), undefined)).to.equal(true);
    });

    it('survives storage that throws', () => {
        const throwing = { getItem: (): string => { throw new Error('SecurityError'); }, setItem: (): void => { throw new Error('SecurityError'); } };
        expect(isQaapLiveV2Enabled(throwing, throwing)).to.equal(true);
        const h = harness(throwing as never);
        expect(() => h.cursor.handleFrame({ type: 'resync', epoch: 'e', seq: 3, groups: [] })).to.not.throw();
        h.cursor.restore();
        expect(h.cursor.epoch).to.equal('e');
    });
});

describe('QaapLiveFeedCursor', () => {

    it('says hello with no cursor first, then with {epoch, lastSeq} and the followed threads', () => {
        const h = harness();
        expect(h.cursor.helloMessage()).to.deep.equal({ op: 'hello', epoch: undefined, lastSeq: undefined, focus: [] });
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.noteDocument('t1', 'e1', 4); // not focused: just remembered
        expect(h.cursor.helloMessage()).to.deep.equal({ op: 'hello', epoch: 'e1', lastSeq: 10, focus: [] });
    });

    it('applies a resync like a snapshot and persists the cursor in sessionStorage', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [{}] });
        expect(h.resyncs).to.have.length(1);
        expect(JSON.parse(h.storage.map.get(QAAP_LIVE_CURSOR_STORAGE_KEY)!)).to.deep.equal({ epoch: 'e1', lastSeq: 10 });
        const restored = harness(h.storage);
        restored.cursor.restore();
        expect(restored.cursor.epoch).to.equal('e1');
        expect(restored.cursor.lastSeq).to.equal(10);
    });

    it('drops frames with seq <= lastSeq and advances on newer ones', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.handleFrame(updated('a', 10));
        h.cursor.handleFrame(updated('a', 9));
        h.cursor.handleFrame(updated('a', 11));
        h.cursor.handleFrame(updated('a', 11));
        expect(h.applied.map(f => f.seq)).to.deep.equal([11]);
        expect(h.cursor.lastSeq).to.equal(11);
    });

    it('passes v1 frames (no seq) straight through', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'snapshot', groups: [] });
        h.cursor.handleFrame(updated('a', undefined));
        expect(h.applied.map(f => f.type)).to.deep.equal(['snapshot', 'updated']);
    });

    it('advances the cursor on heartbeat / pong seq but only after an epoch is known', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'heartbeat', seq: 50 });
        expect(h.cursor.lastSeq).to.equal(0);
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.handleFrame({ type: 'pong', seq: 12 });
        expect(h.cursor.lastSeq).to.equal(12);
    });

    it('focuses with its own cursor: fetches the document, then asks for the replay since the cut', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.focus('t1');
        expect(h.fetches).to.deep.equal(['t1']);
        h.cursor.noteDocument('t1', 'e1', 8);
        expect(h.sent.at(-1)).to.deep.equal({ op: 'focus', id: 't1', sinceSeq: 8, epoch: 'e1' });
        h.cursor.unfocus('t1');
        expect(h.sent.at(-1)).to.deep.equal({ op: 'unfocus', id: 't1' });
        h.cursor.focus('t1'); // cursor kept: no refetch, replay from the thread's own seq
        expect(h.fetches).to.have.length(1);
        expect(h.sent.at(-1)).to.deep.equal({ op: 'focus', id: 't1', sinceSeq: 8, epoch: 'e1' });
    });

    it('ignores message frames until the server acknowledged the focus request', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.focus('t1');
        h.cursor.noteDocument('t1', 'e1', 10);
        h.cursor.handleFrame(message('t1', 11)); // leftover of an earlier focus session
        h.cursor.handleFrame({ type: 'focused', id: 't1', seq: 12 });
        h.cursor.handleFrame(message('t1', 13));
        h.cursor.handleFrame(message('t1', 13));
        expect(h.applied.map(f => f.seq)).to.deep.equal([13]);
    });

    it('drops message frames of unfocused threads on the WebSocket but not on SSE', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.handleFrame(message('t1', 11));
        expect(h.applied).to.have.length(0);
        h.cursor.handleSseFrame(message('t1', undefined), 'e1:12');
        expect(h.applied).to.have.length(1);
        expect(h.applied[0].seq).to.equal(undefined); // unstamped: it must not move any thread cursor
    });

    it('thread_resync refetches, buffers live frames and drops those at or below the document cut', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.focus('t1');
        h.cursor.noteDocument('t1', 'e1', 10);
        h.cursor.handleFrame({ type: 'focused', id: 't1', seq: 10 });
        h.cursor.handleFrame({ type: 'thread_resync', id: 't1', seq: 20 });
        expect(h.fetches).to.deep.equal(['t1', 't1']);
        for (const seq of [21, 22, 23, 24]) {
            h.cursor.handleFrame(message('t1', seq));
        }
        expect(h.applied).to.have.length(0); // buffered
        h.cursor.noteDocument('t1', 'e1', 22);
        expect(h.applied.map(f => f.seq)).to.deep.equal([23, 24]);
        h.cursor.handleFrame({ type: 'focused', id: 't1', seq: 24 }); // answer to the replay request sent with the cut
        h.cursor.handleFrame(message('t1', 24)); // duplicate (replay overlaps the buffer)
        h.cursor.handleFrame(message('t1', 25));
        expect(h.applied.map(f => f.seq)).to.deep.equal([23, 24, 25]);
    });

    it('a resync refetches every followed thread and forgets cursors from the previous cut', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.focus('t1');
        h.cursor.noteDocument('t1', 'e1', 10);
        h.cursor.handleFrame({ type: 'resync', epoch: 'e2', seq: 3, groups: [] });
        expect(h.cursor.epoch).to.equal('e2');
        expect(h.cursor.lastSeq).to.equal(3);
        expect(h.fetches).to.deep.equal(['t1', 't1']);
    });

    it('ignores a document from another epoch', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e2', seq: 3, groups: [] });
        h.cursor.focus('t1');
        h.cursor.noteDocument('t1', 'e1', 90);
        expect(h.sent.filter(op => op.op === 'focus')).to.deep.equal([]);
    });

    it('builds the SSE resume query and adopts / resets the epoch from id lines', () => {
        const h = harness();
        expect(h.cursor.sseResumeQuery()).to.equal('');
        h.cursor.handleSseFrame(updated('a', undefined), 'e1:5');
        expect(h.cursor.epoch).to.equal('e1');
        expect(h.applied.map(f => f.seq)).to.deep.equal([5]);
        expect(h.cursor.sseResumeQuery()).to.equal('?lastEventId=e1%3A5');
        h.cursor.handleSseFrame(updated('a', undefined), 'e1:5'); // replayed duplicate
        expect(h.applied).to.have.length(1);
        h.cursor.handleSseFrame(updated('a', undefined), 'e2:1'); // backend restarted behind our back
        expect(h.cursor.epoch).to.equal('e2');
        expect(h.applied.map(f => f.seq)).to.deep.equal([5, 1]);
        h.cursor.handleSseFrame({ type: 'resync', epoch: 'e3', seq: 7, groups: [] }, 'e3:7');
        expect(h.cursor.epoch).to.equal('e3');
        expect(h.resyncs).to.have.length(1);
    });

    it('SSE frames from a backend without id lines behave as v1 frames', () => {
        const h = harness();
        h.cursor.handleSseFrame(updated('a', undefined), '');
        expect(h.applied).to.have.length(1);
        expect(h.cursor.epoch).to.equal(undefined);
    });

    it('on socket open sends hello then re-asserts focus for threads behind the global cursor', () => {
        const h = harness();
        h.cursor.handleFrame({ type: 'resync', epoch: 'e1', seq: 10, groups: [] });
        h.cursor.focus('t1');
        h.cursor.noteDocument('t1', 'e1', 4);
        h.cursor.focus('t2');
        h.cursor.noteDocument('t2', 'e1', 10);
        h.sent.length = 0;
        h.cursor.onSocketOpen();
        expect(h.sent).to.deep.equal([
            { op: 'hello', epoch: 'e1', lastSeq: 10, focus: ['t2'] },
            { op: 'focus', id: 't1', sinceSeq: 4, epoch: 'e1' },
        ]);
    });
});

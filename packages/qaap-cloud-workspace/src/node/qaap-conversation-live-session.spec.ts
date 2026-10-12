// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationEvent, QaapAgentConversationSummary } from '../common/qaap-agent-conversation';
import { QaapConversationEventLog } from './qaap-conversation-event-log';
import { QaapConversationLiveSession } from './qaap-conversation-live-session';

const summary = (id: string, cwd = '/w/alice'): QaapAgentConversationSummary => ({ id, cwd } as unknown as QaapAgentConversationSummary);
const message = (id: string, messageId: string, cwd = '/w/alice'): QaapAgentConversationEvent => ({
    type: 'message', conversationId: id, cwd, message: { id: messageId, role: 'agent', content: 'x', createdAt: 1 },
} as QaapAgentConversationEvent);
const updated = (id: string, cwd = '/w/alice'): QaapAgentConversationEvent => ({ type: 'updated', conversation: summary(id, cwd) });

function harness(options: { maxEvents?: number } = {}): {
    log: QaapConversationEventLog;
    session: QaapConversationLiveSession;
    frames: Array<Record<string, unknown>>;
    flushes: { count: number };
    emit(event: QaapAgentConversationEvent): void;
} {
    const log = new QaapConversationEventLog({ maxEvents: options.maxEvents });
    const frames: Array<Record<string, unknown>> = [];
    const flushes = { count: 0 };
    const session = new QaapConversationLiveSession({
        log,
        isOwned: entry => {
            const e = entry.event;
            const cwd = e.type === 'created' || e.type === 'updated' ? e.conversation.cwd : (e as { cwd: string }).cwd;
            return cwd.startsWith('/w/alice');
        },
        flush: () => { flushes.count++; },
        buildGroups: () => [{ cwd: '/w/alice', conversations: [] }] as never,
        send: frame => { frames.push(JSON.parse(frame)); },
    });
    return { log, session, frames, flushes, emit: event => session.onEntry(log.append(event)) };
}

describe('QaapConversationLiveSession (protocol v2)', () => {

    it('sends nothing before hello and a resync (snapshot + cursor) for a cold client', () => {
        const h = harness();
        h.emit(updated('a'));
        expect(h.frames).to.deep.equal([]);
        h.session.hello(undefined, undefined, []);
        expect(h.flushes.count).to.equal(1);
        expect(h.frames).to.deep.equal([{ type: 'resync', epoch: h.log.epoch, seq: 1, groups: [{ cwd: '/w/alice', conversations: [] }] }]);
    });

    it('replays owned events after lastSeq when the epoch matches and the ring covers them', () => {
        const h = harness();
        h.log.append(updated('a'));
        h.log.append(updated('b', '/w/bob'));
        h.log.append(updated('c'));
        h.session.hello(h.log.epoch, 1, []);
        expect(h.frames.map(f => f.type)).to.deep.equal(['updated', 'resumed']);
        expect(h.frames[0].seq).to.equal(3);
        expect((h.frames[0].conversation as { id: string }).id).to.equal('c'); // bob's event filtered at send time
        h.emit(updated('d'));
        expect(h.frames.at(-1)!.seq).to.equal(4);
    });

    it('falls back to resync on epoch change or an uncovered gap, then thread_resync for focused threads', () => {
        const h = harness({ maxEvents: 2 });
        for (const id of ['a', 'b', 'c', 'd']) {
            h.log.append(updated(id));
        }
        h.session.hello('other-boot', 4, ['t1']);
        expect(h.frames.map(f => f.type)).to.deep.equal(['resync', 'thread_resync']);
        expect(h.frames[1]).to.deep.equal({ type: 'thread_resync', id: 't1', seq: 4 });
        const gap = harness({ maxEvents: 2 });
        for (const id of ['a', 'b', 'c', 'd']) {
            gap.log.append(updated(id));
        }
        gap.session.hello(gap.log.epoch, 1, []);
        expect(gap.frames[0].type).to.equal('resync');
    });

    it('gates message events by focus but always forwards summaries', () => {
        const h = harness();
        h.session.hello(h.log.epoch, 0, []);
        h.frames.length = 0;
        h.emit(message('t1', 'm1'));
        h.emit(updated('t1'));
        expect(h.frames.map(f => f.type)).to.deep.equal(['updated']);
        h.session.handle({ op: 'focus', id: 't1' });
        h.emit(message('t1', 'm2'));
        h.emit(message('t2', 'm3'));
        expect(h.frames.map(f => f.type)).to.deep.equal(['updated', 'focused', 'message']);
        h.session.handle({ op: 'unfocus', id: 't1' });
        h.emit(message('t1', 'm4'));
        expect(h.frames).to.have.length(3);
    });

    it('focus with sinceSeq replays only that thread messages, or thread_resync when the ring lost them', () => {
        const h = harness({ maxEvents: 3 });
        h.session.hello(h.log.epoch, 0, []);
        h.emit(message('t1', 'm1')); // seq 1
        h.emit(message('t2', 'm2')); // 2
        h.emit(message('t1', 'm3')); // 3
        h.frames.length = 0;
        h.session.handle({ op: 'focus', id: 't1', sinceSeq: 1, epoch: h.log.epoch });
        expect(h.frames.map(f => [f.type, f.seq])).to.deep.equal([['focused', 3], ['message', 3]]);
        h.frames.length = 0;
        h.emit(message('t1', 'm5')); // 4 evicts seq 1
        h.session.handle({ op: 'focus', id: 't3', sinceSeq: 0, epoch: h.log.epoch });
        expect(h.frames.map(f => f.type)).to.deep.equal(['message', 'focused', 'thread_resync']);
        h.frames.length = 0;
        h.session.handle({ op: 'focus', id: 't4', sinceSeq: 2, epoch: 'stale-boot' });
        expect(h.frames.map(f => f.type)).to.deep.equal(['focused', 'thread_resync']);
    });

    it('every v2 frame carries seq (events, pong, heartbeat)', () => {
        const h = harness();
        h.session.hello(h.log.epoch, 0, []);
        h.emit(updated('a'));
        h.session.handle({ op: 'ping' });
        h.session.heartbeat();
        expect(h.frames.every(f => typeof f.seq === 'number')).to.equal(true);
        expect(h.frames.map(f => f.type)).to.deep.equal(['resumed', 'updated', 'pong', 'heartbeat']);
    });

    it('does not heartbeat before hello and ignores a second hello', () => {
        const h = harness();
        h.session.heartbeat();
        expect(h.frames).to.deep.equal([]);
        h.session.hello(undefined, undefined, []);
        const count = h.frames.length;
        h.session.hello(undefined, undefined, []);
        expect(h.frames).to.have.length(count);
    });
});

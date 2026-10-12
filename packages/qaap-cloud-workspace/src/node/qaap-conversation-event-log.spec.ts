// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import {
    QaapConversationEventLog,
    parseQaapConversationEventId,
    qaapConversationEntryToFrame,
    qaapConversationEventThreadId,
} from './qaap-conversation-event-log';

const deleted = (id: string, cwd = '/w/a'): QaapAgentConversationEvent => ({ type: 'deleted', conversationId: id, cwd });

describe('QaapConversationEventLog', () => {

    it('assigns contiguous sequence numbers and a boot epoch', () => {
        const log = new QaapConversationEventLog();
        expect(log.epoch).to.be.a('string').and.not.equal('');
        expect(log.seq).to.equal(0);
        expect(log.append(deleted('a')).seq).to.equal(1);
        expect(log.append(deleted('b')).seq).to.equal(2);
        expect(log.seq).to.equal(2);
        expect(new QaapConversationEventLog().epoch).to.not.equal(log.epoch);
    });

    it('wraps around at the event bound and keeps cursors consistent', () => {
        const log = new QaapConversationEventLog({ maxEvents: 3 });
        for (let i = 0; i < 10; i++) {
            log.append(deleted(`c${i}`));
        }
        expect(log.size).to.equal(3);
        expect(log.firstSeq).to.equal(8);
        expect(log.covers(6)).to.equal(false);
        expect(log.covers(7)).to.equal(true);
        expect(log.since(7)!.map(e => e.seq)).to.deep.equal([8, 9, 10]);
        expect(log.since(9)!.map(e => e.seq)).to.deep.equal([10]);
        expect(log.since(10)).to.deep.equal([]);
        expect(log.since(11)).to.equal(undefined); // cursor from the future
        expect(log.since(2)).to.equal(undefined);
    });

    it('survives many wraparounds past the compaction threshold', () => {
        const log = new QaapConversationEventLog({ maxEvents: 5 });
        for (let i = 0; i < 5000; i++) {
            log.append(deleted(`c${i}`));
        }
        expect(log.size).to.equal(5);
        expect(log.since(4995)!.map(e => e.seq)).to.deep.equal([4996, 4997, 4998, 4999, 5000]);
        expect(log.since(4994)).to.equal(undefined);
    });

    it('evicts by serialized bytes and tracks the byte total', () => {
        const one = JSON.stringify(deleted('x')).length;
        const log = new QaapConversationEventLog({ maxBytes: one * 2 + 1 });
        log.append(deleted('x'));
        log.append(deleted('y'));
        log.append(deleted('z'));
        expect(log.size).to.equal(2);
        expect(log.byteSize).to.equal(one * 2);
        expect(log.firstSeq).to.equal(2);
    });

    it('drops an event larger than the whole byte budget (empty ring only covers the head)', () => {
        const log = new QaapConversationEventLog({ maxBytes: 10 });
        log.append(deleted('a'));
        log.append(deleted('b'));
        expect(log.size).to.equal(0);
        expect(log.byteSize).to.equal(0);
        expect(log.covers(2)).to.equal(true);
        expect(log.since(2)).to.deep.equal([]);
        expect(log.covers(1)).to.equal(false);
    });

    it('refuses to resume across an epoch change', () => {
        const log = new QaapConversationEventLog({ epoch: 'boot-2' });
        log.append(deleted('a'));
        expect(log.resume('boot-1', 0)).to.equal(undefined);
        expect(log.resume(undefined, 0)).to.equal(undefined);
        expect(log.resume('boot-2', 0)!.length).to.equal(1);
    });

    it('keeps owner filtering out of the log: every event is retained for send-time filtering', () => {
        const log = new QaapConversationEventLog();
        log.append(deleted('mine', '/w/alice'));
        log.append(deleted('theirs', '/w/bob'));
        const owned = log.since(0)!.filter(entry => entry.event.type === 'deleted' && entry.event.cwd.startsWith('/w/alice'));
        expect(owned.map(entry => entry.conversationId)).to.deep.equal(['mine']);
        expect(log.size).to.equal(2);
    });

    it('resolves thread ids and serializes frames with seq', () => {
        const log = new QaapConversationEventLog();
        const entry = log.append(deleted('t1'));
        expect(entry.conversationId).to.equal('t1');
        expect(JSON.parse(qaapConversationEntryToFrame(entry))).to.deep.equal({ type: 'deleted', conversationId: 't1', cwd: '/w/a', seq: 1 });
        expect(qaapConversationEventThreadId({ type: 'parallel-run', runId: 'r', cwd: '/w', variants: [] })).to.equal(undefined);
    });

    it('parses Last-Event-ID values', () => {
        expect(parseQaapConversationEventId('abc-def:12')).to.deep.equal({ epoch: 'abc-def', seq: 12 });
        expect(parseQaapConversationEventId('abc')).to.equal(undefined);
        expect(parseQaapConversationEventId('abc:x')).to.equal(undefined);
        expect(parseQaapConversationEventId(':3')).to.equal(undefined);
        expect(parseQaapConversationEventId(undefined)).to.equal(undefined);
    });
});

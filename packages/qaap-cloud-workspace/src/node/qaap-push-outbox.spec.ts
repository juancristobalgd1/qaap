// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_PUSH_OUTBOX_CAPACITY, QAAP_PUSH_OUTBOX_TTL_MS, QaapPushOutbox } from './qaap-push-outbox';

describe('QaapPushOutbox', () => {

    it('keeps only the newest entries beyond the capacity', () => {
        const outbox = new QaapPushOutbox();
        for (let i = 0; i < QAAP_PUSH_OUTBOX_CAPACITY + 5; i++) {
            outbox.enqueue({ title: `t${i}`, body: 'b' }, 1_000);
        }
        expect(outbox.size()).to.equal(QAAP_PUSH_OUTBOX_CAPACITY);
        const drained = outbox.drain(1_000);
        expect(drained[0].title).to.equal('t5');
        expect(drained[drained.length - 1].title).to.equal(`t${QAAP_PUSH_OUTBOX_CAPACITY + 4}`);
    });

    it('expires entries after the TTL', () => {
        const outbox = new QaapPushOutbox();
        outbox.enqueue({ title: 'old', body: 'b' }, 0);
        outbox.enqueue({ title: 'fresh', body: 'b' }, QAAP_PUSH_OUTBOX_TTL_MS);
        const drained = outbox.drain(QAAP_PUSH_OUTBOX_TTL_MS + 1);
        expect(drained.map(entry => entry.title)).to.deep.equal(['fresh']);
    });

    it('drains once and empties the queue, and never stores a recipient', () => {
        const outbox = new QaapPushOutbox();
        outbox.enqueue({ title: 'a', body: 'b', userLogin: 'mallory' } as never, 1);
        const first = outbox.drain(1);
        expect(first).to.have.length(1);
        expect(first[0]).to.not.have.property('userLogin');
        expect(outbox.drain(1)).to.deep.equal([]);
    });
});

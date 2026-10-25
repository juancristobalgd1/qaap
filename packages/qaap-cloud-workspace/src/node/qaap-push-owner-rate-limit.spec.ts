// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_PUSH_OWNER_RATE_LIMIT_PER_MINUTE, QaapPushOwnerRateLimit } from './qaap-push-owner-rate-limit';

describe('QaapPushOwnerRateLimit', () => {

    it('allows 30 notifications per owner per minute, then refuses until the window slides', () => {
        const limit = new QaapPushOwnerRateLimit();
        let accepted = 0;
        for (let i = 0; i < QAAP_PUSH_OWNER_RATE_LIMIT_PER_MINUTE + 5; i++) {
            if (limit.tryAcquire('alice', 1_000)) {
                accepted++;
            }
        }
        expect(accepted).to.equal(30);
        expect(limit.tryAcquire('alice', 1_000 + 59_999)).to.equal(false);
        expect(limit.tryAcquire('alice', 1_000 + 60_000)).to.equal(true);
    });

    it('counts each owner separately', () => {
        const limit = new QaapPushOwnerRateLimit(1);
        expect(limit.tryAcquire('alice', 0)).to.equal(true);
        expect(limit.tryAcquire('alice', 0)).to.equal(false);
        expect(limit.tryAcquire('bob', 0)).to.equal(true);
    });
});

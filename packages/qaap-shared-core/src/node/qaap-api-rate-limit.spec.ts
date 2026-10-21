// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapApiRateLimitContribution, resolveQaapApiRateLimitConfig } from './qaap-api-rate-limit';
import { QaapFrameCheckRateLimiter } from './qaap-frame-check-guard';

class TestRateLimit extends QaapApiRateLimitContribution {
    constructor(login: string | undefined, burst: number) {
        super();
        (this as unknown as { auth: unknown }).auth = {
            authenticate: () => login ? { kind: 'authenticated', userLogin: login } : { kind: 'unauthorized' },
        };
        (this as unknown as { config: unknown }).config = { burst, refillPerSecond: 1 };
        (this as unknown as { limiter: unknown }).limiter = new QaapFrameCheckRateLimiter(burst, 1, 100);
    }
}

function call(limit: QaapApiRateLimitContribution, method: string, path: string): number {
    let status = 0;
    const res = {
        set: () => res,
        status: (code: number) => { status = code; return res; },
        json: () => res,
    };
    limit.handle({ method, path } as Request, res as unknown as Response, () => { status = 200; });
    return status;
}

describe('QaapApiRateLimitContribution', () => {
    it('answers 429 once a login exhausts its bucket on mutating /qaap/api routes', () => {
        const limit = new TestRateLimit('alice', 2);
        expect(call(limit, 'POST', '/qaap/api/preview/claim')).to.equal(200);
        expect(call(limit, 'DELETE', '/qaap/api/preview/claim')).to.equal(200);
        expect(call(limit, 'POST', '/qaap/api/preview/claim')).to.equal(429);
    });

    it('never limits reads, other paths or unauthenticated requests', () => {
        const limit = new TestRateLimit('alice', 1);
        expect(call(limit, 'POST', '/qaap/api/x')).to.equal(200);
        expect(call(limit, 'GET', '/qaap/api/x')).to.equal(200);
        expect(call(limit, 'POST', '/services/x')).to.equal(200);
        const anonymous = new TestRateLimit(undefined, 1);
        expect(call(anonymous, 'POST', '/qaap/api/billing/webhook')).to.equal(200);
        expect(call(anonymous, 'POST', '/qaap/api/billing/webhook')).to.equal(200);
    });

    it('reads generous defaults from the environment and disables on 0', () => {
        expect(resolveQaapApiRateLimitConfig({})).to.deep.equal({ burst: 240, refillPerSecond: 10 });
        expect(resolveQaapApiRateLimitConfig({ QAAP_API_RATE_LIMIT_BURST: '0' })).to.equal(undefined);
        expect(resolveQaapApiRateLimitConfig({ QAAP_API_RATE_LIMIT_PER_SECOND: '2', QAAP_API_RATE_LIMIT_BURST: '50' }))
            .to.deep.equal({ burst: 50, refillPerSecond: 2 });
    });
});

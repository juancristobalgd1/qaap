// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import {
    QaapApiRateLimitContribution,
    resolveQaapApiExpensiveRateLimitConfig,
    resolveQaapApiRateLimitConfig,
} from './qaap-api-rate-limit';
import { QaapFrameCheckRateLimiter } from './qaap-frame-check-guard';

class TestRateLimit extends QaapApiRateLimitContribution {
    constructor(login: string | undefined, burst: number, expensiveBurst?: number) {
        super();
        (this as unknown as { auth: unknown }).auth = {
            authenticate: () => login ? { kind: 'authenticated', userLogin: login } : { kind: 'unauthorized' },
        };
        (this as unknown as { config: unknown }).config = { burst, refillPerSecond: 1 };
        (this as unknown as { limiter: unknown }).limiter = new QaapFrameCheckRateLimiter(burst, 1, 100);
        const expensive = expensiveBurst === undefined ? undefined : { burst: expensiveBurst, refillPerSecond: 0.2 };
        (this as unknown as { expensiveConfig: unknown }).expensiveConfig = expensive;
        (this as unknown as { expensiveLimiter: unknown }).expensiveLimiter = expensive
            ? new QaapFrameCheckRateLimiter(expensive.burst, expensive.refillPerSecond, 100)
            : undefined;
    }
}

interface Answer {
    status: number;
    body?: unknown;
    retryAfter?: string;
}

function respond(limit: QaapApiRateLimitContribution, method: string, path: string): Answer {
    const answer: Answer = { status: 0 };
    const res = {
        set: (name: string, value: string) => {
            if (name === 'Retry-After') {
                answer.retryAfter = value;
            }
            return res;
        },
        status: (code: number) => { answer.status = code; return res; },
        json: (body: unknown) => { answer.body = body; return res; },
    };
    limit.handle({ method, path } as Request, res as unknown as Response, () => { answer.status = 200; });
    return answer;
}

function call(limit: QaapApiRateLimitContribution, method: string, path: string): number {
    return respond(limit, method, path).status;
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

    it('cuts expensive agent-turn and clone routes after their own burst, while normal routes still pass', () => {
        const limit = new TestRateLimit('alice', 100, 2);
        expect(call(limit, 'POST', '/qaap/api/agent-conversations')).to.equal(200);
        expect(call(limit, 'POST', '/qaap/api/agent-conversations/c1/messages')).to.equal(200);
        const limited = respond(limit, 'POST', '/qaap/api/agent-tasks/improve-prompt');
        expect(limited.status).to.equal(429);
        expect(limited.retryAfter).to.equal('5');
        expect(limited.body).to.deep.equal({ error: 'Too many requests. Wait a moment and try again.', code: 'rate_limited' });
        expect(call(limit, 'POST', '/qaap/api/github/repositories/owner/repo/open')).to.equal(429);
        expect(call(limit, 'POST', '/qaap/api/github/repositories/open')).to.equal(429);
        expect(call(limit, 'POST', '/qaap/api/preview/claim')).to.equal(200);
        expect(call(limit, 'GET', '/qaap/api/agent-conversations')).to.equal(200);
    });

    it('does not count dev-preview claims or other mutations against the expensive bucket', () => {
        const limit = new TestRateLimit('alice', 100, 1);
        expect(call(limit, 'POST', '/qaap/api/agent-conversations/c1/messages/extra')).to.equal(200);
        expect(call(limit, 'POST', '/qaap/api/agent-conversations/c1/messages/extra')).to.equal(200);
        expect(call(limit, 'POST', '/qaap/api/preview/claim')).to.equal(200);
        expect(call(limit, 'POST', '/qaap/api/preview/claim')).to.equal(200);
    });

    it('lets the general bucket answer first and disables the expensive bucket on 0', () => {
        const general = new TestRateLimit('alice', 1, 5);
        expect(call(general, 'POST', '/qaap/api/agent-conversations')).to.equal(200);
        expect(respond(general, 'POST', '/qaap/api/agent-conversations').body)
            .to.deep.equal({ error: 'Too many requests. Wait a moment and try again.', code: 'rate_limited' });
        const disabled = new TestRateLimit('alice', 100, undefined);
        for (let i = 0; i < 30; i++) {
            expect(call(disabled, 'POST', '/qaap/api/agent-conversations')).to.equal(200);
        }
    });

    it('reads generous defaults from the environment and disables on 0', () => {
        expect(resolveQaapApiRateLimitConfig({})).to.deep.equal({ burst: 240, refillPerSecond: 10 });
        expect(resolveQaapApiRateLimitConfig({ QAAP_API_RATE_LIMIT_BURST: '0' })).to.equal(undefined);
        expect(resolveQaapApiRateLimitConfig({ QAAP_API_RATE_LIMIT_PER_SECOND: '2', QAAP_API_RATE_LIMIT_BURST: '50' }))
            .to.deep.equal({ burst: 50, refillPerSecond: 2 });
    });

    it('reads the strict expensive-route bucket from its own environment and disables on 0', () => {
        expect(resolveQaapApiExpensiveRateLimitConfig({})).to.deep.equal({ burst: 20, refillPerSecond: 0.2 });
        expect(resolveQaapApiExpensiveRateLimitConfig({ QAAP_API_EXPENSIVE_RATE_LIMIT_BURST: '0' })).to.equal(undefined);
        expect(resolveQaapApiExpensiveRateLimitConfig({ QAAP_API_EXPENSIVE_RATE_LIMIT_PER_SECOND: '0' })).to.equal(undefined);
        expect(resolveQaapApiExpensiveRateLimitConfig({ QAAP_API_EXPENSIVE_RATE_LIMIT_BURST: '5', QAAP_API_EXPENSIVE_RATE_LIMIT_PER_SECOND: '1' }))
            .to.deep.equal({ burst: 5, refillPerSecond: 1 });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { evaluateQaapFrameHeaders } from '@theia/qaap-adapters/lib/common/qaap-frame-check';
import { isQaapBlockedFrameCheckIp, isQaapInternalFrameCheckHost, QaapFrameCheckCache, QaapFrameCheckRateLimiter, QaapFrameCheckSemaphore } from './qaap-frame-check-guard';

describe('qaap frame check', () => {

    describe('evaluateQaapFrameHeaders', () => {
        it('blocks X-Frame-Options DENY and SAMEORIGIN', () => {
            expect(evaluateQaapFrameHeaders({ 'x-frame-options': 'DENY' }).embeddable).to.equal(false);
            expect(evaluateQaapFrameHeaders({ 'x-frame-options': 'sameorigin' }).embeddable).to.equal(false);
        });

        it('blocks CSP frame-ancestors other than *', () => {
            expect(evaluateQaapFrameHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }).embeddable).to.equal(false);
            expect(evaluateQaapFrameHeaders({ 'content-security-policy': "frame-ancestors 'self' https://a.com" }).embeddable).to.equal(false);
        });

        it('allows * frame-ancestors, unrelated CSP and no headers', () => {
            expect(evaluateQaapFrameHeaders({ 'content-security-policy': 'frame-ancestors *' }).embeddable).to.equal(true);
            expect(evaluateQaapFrameHeaders({ 'content-security-policy': "default-src 'self'" }).embeddable).to.equal(true);
            expect(evaluateQaapFrameHeaders({ 'x-frame-options': 'ALLOW-FROM https://a.com' }).embeddable).to.equal(true);
            expect(evaluateQaapFrameHeaders({}).embeddable).to.equal(true);
        });

        it('allows frame-ancestors that name the Qaap app origin (isolated previews)', () => {
            const headers = { 'content-security-policy': "frame-ancestors 'self' https://qaap.example/" };
            expect(evaluateQaapFrameHeaders(headers).embeddable).to.equal(false);
            expect(evaluateQaapFrameHeaders(headers, 'https://qaap.example').embeddable).to.equal(true);
            expect(evaluateQaapFrameHeaders({ 'content-security-policy': 'frame-ancestors https:' }, 'https://qaap.example').embeddable).to.equal(true);
            expect(evaluateQaapFrameHeaders({ 'content-security-policy': 'frame-ancestors https://evil.example' }, 'https://qaap.example').embeddable)
                .to.equal(false);
            expect(evaluateQaapFrameHeaders({ 'x-frame-options': 'DENY' }, 'https://qaap.example').embeddable).to.equal(false);
        });

        it('matches host wildcards, scheme-less hosts and ports in frame-ancestors', () => {
            const app = 'https://app.qaap.example';
            const embeddable = (sources: string, origin = app): boolean =>
                evaluateQaapFrameHeaders({ 'content-security-policy': `frame-ancestors ${sources}` }, origin).embeddable;
            expect(embeddable('https://*.qaap.example')).to.equal(true);
            expect(embeddable('*.qaap.example')).to.equal(true);
            expect(embeddable('app.qaap.example')).to.equal(true);
            expect(embeddable('https://app.qaap.example:443')).to.equal(true);
            expect(embeddable('https://*.qaap.example:*', 'https://app.qaap.example:8443')).to.equal(true);
            expect(embeddable('https://*.qaap.example', 'https://qaap.example')).to.equal(false);
            expect(embeddable('https://*.qaap.example', 'https://app.qaap.example:8443')).to.equal(false);
            expect(embeddable('https://*.evil-qaap.example')).to.equal(false);
            expect(embeddable('https://*.example.qaap')).to.equal(false);
            expect(embeddable("'self' 'none'")).to.equal(false);
        });
    });

    describe('isQaapInternalFrameCheckHost', () => {
        it('recognizes isolated preview hosts and the app host', () => {
            const app = 'https://qaap.example';
            expect(isQaapInternalFrameCheckHost(new URL('https://0123456789abcdef0123456789abcdef.preview.qaap.example/'), app, 'preview.qaap.example'))
                .to.equal(true);
            expect(isQaapInternalFrameCheckHost(new URL('https://x.preview.qaap.example/'), app, 'preview.qaap.example:443')).to.equal(true);
            expect(isQaapInternalFrameCheckHost(new URL('https://qaap.example/x'), app, undefined)).to.equal(true);
        });

        it('rejects look-alike and unrelated hosts', () => {
            const app = 'https://qaap.example';
            expect(isQaapInternalFrameCheckHost(new URL('https://evilpreview.qaap.example/'), app, 'preview.qaap.example')).to.equal(false);
            expect(isQaapInternalFrameCheckHost(new URL('https://preview.qaap.example.evil.com/'), app, 'preview.qaap.example')).to.equal(false);
            expect(isQaapInternalFrameCheckHost(new URL('https://claude.ai/'), app, 'preview.qaap.example')).to.equal(false);
        });
    });

    describe('QaapFrameCheckSemaphore', () => {
        it('refuses past the cap without queueing and frees on release', () => {
            const semaphore = new QaapFrameCheckSemaphore(2);
            expect(semaphore.tryAcquire()).to.equal(true);
            expect(semaphore.tryAcquire()).to.equal(true);
            expect(semaphore.tryAcquire()).to.equal(false);
            semaphore.release();
            expect(semaphore.tryAcquire()).to.equal(true);
            expect(semaphore.inUse).to.equal(2);
        });
    });

    describe('QaapFrameCheckRateLimiter', () => {
        it('allows a burst, refuses past capacity and refills over time', () => {
            const limiter = new QaapFrameCheckRateLimiter(2, 1, 10);
            expect(limiter.tryTake('a', 0)).to.equal(true);
            expect(limiter.tryTake('a', 0)).to.equal(true);
            expect(limiter.tryTake('a', 0)).to.equal(false);
            expect(limiter.tryTake('b', 0)).to.equal(true);
            expect(limiter.tryTake('a', 1000)).to.equal(true);
        });
    });

    describe('isQaapBlockedFrameCheckIp', () => {
        it('blocks loopback, private, link-local and metadata addresses', () => {
            for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
                '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'not-an-ip',
                // IPv6 spellings of private IPv4 targets (the hex mapped form is what DNS lookup returns for `[::ffff:10.0.0.1]`).
                '::ffff:a00:1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::a00:1', '2002:a00:1::1', '64:ff9b::a00:1', '2001:0:4136:e378::1',
                'ff02::1', '198.18.0.1', '192.0.0.170']) {
                expect(isQaapBlockedFrameCheckIp(ip), ip).to.equal(true);
            }
        });

        it('allows public addresses', () => {
            for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808', '2002:808:808::1', '2a00:1450:4003:80e::200e']) {
                expect(isQaapBlockedFrameCheckIp(ip), ip).to.equal(false);
            }
        });
    });

    describe('QaapFrameCheckCache', () => {
        it('evicts the oldest entry past the bound', () => {
            const cache = new QaapFrameCheckCache<number>(3, 1000);
            for (let i = 0; i < 5; i++) {
                cache.set(`k${i}`, i, 0);
            }
            expect(cache.size).to.equal(3);
            expect(cache.get('k0', 1)).to.equal(undefined);
            expect(cache.get('k4', 1)).to.equal(4);
        });

        it('expires entries after the TTL', () => {
            const cache = new QaapFrameCheckCache<number>(3, 1000);
            cache.set('a', 1, 0);
            expect(cache.get('a', 999)).to.equal(1);
            expect(cache.get('a', 1000)).to.equal(undefined);
            expect(cache.size).to.equal(0);
        });
    });
});

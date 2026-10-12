// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { evaluateQaapFrameHeaders } from '@theia/qaap-adapters/lib/common/qaap-frame-check';
import { isQaapBlockedFrameCheckIp, QaapFrameCheckCache } from './qaap-frame-check-guard';

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
    });

    describe('isQaapBlockedFrameCheckIp', () => {
        it('blocks loopback, private, link-local and metadata addresses', () => {
            for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
                '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'not-an-ip']) {
                expect(isQaapBlockedFrameCheckIp(ip), ip).to.equal(true);
            }
        });

        it('allows public addresses', () => {
            for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) {
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

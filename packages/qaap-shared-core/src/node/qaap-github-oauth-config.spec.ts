// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapPublicOriginRequest, resolveQaapPublicOrigin } from './qaap-github-oauth-config';

function request(
    headers: QaapPublicOriginRequest['headers'],
    remoteAddress = '203.0.113.7',
    protocol = 'http',
): QaapPublicOriginRequest {
    return { headers, protocol, socket: { remoteAddress } };
}

describe('resolveQaapPublicOrigin', () => {
    const spoofed = { host: 'qaap.local:3000', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' };

    it('always prefers QAAP_OAUTH_PUBLIC_URL', () => {
        expect(resolveQaapPublicOrigin(request(spoofed, '127.0.0.1'), { QAAP_OAUTH_PUBLIC_URL: 'https://app.qaap.example/' }))
            .to.equal('https://app.qaap.example');
    });

    it('ignores forwarded headers from a non-proxy peer', () => {
        expect(resolveQaapPublicOrigin(request(spoofed), {})).to.equal('http://qaap.local:3000');
    });

    it('honours forwarded headers from a loopback reverse proxy', () => {
        for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
            expect(resolveQaapPublicOrigin(request(spoofed, peer), {})).to.equal('https://evil.example');
        }
    });

    it('honours forwarded headers from any peer when QAAP_TRUST_PROXY is set', () => {
        expect(resolveQaapPublicOrigin(request(spoofed), { QAAP_TRUST_PROXY: '1' })).to.equal('https://evil.example');
    });

    it('uses the first value of a multi-hop forwarded header', () => {
        const headers = { host: 'internal:3000', 'x-forwarded-host': 'app.example, proxy.internal', 'x-forwarded-proto': 'https, http' };
        expect(resolveQaapPublicOrigin(request(headers, '127.0.0.1'), {})).to.equal('https://app.example');
    });

    it('rejects hosts that smuggle a path, credentials or a second origin', () => {
        for (const bad of ['evil.example/path', 'user@evil.example', 'evil.example\\x', 'a b', 'evil.example:99999999']) {
            expect(resolveQaapPublicOrigin(request({ host: bad }), {})).to.equal('http://localhost');
            expect(resolveQaapPublicOrigin(request({ host: 'ok.example', 'x-forwarded-host': bad }, '127.0.0.1'), {}))
                .to.equal('http://ok.example');
        }
    });

    it('accepts bracketed IPv6 hosts and ignores unknown forwarded protocols', () => {
        const headers = { host: '[::1]:3000', 'x-forwarded-proto': 'javascript' };
        expect(resolveQaapPublicOrigin(request(headers, '::1'), {})).to.equal('http://[::1]:3000');
    });
});

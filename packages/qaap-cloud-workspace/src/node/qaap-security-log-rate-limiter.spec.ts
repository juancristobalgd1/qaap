// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import { QaapSecurityLogRateLimiter } from './qaap-security-log-rate-limiter';
import { QaapAuthenticatedWsRequestValidator } from './qaap-authenticated-ws-request-validator';

class StubbedInterfaceLimiter extends QaapSecurityLogRateLimiter {
    constructor(protected readonly cidrs: string[]) {
        super();
    }

    protected override ownInterfaceCidrs(): string[] {
        return this.cidrs;
    }
}

describe('QaapSecurityLogRateLimiter', () => {
    function request(peer: string, forwardedFor?: string): http.IncomingMessage {
        return {
            url: '/socket.io/?EIO=4',
            socket: { remoteAddress: peer },
            headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
        } as unknown as http.IncomingMessage;
    }

    it('logs the first refusal of a client per minute and reports how many it dropped', () => {
        const limiter = new QaapSecurityLogRateLimiter();
        expect(limiter.admit('websocket_denied', request('203.0.113.7'), 0)).to.deep.equal({ client: '203.0.113.7' });
        expect(limiter.admit('websocket_denied', request('203.0.113.7'), 1_000)).to.equal(undefined);
        expect(limiter.admit('websocket_denied', request('203.0.113.7'), 59_999)).to.equal(undefined);
        expect(limiter.admit('websocket_denied', request('203.0.113.7'), 60_000)).to.deep.equal({ client: '203.0.113.7', suppressed: 2 });
    });

    it('keeps clients and events apart', () => {
        const limiter = new QaapSecurityLogRateLimiter();
        expect(limiter.admit('websocket_denied', request('203.0.113.7'), 0)).to.not.equal(undefined);
        expect(limiter.admit('websocket_denied', request('198.51.100.2'), 0)).to.not.equal(undefined);
        expect(limiter.admit('control_plane_rpc_denied', request('203.0.113.7'), 0)).to.not.equal(undefined);
    });

    it('uses X-Forwarded-For only behind a trusted proxy', () => {
        const limiter = new StubbedInterfaceLimiter(['172.17.0.9/16']);
        expect(limiter.admit('e', request('127.0.0.1', '203.0.113.7, 172.17.0.1'), 0)).to.deep.equal({ client: '203.0.113.7' });
        expect(limiter.admit('e', request('198.51.100.2', 'spoofed'), 0)).to.deep.equal({ client: '198.51.100.2' });
    });

    it('keys clients behind Caddy on the Docker bridge to the forwarded address', () => {
        const limiter = new StubbedInterfaceLimiter(['172.18.0.9/16']);
        expect(limiter.admit('e', request('172.18.0.5', '203.0.113.7'), 0)).to.deep.equal({ client: '203.0.113.7' });
        expect(limiter.admit('e', request('::ffff:172.18.0.5', '198.51.100.2'), 0)).to.deep.equal({ client: '198.51.100.2' });
        // Two clients behind the same proxy are sampled separately.
        expect(limiter.admit('e', request('172.18.0.5', '203.0.113.8'), 0)).to.not.equal(undefined);
    });

    it('trusts a peer on the container\'s own interface subnet (custom Docker address pool)', () => {
        const limiter = new StubbedInterfaceLimiter(['10.200.5.9/24']);
        expect(limiter.admit('e', request('10.200.5.2', '203.0.113.7'), 0)).to.deep.equal({ client: '203.0.113.7' });
    });

    it('keys by the peer when no own interface matches it (miss case)', () => {
        const limiter = new StubbedInterfaceLimiter([]);
        expect(limiter.admit('e', request('10.200.5.2', '203.0.113.7'), 0)).to.deep.equal({ client: '10.200.5.2' });
    });

    it('does not trust private-range peers outside the own interface subnets by default', () => {
        const limiter = new StubbedInterfaceLimiter(['10.200.5.9/24']);
        for (const peer of ['192.168.1.20', '10.8.0.4', 'fd00::5']) {
            expect(limiter.admit('e', request(peer, '203.0.113.7'), 0)).to.deep.equal({ client: peer });
        }
    });

    it('takes the right-most untrusted hop so a client cannot spoof its key', () => {
        const limiter = new StubbedInterfaceLimiter(['172.18.0.9/16']);
        // The client sent "X-Forwarded-For: 1.2.3.4"; Caddy appended the real address.
        expect(limiter.admit('e', request('172.18.0.5', '1.2.3.4, 203.0.113.7'), 0)).to.deep.equal({ client: '203.0.113.7' });
        expect(limiter.admit('e', request('172.18.0.5', '1.2.3.4, 203.0.113.9, 172.18.0.3'), 0)).to.deep.equal({ client: '203.0.113.9' });
        // An untrusted public peer cannot choose its key with a spoofed header.
        expect(limiter.admit('e', request('203.0.113.50', '172.18.0.9, 1.2.3.4'), 0)).to.deep.equal({ client: '203.0.113.50' });
    });

    it('honours QAAP_TRUSTED_PROXY_CIDRS', () => {
        const saved = process.env.QAAP_TRUSTED_PROXY_CIDRS;
        process.env.QAAP_TRUSTED_PROXY_CIDRS = '198.51.100.0/24, not-a-cidr';
        try {
            const limiter = new QaapSecurityLogRateLimiter();
            expect(limiter.admit('e', request('198.51.100.2', '203.0.113.7'), 0)).to.deep.equal({ client: '203.0.113.7' });
            // The defaults no longer apply once the list is configured.
            expect(limiter.admit('e', request('172.18.0.5', '203.0.113.7'), 0)).to.deep.equal({ client: '172.18.0.5' });
            const stubbed = new StubbedInterfaceLimiter(['172.18.0.9/16']);
            expect(stubbed.admit('e', request('172.18.0.5', '203.0.113.7'), 0)).to.deep.equal({ client: '172.18.0.5' });
        } finally {
            if (saved === undefined) {
                delete process.env.QAAP_TRUSTED_PROXY_CIDRS;
            } else {
                process.env.QAAP_TRUSTED_PROXY_CIDRS = saved;
            }
        }
    });

    it('samples the refused-handshake log of the authenticated validator', () => {
        const savedMode = process.env.QAAP_CLOUD_MODE;
        process.env.QAAP_CLOUD_MODE = 'docker';
        try {
            const logged: unknown[] = [];
            const validator = new QaapAuthenticatedWsRequestValidator();
            Object.assign(validator, {
                auth: { authenticate: () => ({ kind: 'unauthorized' }), logSecurityEvent: (_event: string, detail: unknown) => logged.push(detail) },
                logLimiter: new QaapSecurityLogRateLimiter(),
            });
            for (let attempt = 0; attempt < 20; attempt++) {
                expect(validator.allowWsUpgrade(request('127.0.0.1', '203.0.113.7'))).to.equal(false);
            }
            expect(logged).to.have.length(1);
        } finally {
            if (savedMode === undefined) {
                delete process.env.QAAP_CLOUD_MODE;
            } else {
                process.env.QAAP_CLOUD_MODE = savedMode;
            }
        }
    });
});

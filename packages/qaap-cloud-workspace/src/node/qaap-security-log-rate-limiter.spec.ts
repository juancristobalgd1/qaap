// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import { QaapSecurityLogRateLimiter } from './qaap-security-log-rate-limiter';
import { QaapAuthenticatedWsRequestValidator } from './qaap-authenticated-ws-request-validator';

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

    it('uses X-Forwarded-For only behind the loopback proxy', () => {
        const limiter = new QaapSecurityLogRateLimiter();
        expect(limiter.admit('e', request('127.0.0.1', '203.0.113.7, 10.0.0.1'), 0)).to.deep.equal({ client: '203.0.113.7' });
        expect(limiter.admit('e', request('198.51.100.2', 'spoofed'), 0)).to.deep.equal({ client: '198.51.100.2' });
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

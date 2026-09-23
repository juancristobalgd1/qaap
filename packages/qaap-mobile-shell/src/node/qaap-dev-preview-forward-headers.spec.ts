// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as express from '@theia/core/shared/express';
import { QAAP_PREVIEW_ACCESS_COOKIE, QaapDevPreviewEndpoint } from './qaap-dev-preview-endpoint';
import {
    QAAP_PREVIEW_ACCESS_COOKIE_NAME,
    buildQaapPreviewUpstreamHeaders,
    filterQaapReservedSetCookies,
    sanitizeQaapPreviewResponseHeaders,
    stripQaapReservedCookies,
} from './qaap-dev-preview-forward-headers';

describe('qaap-dev-preview-forward-headers', () => {

    it('shares the preview capability cookie name with the endpoint', () => {
        expect(QAAP_PREVIEW_ACCESS_COOKIE).to.equal(QAAP_PREVIEW_ACCESS_COOKIE_NAME);
    });

    describe('stripQaapReservedCookies', () => {
        it('removes Qaap-owned cookies and keeps the app cookies in order', () => {
            expect(stripQaapReservedCookies('app=1; qaap_sid=secret; theme=dark; qaap_preview_access=cap; theia-connection-token=t'))
                .to.equal('app=1; theme=dark');
        });

        it('returns undefined when only Qaap cookies were present', () => {
            expect(stripQaapReservedCookies('qaap_sid=secret')).to.equal(undefined);
            expect(stripQaapReservedCookies(undefined)).to.equal(undefined);
        });

        it('does not strip cookies that merely share a prefix', () => {
            expect(stripQaapReservedCookies('qaap_sid_app=1; my_qaap_sid=2')).to.equal('qaap_sid_app=1; my_qaap_sid=2');
        });

        it('handles whitespace around names and array-valued headers', () => {
            expect(stripQaapReservedCookies(['  qaap_sid =x', 'app=1'])).to.equal('app=1');
        });
    });

    describe('filterQaapReservedSetCookies', () => {
        it('drops Set-Cookie entries that would overwrite a Qaap cookie', () => {
            expect(filterQaapReservedSetCookies([
                'qaap_sid=attacker; Path=/; HttpOnly',
                'session=app; Path=/',
                'theia-connection-token=x; Path=/',
            ])).to.deep.equal(['session=app; Path=/']);
        });

        it('returns undefined when nothing is left', () => {
            expect(filterQaapReservedSetCookies('qaap_preview_access=x')).to.equal(undefined);
        });
    });

    describe('buildQaapPreviewUpstreamHeaders', () => {
        it('drops Qaap cookies and every x-qaap-* internal header, keeps the rest', () => {
            const headers = buildQaapPreviewUpstreamHeaders({
                host: 'app.qaap.example',
                cookie: 'qaap_sid=secret; app=1',
                'x-qaap-tenant-assertion': 'hmac',
                'x-qaap-preview-referer-id': 'p-1',
                authorization: 'Bearer app-token',
                accept: 'text/html',
            }, 'localhost:5173');
            expect(headers).to.deep.equal({
                host: 'localhost:5173',
                cookie: 'app=1',
                authorization: 'Bearer app-token',
                accept: 'text/html',
            });
        });

        it('omits the cookie header entirely when only Qaap cookies were sent', () => {
            const headers = buildQaapPreviewUpstreamHeaders({ cookie: 'qaap_sid=secret' }, 'localhost:1');
            expect(headers).to.not.have.property('cookie');
        });
    });

    it('sanitizeQaapPreviewResponseHeaders removes an all-reserved set-cookie header', () => {
        const headers: http.OutgoingHttpHeaders = { 'set-cookie': ['qaap_sid=evil'], 'content-type': 'text/plain' };
        sanitizeQaapPreviewResponseHeaders(headers);
        expect(headers).to.deep.equal({ 'content-type': 'text/plain' });
    });

    describe('dev preview HTTP proxy (end to end)', () => {
        class LoopbackPreviewEndpoint extends QaapDevPreviewEndpoint {
            override resolveTargetHost(): Promise<string | undefined> {
                return Promise.resolve('127.0.0.1');
            }
            forward(req: express.Request, res: express.Response, port: number): Promise<void> {
                return this.forwardHttp(req, res, port, '/echo');
            }
        }

        let devServer: http.Server;
        let front: http.Server;
        let received: http.IncomingHttpHeaders | undefined;

        const listen = (server: http.Server): Promise<number> => new Promise(resolve => {
            server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
        });
        const close = (server: http.Server | undefined): Promise<void> => new Promise(resolve => {
            if (!server) {
                resolve();
                return;
            }
            server.close(() => resolve());
        });

        beforeEach(async () => {
            received = undefined;
            devServer = http.createServer((req, res) => {
                received = req.headers;
                res.setHeader('Set-Cookie', ['qaap_sid=attacker; Path=/', 'app_session=ok; Path=/']);
                res.setHeader('Content-Type', 'application/json');
                res.end('{}');
            });
            const devPort = await listen(devServer);
            const endpoint = new LoopbackPreviewEndpoint();
            const app = express();
            app.use((req, res) => {
                void endpoint.forward(req, res, devPort);
            });
            front = http.createServer(app);
            await listen(front);
        });

        afterEach(async () => {
            await close(front);
            await close(devServer);
        });

        it('never leaks Qaap cookies or internal headers upstream and blocks session overwrite', async () => {
            const frontPort = (front.address() as AddressInfo).port;
            const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
                const req = http.request({
                    host: '127.0.0.1',
                    port: frontPort,
                    path: '/qaap-preview/5173/echo',
                    headers: {
                        cookie: 'qaap_sid=victim-session; qaap_preview_access=cap; app_session=mine',
                        'x-qaap-tenant-assertion': 'hmac-assertion',
                    },
                }, resolve);
                req.once('error', reject);
                req.end();
            });
            response.resume();

            expect(received?.cookie).to.equal('app_session=mine');
            expect(received).to.not.have.property('x-qaap-tenant-assertion');
            expect(response.headers['set-cookie']).to.deep.equal(['app_session=ok; Path=/']);
        });
    });
});

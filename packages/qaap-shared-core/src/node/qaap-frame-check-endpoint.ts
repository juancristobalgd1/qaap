// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { evaluateQaapFrameHeaders, QAAP_FRAME_CHECK_API_PATH, QaapFrameCheckResult } from '@theia/qaap-adapters/lib/common/qaap-frame-check';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { isQaapBlockedFrameCheckIp, QaapFrameCheckCache } from './qaap-frame-check-guard';

const TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 3;
const EMBEDDABLE: QaapFrameCheckResult = { embeddable: true };

interface FrameCheckResponse {
    readonly status: number;
    readonly headers: http.IncomingHttpHeaders;
}

/**
 * Preflight for the mini-browser: reports whether an external site forbids framing
 * (`X-Frame-Options` / CSP `frame-ancestors`), which the browser hides from the embedding page.
 * SSRF-guarded: only http(s), and every hop must resolve to public IPs (the checked IP is the one connected to).
 * Any refusal or failure answers `embeddable: true` so the iframe still gets its normal attempt.
 */
@injectable()
export class QaapFrameCheckEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    protected readonly cache = new QaapFrameCheckCache<QaapFrameCheckResult>();

    configure(app: Application): void {
        app.get(QAAP_FRAME_CHECK_API_PATH, (req, res) => this.handle(req, res));
    }

    protected async handle(req: Request, res: Response): Promise<void> {
        if (this.auth.authenticate(req).kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        let result = EMBEDDABLE;
        try {
            const url = new URL(typeof req.query.url === 'string' ? req.query.url : '');
            const cached = this.cache.get(url.origin);
            if (cached) {
                result = cached;
            } else {
                result = await this.check(url);
                this.cache.set(url.origin, result);
            }
        } catch {
            result = EMBEDDABLE;
        }
        res.set('Cache-Control', 'no-store').json(result);
    }

    protected async check(start: URL): Promise<QaapFrameCheckResult> {
        let url = start;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            let response = await this.request(url, 'HEAD');
            if (response.status === 405 || response.status === 501) {
                response = await this.request(url, 'GET');
            }
            const location = response.headers.location;
            if (response.status >= 300 && response.status < 400 && location) {
                url = new URL(location, url);
                continue;
            }
            return evaluateQaapFrameHeaders(response.headers);
        }
        return EMBEDDABLE;
    }

    protected async request(url: URL, method: 'HEAD' | 'GET'): Promise<FrameCheckResponse> {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = await dns.promises.lookup(host, { all: true });
        if (addresses.length === 0 || addresses.some(a => isQaapBlockedFrameCheckIp(a.address))) {
            throw new Error('blocked address');
        }
        const client = url.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const req = client.request({
                method,
                host: addresses[0].address,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                servername: net.isIP(host) ? undefined : host,
                headers: { host: url.host, 'user-agent': 'Mozilla/5.0 (compatible; QaapFrameCheck)', accept: '*/*' },
                timeout: TIMEOUT_MS,
            }, res => {
                res.destroy();
                resolve({ status: res.statusCode ?? 0, headers: res.headers });
            });
            req.on('timeout', () => req.destroy(new Error('timeout')));
            req.on('error', reject);
            req.end();
        });
    }
}

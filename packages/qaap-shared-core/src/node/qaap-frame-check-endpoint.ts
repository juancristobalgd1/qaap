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
import { resolveQaapPublicOrigin } from './qaap-github-oauth-config';
import { normalizeQaapPreviewBaseDomain } from './qaap-production-auth-readiness';
import { isQaapBlockedFrameCheckIp, isQaapInternalFrameCheckHost, QaapFrameCheckCache, QaapFrameCheckRateLimiter } from './qaap-frame-check-guard';

const REQUEST_TIMEOUT_MS = 3000;
/** Whole check (DNS + every hop) must finish within this, or the answer is "unknown". */
const DEADLINE_MS = 5000;
const MAX_REDIRECTS = 3;
const INTERNAL: QaapFrameCheckResult = { embeddable: true, internal: true };
/** No answer (refused, rate-limited, failed): the iframe still gets its attempt and the client keeps its load timeout. */
const UNKNOWN: QaapFrameCheckResult = { embeddable: true, unknown: true };

interface FrameCheckResponse {
    readonly status: number;
    readonly headers: http.IncomingHttpHeaders;
}

/**
 * Preflight for the preview browser: reports whether an external site forbids framing
 * (`X-Frame-Options` / CSP `frame-ancestors`), which the browser hides from the embedding page.
 * SSRF-guarded: only http(s) on the default ports, every hop must resolve to public IPs (the checked
 * IP is the one connected to), a 5 s total deadline and a per-login rate limit. Qaap's own origin and
 * isolated preview hosts (`*.QAAP_PREVIEW_BASE_DOMAIN`) are never fetched and answer `internal`.
 * Any refusal or failure answers `embeddable: true, unknown: true` so the iframe still gets its normal
 * attempt and the client keeps its load-timeout fallback.
 */
@injectable()
export class QaapFrameCheckEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    protected readonly cache = new QaapFrameCheckCache<QaapFrameCheckResult>();
    protected readonly rateLimiter = new QaapFrameCheckRateLimiter();

    configure(app: Application): void {
        app.get(QAAP_FRAME_CHECK_API_PATH, (req, res) => this.handle(req, res));
    }

    protected async handle(req: Request, res: Response): Promise<void> {
        const auth = this.auth.authenticate(req);
        if (auth.kind === 'unauthorized') {
            res.status(401).json({ error: 'Not signed in' });
            return;
        }
        let result = UNKNOWN;
        try {
            const url = new URL(typeof req.query.url === 'string' ? req.query.url : '');
            const appOrigin = resolveQaapPublicOrigin(req);
            const cacheKey = `${url.origin}${url.pathname}`;
            const cached = this.cache.get(cacheKey);
            if (isQaapInternalFrameCheckHost(url, appOrigin, normalizeQaapPreviewBaseDomain(process.env.QAAP_PREVIEW_BASE_DOMAIN))) {
                result = INTERNAL;
            } else if (cached) {
                result = cached;
            } else if (this.rateLimiter.tryTake(auth.userLogin)) {
                result = await this.withDeadline(this.check(url, appOrigin));
                if (!result.unknown) {
                    this.cache.set(cacheKey, result);
                }
            }
        } catch {
            result = UNKNOWN;
        }
        res.set('Cache-Control', 'no-store').json(result);
    }

    protected withDeadline<T>(work: Promise<T>): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('deadline')), DEADLINE_MS);
        });
        return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
    }

    protected async check(start: URL, appOrigin: string): Promise<QaapFrameCheckResult> {
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
            return evaluateQaapFrameHeaders(response.headers, appOrigin);
        }
        return UNKNOWN;
    }

    protected async request(url: URL, method: 'HEAD' | 'GET'): Promise<FrameCheckResponse> {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
        // Default ports only: the check must not become a port scanner.
        if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
            throw new Error('unsupported port');
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
                timeout: REQUEST_TIMEOUT_MS,
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

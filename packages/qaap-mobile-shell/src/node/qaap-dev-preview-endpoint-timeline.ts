// @ts-nocheck
// Extracted from qaap-dev-preview-endpoint.ts

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, NextFunction, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution, FileUri } from '@theia/core/lib/node';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { timingSafeEqual } from 'crypto';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import { QaapDevPreviewPortRegistry, type QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import {
    QAAP_DEV_PREVIEW_CLAIM_PATH,
    QAAP_DEV_PREVIEW_CURRENT_PATH,
    QAAP_DEV_PREVIEW_RELEASE_PATH,
    QAAP_DEV_PREVIEW_PREFIX,
    QAAP_DEV_PREVIEW_PROBE_PATH,
    QAAP_IDENTITY_PREVIEW_PREFIX,
    QAAP_IDENTITY_PREVIEW_PROBE_PATH,
    buildDevPreviewWaitingHtml,
    buildQaapDevPreviewOpenUrl,
    buildQaapIdentityPreviewUrl,
    injectQaapPreviewViteEnvBootstrap,
    injectQaapPreviewDiagnostics,
    injectQaapPreviewHistoryBase,
    isAllowedDevPreviewPort,
    parseQaapDevPreviewPort,
    parseQaapIdentityPreviewRequestPath,
    parseQaapDevPreviewRequestPath,
    type QaapDevPreviewProbeResponse,
} from '../common/qaap-dev-preview';
import {
    QAAP_DEFAULT_PREVIEW_CONVERSATION_ID,
    isQaapPreviewIdentity,
    isQaapPreviewId,
    isQaapProcessPreviewClaimIdentity,
    isQaapProcessPreviewIdentity,
    normalizeQaapPreviewConversationId,
    qaapPreviewProjectIdMatches,
    resolveQaapPreviewIdentity,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
import { normalizeQaapPublicUrl, resolveQaapPublicOrigin } from './qaap-github-oauth-config';
import { QaapDevPreviewTargetHostResolver } from './qaap-dev-preview-target-host';
import { buildQaapPreviewUpstreamHeaders, sanitizeQaapPreviewResponseHeaders } from './qaap-dev-preview-forward-headers';
import { normalizeQaapPreviewBaseDomain } from './qaap-production-auth-readiness';
import { terminateListenersOnPort } from './qaap-dev-preview-port-listener';
import { injectQaapPreviewBridgeLoader } from '@theia/qaap-adapters/lib/common/qaap-preview-bridge-protocol';
import { QAAP_PREVIEW_ACCESS_QUERY } from './qaap-dev-preview-endpoint';
import { TEXT_RESPONSE_PATTERN,LOCAL_TARGET_HOSTNAMES,PROBE_TIMEOUT_MS,QAAP_PREVIEW_ACCESS_COOKIE } from './qaap-dev-preview-endpoint';

export async function forwardHttpExtracted(ctx: any, incoming: Request,
        outgoing: Response,
        targetPort: number,
        targetPath: string,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): Promise<void> {
        const targetHost = await ctx.resolveTargetHost(targetPort);
        if (!targetHost) {
            outgoing.status(503).type('text/html').send(buildDevPreviewWaitingHtml(targetPort));
            return;
        }
        // Qaap session/capability cookies and x-qaap-* internal headers never reach the dev server.
        const headers = buildQaapPreviewUpstreamHeaders(incoming.headers, `localhost:${targetPort}`);
        headers['accept-encoding'] = 'identity';
        delete headers.connection;

        const proxyReq = http.request({
            hostname: targetHost,
            port: targetPort,
            path: targetPath,
            method: incoming.method,
            headers,
        }, proxyRes => {
            const responseHeaders = { ...proxyRes.headers };
            sanitizeQaapPreviewResponseHeaders(responseHeaders);
            // Every proxied preview is rendered inside Qaap's mini-browser. Remove upstream
            // anti-frame headers and scope frame-ancestors to this Qaap origin for identity,
            // legacy-port, and isolated-host preview routes alike.
            ctx.rewritePreviewFrameHeaders(responseHeaders, ctx.resolvePublicOrigin(incoming));
            if (incoming.headers['x-qaap-preview-referer-id']) {
                responseHeaders['cache-control'] = 'private, no-store';
                const vary = String(responseHeaders.vary ?? '').split(',').map(value => value.trim()).filter(Boolean);
                if (!vary.some(value => value.toLowerCase() === 'referer')) {
                    vary.push('Referer');
                }
                responseHeaders.vary = vary.join(', ');
            }
            const location = responseHeaders.location;
            if (typeof location === 'string') {
                responseHeaders.location = ctx.rewriteDevPreviewLocation(location, targetPort, publicPrefix);
            }

            if (!ctx.shouldRewriteProxyBody(proxyRes)) {
                outgoing.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
                proxyRes.pipe(outgoing);
                return;
            }

            delete responseHeaders['content-length'];
            outgoing.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
            const chunks: Buffer[] = [];
            proxyRes.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            proxyRes.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const contentType = proxyRes.headers['content-type'];
                if (typeof contentType !== 'string' || !/\btext\/html\b/i.test(contentType)) {
                    outgoing.end(ctx.rewriteDevPreviewBody(body, targetPort, publicPrefix));
                    return;
                }
                // Next hydrates the server-rendered <html>/<head> tree. Injecting Qaap scripts
                // into <head> makes React mistake them for app-owned metadata (e.g. JSON-LD) and
                // abort hydration. Put its classic bridge scripts at the end of <body>; the
                // browser executes them during parsing, before deferred Next bundles hydrate.
                const isNextDocument = /__next_f|\/_next\/static\//.test(body);
                const placement = isNextDocument ? 'body-end' : 'head';
                // Rewriting Next's server-rendered href/src values changes React-owned props and
                // triggers hydration errors. Its root-relative requests are routed by the
                // referer-scoped fallback middleware; rewrite only actual Next runtime chunks.
                const rewritten = isNextDocument
                    ? rewriteNextPreviewDocument(body, publicPrefix)
                    : ctx.rewriteDevPreviewBody(body, targetPort, publicPrefix);
                const bridged = injectQaapPreviewBridgeLoader(
                    rewritten,
                    ctx.resolvePublicOrigin(incoming),
                    placement,
                );
                const bootstrapped = isNextDocument
                    ? bridged
                    : injectQaapPreviewViteEnvBootstrap(bridged, publicPrefix);
                outgoing.end(injectQaapPreviewDiagnostics(
                    injectQaapPreviewHistoryBase(bootstrapped, publicPrefix, placement),
                    placement,
                ));
            });
        });
        proxyReq.on('error', () => {
            if (!outgoing.headersSent) {
                outgoing.status(503).type('text/html').send(buildDevPreviewWaitingHtml(targetPort));
            } else {
                outgoing.end();
            }
        });
        incoming.pipe(proxyReq);
}

export function rewriteNextPreviewDocument(body: string, publicPrefix: string): string {
    const prefixPath = publicPrefix.replace(/\/+$/, '');
    if (!prefixPath) {
        return body;
    }
    return body.replace(/(__webpack_require__\.p\s*=\s*["'`])\/_next\//g, `$1${prefixPath}/_next/`);
}

export function shouldRewriteProxyBodyExtracted(ctx: any, proxyRes: http.IncomingMessage): boolean {
        const encoding = proxyRes.headers['content-encoding'];
        if (encoding && encoding !== 'identity') {
            return false;
        }
        const contentType = proxyRes.headers['content-type'];
        return typeof contentType === 'string' && TEXT_RESPONSE_PATTERN.test(contentType);
}

export function rewriteDevPreviewLocationExtracted(ctx: any, location: string,
        targetPort: number,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        if (location.startsWith(`${QAAP_DEV_PREVIEW_PREFIX}/`) || location.startsWith(`${QAAP_IDENTITY_PREVIEW_PREFIX}/`)) {
            return location;
        }
        if (location.startsWith('/')) {
            return `${publicPrefix}${location}`;
        }
        try {
            const parsed = new URL(location);
            if (LOCAL_TARGET_HOSTNAMES.has(parsed.hostname)) {
                parsed.host = '';
                return `${publicPrefix}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
        } catch {
            // Relative redirect without a leading slash; leave it untouched.
        }
        return location;
}

export function rewriteDevPreviewBodyExtracted(ctx: any, body: string,
        targetPort: number,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        const prefix = publicPrefix;
        const prefixPath = prefix.replace(/\/+$/, '');
        // NEVER rewrite arbitrary JS string literals: a broad `"/..."` rule corrupted client-side
        // route tables (TanStack/React-Router route paths are absolute-path strings, and route ids
        // concatenate parent+child, compounding the prefix once per tree level — observed live as
        // routeIds like `/qaap-preview/<id>/qaap-preview/<id>/…/_authenticated`, which made every
        // routed SPA render blank under the proxy). Only rewrite positions that are URLs by
        // construction: markup attributes, CSS url(), module specifiers, and fetch() calls.
        //
        // Exception: Vite inlines `import.meta.env = {"BASE_URL": "/"}`. vue-router's
        // `createWebHistory(BASE_URL)` then treats `/qaap-preview/<id>/` as an unknown route
        // (vitesse-lite "Not Found"). Location.pathname is unforgeable in Chromium, so the
        // history-base inject cannot hide the prefix; pin BASE_URL to the proxy path instead.
        const rewritten = body
            .replace(/("BASE_URL"\s*:\s*")\/"/g, `$1${prefixPath}/"`)
            .replace(/('BASE_URL'\s*:\s*')\/'/g, `$1${prefixPath}/'`)
            .replace(/\b(src|href|action)=("|')\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1=$2${prefix}/`)
            .replace(/\burl\(\s*(["']?)\/(?!\/|qaap-(?:dev|preview)\/)/g, `url($1${prefix}/`)
            .replace(/(\bimport\s*(?:\(|[^"'`]*from\s*)?["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
            .replace(/(\bexport\s+[^"'`]*from\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
            .replace(/(\bnew\s+URL\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
            .replace(/(\bfetch\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
            // Next's Webpack runtime loads App Router chunks through its public path. Those
            // URLs are built from this assignment rather than markup/import/fetch syntax, so
            // rewrite this framework-owned asset prefix without touching app route strings.
            .replace(/(__webpack_require__\.p\s*=\s*["'`])\/_next\//g, `$1${prefixPath}/_next/`);
        return ctx.rewriteViteHmrClient(rewritten, prefix);
}

export function rewriteViteHmrClientExtracted(ctx: any, body: string, publicPrefix: string): string {
        if (!publicPrefix
            || !body.includes('[vite] connecting')
            || !body.includes('vite-hmr')
            || !body.includes('Direct websocket connection fallback')
            || !body.includes('import.meta.url')) {
            return body;
        }
        const publicBase = `${publicPrefix.replace(/\/+$/, '')}/`;
        return body
            .replace(/^const socketHost = .*;$/m, `const socketHost = importMetaUrl.host + ${JSON.stringify(publicBase)};`)
            .replace(/^const base = .*;$/m, `const base = ${JSON.stringify(publicBase)};`);
}

export function rewritePreviewCspExtracted(ctx: any, raw: string | string[] | undefined, parentOrigin: string): string {
        const source = Array.isArray(raw) ? raw.join('; ') : raw ?? '';
        const directives = source.split(';').map(item => item.trim()).filter(Boolean);
        let frameAncestorsSeen = false;
        let scriptSourceSeen = false;
        const rewritten = directives.map(directive => {
            const [name, ...values] = directive.split(/\s+/);
            if (name.toLowerCase() === 'frame-ancestors') {
                frameAncestorsSeen = true;
                return `frame-ancestors ${parentOrigin}`;
            }
            if (name.toLowerCase() === 'script-src') {
                scriptSourceSeen = true;
                return values.includes("'unsafe-inline'")
                    ? directive
                    : `${directive} 'unsafe-inline'`;
            }
            return directive;
        });
        if (!frameAncestorsSeen) {
            rewritten.push(`frame-ancestors ${parentOrigin}`);
        }
        const defaultSource = directives.find(directive => directive.toLowerCase().startsWith('default-src '));
        if (!scriptSourceSeen && defaultSource) {
            rewritten.push(`${defaultSource.replace(/^default-src/i, 'script-src')} 'unsafe-inline'`);
        }
        return rewritten.join('; ');
}

export async function probeLocalDevServerExtracted(ctx: any, port: number): Promise<boolean> {
        if (!isAllowedDevPreviewPort(port) || ctx.isIdeListenPort(port)) {
            return false;
        }
        const targetHost = await ctx.resolveTargetHost(port);
        if (!targetHost) {
            return false;
        }
        return new Promise(resolve => {
            const req = http.get({
                host: targetHost,
                port,
                path: '/',
                headers: { host: `localhost:${port}` },
                timeout: PROBE_TIMEOUT_MS,
            }, res => {
                res.resume();
                resolve((res.statusCode ?? 0) > 0);
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.on('error', () => resolve(false));
        });
}

export function resolvePublicOriginExtracted(ctx: any, req: Request): string {
        return resolveQaapPublicOrigin(req);
}

export function buildIdentityPreviewUrlExtracted(ctx: any, req: Request, record: Pick<QaapDevPreviewRecord, 'previewId' | 'accessToken'>): string {
        const baseDomain = ctx.previewBaseDomain();
        if (!baseDomain) {
            return buildQaapIdentityPreviewUrl(ctx.resolvePublicOrigin(req), record.previewId);
        }
        const protocol = ctx.firstHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'https';
        const url = new URL(`${protocol}://${record.previewId}.${baseDomain}/`);
        url.searchParams.set(QAAP_PREVIEW_ACCESS_QUERY, record.accessToken);
        return url.toString();
}

export function previewBaseDomainExtracted(ctx: any): string | undefined {
        // The main origin is also baked into the bridge loader and frame-ancestors policy. Refuse
        // isolated-host mode unless it is explicit; deriving it from the preview Host is unsafe.
        if (!process.env.QAAP_OAUTH_PUBLIC_URL?.trim()) {
            return undefined;
        }
        return normalizeQaapPreviewBaseDomain(process.env.QAAP_PREVIEW_BASE_DOMAIN);
}

export function previewIdFromHostExtracted(ctx: any, req: Request | http.IncomingMessage): string | undefined {
        const baseDomain = ctx.previewBaseDomain();
        if (!baseDomain) {
            return undefined;
        }
        const rawHost = ctx.firstHeaderValue(req.headers['x-forwarded-host'])
            ?? ctx.firstHeaderValue(req.headers.host);
        if (!rawHost) {
            return undefined;
        }
        let hostname: string;
        try {
            hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
        } catch {
            return undefined;
        }
        const domainHostname = baseDomain.replace(/:\d+$/, '');
        const suffix = `.${domainHostname}`;
        if (!hostname.endsWith(suffix)) {
            return undefined;
        }
        const previewId = hostname.slice(0, -suffix.length);
        return isQaapPreviewId(previewId) ? previewId : undefined;
}

export function authorizePreviewHostRequestExtracted(ctx: any, req: Request,
        res: Response,
        record: QaapDevPreviewRecord,): 'allowed' | 'redirected' | 'denied' {
        if (ctx.hasPreviewCapability(req, record)) {
            return 'allowed';
        }
        const requestUrl = new URL(req.originalUrl || req.url || '/', 'http://preview.invalid');
        const queryToken = requestUrl.searchParams.get(QAAP_PREVIEW_ACCESS_QUERY);
        if (!ctx.matchesPreviewToken(queryToken, record.accessToken)) {
            res.status(403).type('text/plain').send('Preview access denied.');
            return 'denied';
        }
        const secure = (ctx.firstHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol) === 'https' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `${QAAP_PREVIEW_ACCESS_COOKIE}=${encodeURIComponent(record.accessToken)}; Path=/; HttpOnly; SameSite=Strict${secure}`);
        requestUrl.searchParams.delete(QAAP_PREVIEW_ACCESS_QUERY);
        res.redirect(302, `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}` || '/');
        return 'redirected';
}

export function hasPreviewCapabilityExtracted(ctx: any, req: Request | http.IncomingMessage, record: QaapDevPreviewRecord): boolean {
        const cookieHeader = ctx.firstHeaderValue(req.headers.cookie);
        if (!cookieHeader) {
            return false;
        }
        for (const part of cookieHeader.split(';')) {
            const [name, ...rest] = part.trim().split('=');
            if (name === QAAP_PREVIEW_ACCESS_COOKIE) {
                try {
                    return ctx.matchesPreviewToken(decodeURIComponent(rest.join('=')), record.accessToken);
                } catch {
                    return false;
                }
            }
        }
        return false;
}

export function matchesPreviewTokenExtracted(ctx: any, candidate: string | null | undefined, expected: string): boolean {
        if (!candidate) {
            return false;
        }
        const left = Buffer.from(candidate);
        const right = Buffer.from(expected);
        return left.length === right.length && timingSafeEqual(left, right);
}

export function firstHeaderValueExtracted(ctx: any, value: string | string[] | undefined): string | undefined {
        if (Array.isArray(value)) {
            return value[0]?.split(',')[0]?.trim();
        }
        return value?.split(',')[0]?.trim();
}


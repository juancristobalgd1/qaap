// Extracted from qaap-dev-preview-endpoint.ts

import type { Request, Response } from '@theia/core/shared/express';
import * as http from 'http';
import { timingSafeEqual } from 'crypto';
import { parseQaapPreviewIdFromHost, resolveQaapPreviewBaseDomain } from './qaap-preview-host';
import { resolveQaapPublicOrigin } from './qaap-github-oauth-config';
import type { QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import { buildQaapPreviewUpstreamHeaders, sanitizeQaapPreviewResponseHeaders } from './qaap-dev-preview-forward-headers';
import { buildQaapPreviewBridgeLoaderScript } from '@theia/qaap-adapters/lib/common/qaap-preview-bridge-protocol';
import { QaapDevPreviewStreamingRewriter, type QaapDevPreviewRewriteRule } from './qaap-dev-preview-streaming-rewriter';
import {
    QAAP_DEV_PREVIEW_PREFIX,
    QAAP_DEV_PREVIEW_WAITING_HEADER,
    QAAP_IDENTITY_PREVIEW_PREFIX,
    buildDevPreviewWaitingHtml,
    buildQaapIdentityPreviewUrl,
    buildQaapPreviewTrailingScripts,
    injectQaapPreviewDocumentScripts,
    isQaapDevPreviewServedResponse,
    isAllowedDevPreviewPort,
} from '../common/qaap-dev-preview';
import { QAAP_PREVIEW_ACCESS_QUERY } from './qaap-dev-preview-endpoint';
import { TEXT_RESPONSE_PATTERN, LOCAL_TARGET_HOSTNAMES, PROBE_TIMEOUT_MS, QAAP_PREVIEW_ACCESS_COOKIE } from './qaap-dev-preview-endpoint';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';

export async function forwardHttpExtracted(ctx: QaapDevPreviewEndpointContext, incoming: Request,
        outgoing: Response,
        targetPort: number,
        targetPath: string,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): Promise<void> {
        const targetHost = await ctx.resolveTargetHost(targetPort);
        if (!targetHost) {
            sendDevPreviewUnavailable(incoming, outgoing, targetPort);
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
            // Tunnelled runtimes (hosted workers) are reached through their own agent.
            agent: ctx.upstreamAgentFor(targetPort),
        }, proxyRes => {
            clearTimeout(headersTimer);
            // The upstream body can fail mid-stream (dev server restart): end the browser response with it.
            proxyRes.on('error', () => outgoing.destroy());
            const responseHeaders = { ...proxyRes.headers };
            sanitizeQaapPreviewResponseHeaders(responseHeaders);
            // Only the proxy's own holding 503 may carry the waiting marker.
            delete responseHeaders[QAAP_DEV_PREVIEW_WAITING_HEADER];
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

            const statusCode = proxyRes.statusCode ?? 502;
            const contentType = proxyRes.headers['content-type'];
            const isHtml = typeof contentType === 'string' && /\btext\/html\b/i.test(contentType);
            if (!ctx.shouldRewriteProxyBody(proxyRes)
                // No body to rewrite: keep content-length (HEAD reports the GET size).
                || incoming.method === 'HEAD' || statusCode === 204 || statusCode === 304) {
                outgoing.writeHead(statusCode, responseHeaders);
                proxyRes.pipe(outgoing);
                return;
            }

            delete responseHeaders['content-length'];
            outgoing.writeHead(statusCode, responseHeaders);
            // Bodies past the look-ahead continue through a chunk-boundary-safe streaming rewriter
            // (bounded memory, same output as the buffered rule for matches up to its overlap).
            const streamRest = (rewriter: QaapDevPreviewStreamingRewriter, trailer: string): void => {
                proxyRes.on('data', (next: Buffer) => {
                    const rewritten = rewriter.write(next);
                    if (rewritten && !outgoing.write(rewritten)) {
                        proxyRes.pause();
                        outgoing.once('drain', () => proxyRes.resume());
                    }
                });
                proxyRes.on('end', () => outgoing.end(rewriter.end() + trailer));
            };
            if (!isHtml && Number(proxyRes.headers['content-length']) > MAX_REWRITE_BODY_BYTES) {
                // Large JS/CSS (vendor bundles): no look-ahead needed. The Vite HMR client
                // special-case only applies to the small, buffered `/@vite/client` module.
                streamRest(new QaapDevPreviewStreamingRewriter(devPreviewBodyUrlRule(publicPrefix)), '');
                return;
            }
            const chunks: Buffer[] = [];
            let bufferedBytes = 0;
            const onData = (chunk: Buffer | string): void => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                chunks.push(buffer);
                bufferedBytes += buffer.length;
                if (bufferedBytes <= MAX_REWRITE_BODY_BYTES) {
                    return;
                }
                // The body outgrew the cap: stop buffering and stream the rest.
                proxyRes.off('data', onData);
                proxyRes.off('end', onEnd);
                const buffered = Buffer.concat(chunks);
                chunks.length = 0;
                if (!isHtml) {
                    const rewriter = new QaapDevPreviewStreamingRewriter(devPreviewBodyUrlRule(publicPrefix));
                    outgoing.write(rewriter.write(buffered));
                    streamRest(rewriter, '');
                    return;
                }
                // HTML keeps its URL rewrite through a chunk-boundary-safe streaming rewriter; the
                // bridge scripts go into the look-ahead (or a trailer for Next's body-end).
                const isNextDocument = isNextPreviewDocument(buffered);
                const rewriter = new QaapDevPreviewStreamingRewriter(isNextDocument
                    ? nextPreviewDocumentRule(publicPrefix)
                    : devPreviewBodyUrlRule(publicPrefix));
                const { html, trailer } = injectPreviewHtmlScripts(ctx, incoming, rewriter.write(buffered), publicPrefix, isNextDocument, true);
                outgoing.write(html);
                streamRest(rewriter, trailer);
            };
            const onEnd = (): void => {
                const body = Buffer.concat(chunks).toString('utf8');
                if (!isHtml) {
                    outgoing.end(ctx.rewriteDevPreviewBody(body, targetPort, publicPrefix));
                    return;
                }
                // Rewriting Next's server-rendered href/src values changes React-owned props and
                // triggers hydration errors. Its root-relative requests are routed by the
                // referer-scoped fallback middleware; rewrite only actual Next runtime chunks.
                const isNextDocument = isNextPreviewDocument(body);
                const rewritten = isNextDocument
                    ? rewriteNextPreviewDocument(body, publicPrefix)
                    : ctx.rewriteDevPreviewBody(body, targetPort, publicPrefix);
                outgoing.end(injectPreviewHtmlScripts(ctx, incoming, rewritten, publicPrefix, isNextDocument, false).html);
            };
            proxyRes.on('data', onData);
            proxyRes.on('end', onEnd);
        });
        // A dev server that accepts the connection but never answers used to hang the iframe
        // forever. Bound only the wait for response headers: streamed bodies (SSE HMR) stay open.
        const headersTimer = setTimeout(() => proxyReq.destroy(new Error('dev server response timeout')), DEV_PREVIEW_HEADERS_TIMEOUT_MS);
        proxyReq.on('error', () => {
            clearTimeout(headersTimer);
            ctx.invalidateTargetHost(targetPort);
            if (!outgoing.headersSent) {
                sendDevPreviewUnavailable(incoming, outgoing, targetPort);
            } else {
                outgoing.end();
            }
        });
        // Browser went away (reload, closed tab) before the response finished. `incoming` 'aborted' does not fire
        // for a GET whose body is already complete, and a paused stream would otherwise wait for a 'drain'
        // that never comes: release the dev-server connection from the response side.
        outgoing.on('close', () => {
            clearTimeout(headersTimer);
            if (!outgoing.writableFinished) {
                proxyReq.destroy();
            }
        });
        incoming.pipe(proxyReq);
}

const DEV_PREVIEW_HEADERS_TIMEOUT_MS = 60_000;

function isNextPreviewDocument(body: string | Buffer): boolean {
    return body.includes('__next_f') || body.includes('/_next/static/');
}

/**
 * Injects the bridge loader and preview scripts into an already rewritten HTML document in one
 * insertion. Next hydrates the server-rendered <html>/<head> tree: Qaap scripts in <head> are
 * mistaken for app-owned metadata (e.g. JSON-LD) and abort hydration, so Next gets them at the end
 * of <body>, where they still execute during parsing, before deferred Next bundles hydrate.
 * `truncated` means `html` is only the look-ahead of a streamed document: head placement still
 * patches it, while Next's body-end scripts come back as a `trailer` for the end of the stream.
 */
function injectPreviewHtmlScripts(
    ctx: QaapDevPreviewEndpointContext,
    incoming: Request,
    html: string,
    publicPrefix: string,
    isNextDocument: boolean,
    truncated: boolean,
): { html: string; trailer: string } {
    const bridge = buildQaapPreviewBridgeLoaderScript(html || ' ', ctx.resolvePublicOrigin(incoming));
    if (truncated && isNextDocument) {
        return { html, trailer: bridge + buildQaapPreviewTrailingScripts(html, publicPrefix) };
    }
    const placement = isNextDocument ? 'body-end' : 'head';
    return { html: injectQaapPreviewDocumentScripts(html, publicPrefix, placement, !isNextDocument, html ? bridge : ''), trailer: '' };
}

/** Text bodies above this size are rewritten by streaming instead of being buffered whole. */
export const MAX_REWRITE_BODY_BYTES = 5 * 1024 * 1024;

/**
 * The holding page is only useful for document loads. Scripts/styles/fetches that received it
 * were parsed as HTML (syntax errors, MIME blocks) and each re-ran the auto-reload.
 */
function sendDevPreviewUnavailable(incoming: Request, outgoing: Response, targetPort: number): void {
    const dest = String(incoming.headers['sec-fetch-dest'] ?? '');
    const accept = String(incoming.headers.accept ?? '');
    const isDocument = dest ? dest === 'document' || dest === 'iframe' : /\btext\/html\b/i.test(accept);
    outgoing.setHeader('cache-control', 'no-store');
    outgoing.setHeader('retry-after', '2');
    outgoing.setHeader(QAAP_DEV_PREVIEW_WAITING_HEADER, '1');
    if (isDocument && incoming.method !== 'HEAD') {
        outgoing.status(503).type('text/html').send(buildDevPreviewWaitingHtml(targetPort));
    } else {
        outgoing.status(503).type('text/plain').send(`Dev server on port ${targetPort} is not reachable yet.`);
    }
}

export function rewriteNextPreviewDocument(body: string, publicPrefix: string): string {
    const rule = nextPreviewDocumentRule(publicPrefix);
    return body.replace(rule.pattern, rule.replace);
}

/** Next's Webpack public path is the only URL rewritten in Next documents (hydration-safe). */
export function nextPreviewDocumentRule(publicPrefix: string): QaapDevPreviewRewriteRule {
    const prefixPath = publicPrefix.replace(/\/+$/, '');
    return { pattern: NEXT_PUBLIC_PATH_PATTERN, replace: (_match, lead) => `${lead}${prefixPath}/` };
}

const NEXT_PUBLIC_PATH_PATTERN = /(__webpack_require__\.p\s*=\s*["'`])\/(?=_next\/)/g;

export function shouldRewriteProxyBodyExtracted(ctx: QaapDevPreviewEndpointContext, proxyRes: http.IncomingMessage): boolean {
        const encoding = proxyRes.headers['content-encoding'];
        if (encoding && encoding !== 'identity') {
            return false;
        }
        const contentType = proxyRes.headers['content-type'];
        return typeof contentType === 'string' && TEXT_RESPONSE_PATTERN.test(contentType);
}

export function rewriteDevPreviewLocationExtracted(ctx: QaapDevPreviewEndpointContext, location: string,
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

export function rewriteDevPreviewBodyExtracted(ctx: QaapDevPreviewEndpointContext, body: string,
        targetPort: number,
        publicPrefix: string = `${QAAP_DEV_PREVIEW_PREFIX}/${targetPort}`,): string {
        const prefix = publicPrefix;
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
        // One pass over the body: every rule is an alternative of DEV_PREVIEW_BODY_URL_PATTERN.
        const rule = devPreviewBodyUrlRule(prefix);
        const rewritten = body.replace(rule.pattern, rule.replace);
        return ctx.rewriteViteHmrClient(rewritten, prefix);
}

/** The single-pass URL rewrite of proxied HTML/JS/CSS bodies (see DEV_PREVIEW_BODY_URL_PATTERN). */
export function devPreviewBodyUrlRule(publicPrefix: string): QaapDevPreviewRewriteRule {
    const prefix = publicPrefix;
    const prefixPath = prefix.replace(/\/+$/, '');
    return {
        pattern: DEV_PREVIEW_BODY_URL_PATTERN,
        replace: (_match, ...groups) => {
            const [baseDouble, baseSingle, markup, cssUrlQuote, importLead, exportLead, newUrlLead, fetchLead, webpackLead] = groups;
            if (baseDouble !== undefined || baseSingle !== undefined) {
                return `${baseDouble ?? baseSingle}${prefixPath}/`;
            }
            if (cssUrlQuote !== undefined) {
                return `url(${cssUrlQuote}${prefix}/`;
            }
            if (webpackLead !== undefined) {
                return `${webpackLead}${prefixPath}/`;
            }
            return `${markup ?? importLead ?? exportLead ?? newUrlLead ?? fetchLead}${prefix}/`;
        },
    };
}

export function rewriteViteHmrClientExtracted(ctx: QaapDevPreviewEndpointContext, body: string, publicPrefix: string): string {
        // `[vite] connecting` + the `vite-hmr` subprotocol identify `/@vite/client` in Vite 4–7;
        // application modules that merely declare `socketHost`/`base` must stay untouched.
        if (!publicPrefix || !body.includes('[vite] connecting') || !body.includes('vite-hmr')) {
            return body;
        }
        const publicBase = JSON.stringify(`${publicPrefix.replace(/\/+$/, '')}/`);
        // Older clients bind `importMetaUrl`; fall back to import.meta.url if a release drops it.
        const hostExpression = /\bimportMetaUrl\b/.test(body) ? 'importMetaUrl.host' : 'new URL(import.meta.url).host';
        let socketHostRewritten = false;
        const rewritten = body
            // Top-level single-line declarations in every Vite 4–7 client (defines already
            // substituted); tolerant of let/var, spacing and the substituted expression's shape.
            .replace(VITE_SOCKET_HOST_DECLARATION, (_match, keyword: string) => {
                socketHostRewritten = true;
                return `${keyword} socketHost = ${hostExpression} + ${publicBase};`;
            })
            // `base` drives hot-update imports; `base$1` (Vite 5+) drives overlay/open-in-editor fetches.
            .replace(VITE_BASE_DECLARATION, (_match, keyword: string, name: string) => `${keyword} ${name} = ${publicBase};`);
        if (!socketHostRewritten && !viteHmrRewriteMissLogged) {
            viteHmrRewriteMissLogged = true;
            console.debug('[qaap-preview] Vite HMR client detected but its socketHost declaration was not recognized; HMR may bypass the preview proxy.');
        }
        return rewritten;
}

/**
 * Every URL-by-construction position rewritten in proxied bodies, as one alternation so the body
 * is scanned once. Each alternative captures the text preceding the rewritten `/`:
 * 1–2 Vite `BASE_URL` (`"/"` only), 3 markup `src|href|action=`, 4 the quote of CSS `url(`,
 * 5–6 `import`/`export … from` (ES clause grammar with a bounded `{…}` so it stays linear on
 * quote-poor bundles), 7 `new URL(`, 8 `fetch(`, 9 Next's `__webpack_require__.p = "/_next/"`.
 * 3–8 skip protocol-relative (`//`) and already-proxied paths.
 */
const DEV_PREVIEW_BODY_URL_PATTERN = new RegExp([
    /("BASE_URL"\s*:\s*")\/(?=")/,
    /('BASE_URL'\s*:\s*')\/(?=')/,
    /(\b(?:src|href|action)=["'])\/(?!\/|qaap-(?:dev|preview)\/)/,
    /\burl\(\s*(["']?)\/(?!\/|qaap-(?:dev|preview)\/)/,
    /(\bimport\s*(?:\(|(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+\s*|\{[^{}"'`]{0,4096}\}\s*)?from\s*)?["'`])\/(?!\/|qaap-(?:dev|preview)\/)/,
    /(\bexport\s+(?:type\s+)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^{}"'`]{0,4096}\})\s*from\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/,
    /(\bnew\s+URL\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/,
    /(\bfetch\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/,
    /(__webpack_require__\.p\s*=\s*["'`])\/(?=_next\/)/,
].map(pattern => pattern.source).join('|'), 'g');
const VITE_SOCKET_HOST_DECLARATION = /^(const|let|var)[ \t]+socketHost[ \t]*=[^\n]*;[ \t]*$/m;
const VITE_BASE_DECLARATION = /^(const|let|var)[ \t]+(base(?:\$\d+)?)[ \t]*=[^\n]*;[ \t]*$/gm;
let viteHmrRewriteMissLogged = false;

export function rewritePreviewCspExtracted(ctx: QaapDevPreviewEndpointContext, raw: string | number | string[] | undefined, parentOrigin: string): string {
        // `http.OutgoingHttpHeaders` values are typed as `string | number | string[]`, but a CSP
        // header is never legitimately a bare number; normalize defensively instead of calling
        // `.split` on a number (an @ts-nocheck-era bug that would throw at runtime).
        const source = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : '';
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

export async function probeLocalDevServerExtracted(ctx: QaapDevPreviewEndpointContext, port: number, ownerLogin?: string): Promise<boolean> {
        if (!isAllowedDevPreviewPort(port) || ctx.isIdeListenPort(port)) {
            return false;
        }
        const targetHost = await ctx.resolveTargetHost(port, ownerLogin);
        if (!targetHost) {
            return false;
        }
        // HEAD skips SSR rendering on every readiness check. Fall back to GET only when HEAD is
        // unsupported (405/501) or unanswered (timeout, reset, parse error) — never on a refused
        // connection, where GET cannot fare better. Each attempt keeps the same timeout.
        // Ports whose server rejected or ignored HEAD while answering GET go straight to GET
        // for a while, so 405-on-HEAD servers don't pay a double request on every probe.
        const headlessPorts = headUnsupportedPorts(ctx);
        const skipHead = (headlessPorts.get(port) ?? 0) > Date.now();
        const head = skipHead ? 'unsupported' : await probeDevServerOnce(ctx, targetHost, port, 'HEAD');
        if (head === 'refused') {
            return false;
        }
        if (typeof head === 'boolean') {
            return head;
        }
        const get = await probeDevServerOnce(ctx, targetHost, port, 'GET');
        if (typeof get !== 'boolean') {
            headlessPorts.delete(port);
            return false;
        }
        if (!skipHead) {
            headlessPorts.set(port, Date.now() + HEAD_UNSUPPORTED_TTL_MS);
        }
        return get;
}

/** How long a port stays in the "HEAD unsupported" cache (ports get reused by new servers). */
export const HEAD_UNSUPPORTED_TTL_MS = 5 * 60_000;
const headUnsupportedByEndpoint = new WeakMap<QaapDevPreviewEndpointContext, Map<number, number>>();

/** Drops the cached "HEAD unsupported" verdict for `port` (its preview claim changed hands). */
export function forgetHeadUnsupportedPort(ctx: QaapDevPreviewEndpointContext, port: number): void {
    headUnsupportedByEndpoint.get(ctx)?.delete(port);
}

function headUnsupportedPorts(ctx: QaapDevPreviewEndpointContext): Map<number, number> {
    let ports = headUnsupportedByEndpoint.get(ctx);
    if (!ports) {
        ports = new Map();
        headUnsupportedByEndpoint.set(ctx, ports);
    }
    return ports;
}

/** `true`/`false` per the served rule, `'unsupported'` (405/501), `'refused'` or `'failed'`. */
function probeDevServerOnce(
    ctx: QaapDevPreviewEndpointContext,
    targetHost: string,
    port: number,
    method: 'HEAD' | 'GET',
): Promise<boolean | 'unsupported' | 'refused' | 'failed'> {
    return new Promise(resolve => {
        const req = http.request({
            host: targetHost,
            port,
            path: '/',
            method,
            headers: { host: `localhost:${port}` },
            timeout: PROBE_TIMEOUT_MS,
            agent: ctx.upstreamAgentFor(port),
        }, res => {
            res.resume();
            const status = res.statusCode ?? 0;
            // Same rule as the holding page: the app's own answers (even 503) are served.
            resolve(method === 'HEAD' && (status === 405 || status === 501)
                ? 'unsupported'
                : isQaapDevPreviewServedResponse(status, ctx.firstHeaderValue(res.headers[QAAP_DEV_PREVIEW_WAITING_HEADER])));
        });
        req.on('timeout', () => {
            req.destroy();
            resolve('failed');
        });
        req.on('error', error => resolve((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'refused' : 'failed'));
        req.end();
    });
}

export function resolvePublicOriginExtracted(ctx: QaapDevPreviewEndpointContext, req: Request): string {
        return resolveQaapPublicOrigin(req);
}

export function buildIdentityPreviewUrlExtracted(ctx: QaapDevPreviewEndpointContext, req: Request, record: Pick<QaapDevPreviewRecord, 'previewId' | 'accessToken'>): string {
        const baseDomain = ctx.previewBaseDomain();
        if (!baseDomain) {
            return buildQaapIdentityPreviewUrl(ctx.resolvePublicOrigin(req), record.previewId);
        }
        const protocol = ctx.firstHeaderValue(req.headers['x-forwarded-proto']) ?? req.protocol ?? 'https';
        const url = new URL(`${protocol}://${record.previewId}.${baseDomain}/`);
        url.searchParams.set(QAAP_PREVIEW_ACCESS_QUERY, record.accessToken);
        return url.toString();
}

export function previewBaseDomainExtracted(ctx: QaapDevPreviewEndpointContext): string | undefined {
        return resolveQaapPreviewBaseDomain();
}

export function previewIdFromHostExtracted(ctx: QaapDevPreviewEndpointContext, req: Request | http.IncomingMessage): string | undefined {
        const rawHost = ctx.firstHeaderValue(req.headers['x-forwarded-host'])
            ?? ctx.firstHeaderValue(req.headers.host);
        return parseQaapPreviewIdFromHost(rawHost, ctx.previewBaseDomain());
}

export function authorizePreviewHostRequestExtracted(ctx: QaapDevPreviewEndpointContext, req: Request,
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

export function hasPreviewCapabilityExtracted(ctx: QaapDevPreviewEndpointContext, req: Request | http.IncomingMessage, record: QaapDevPreviewRecord): boolean {
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

export function matchesPreviewTokenExtracted(ctx: QaapDevPreviewEndpointContext, candidate: string | null | undefined, expected: string): boolean {
        if (!candidate) {
            return false;
        }
        const left = Buffer.from(candidate);
        const right = Buffer.from(expected);
        return left.length === right.length && timingSafeEqual(left, right);
}

export function firstHeaderValueExtracted(ctx: QaapDevPreviewEndpointContext, value: string | string[] | undefined): string | undefined {
        if (Array.isArray(value)) {
            return value[0]?.split(',')[0]?.trim();
        }
        return value?.split(',')[0]?.trim();
}


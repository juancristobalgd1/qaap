// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Application, Request, Response } from '@theia/core/shared/express';
import * as http from 'http';
import * as net from 'net';
import { AddressInfo } from 'net';
import { QaapDevPreviewEndpoint } from './qaap-dev-preview-endpoint';
import { MAX_REWRITE_BODY_BYTES } from './qaap-dev-preview-endpoint-timeline';
import { holdUpgradeSocket, proxyWebSocketExtracted } from './qaap-dev-preview-endpoint-streaming';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';
import type { QaapGithubAuthGuard } from './qaap-github-auth-guard';
import type { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';
import { buildQaapPreviewBridgeLoader, injectQaapPreviewBridgeLoader } from '@theia/qaap-adapters/lib/common/qaap-preview-bridge-protocol';
import { injectQaapPreviewDocumentScripts } from '../common/qaap-dev-preview';

/** The chained multi-pass rewrite this module replaced; kept as the equivalence oracle. */
function legacyChainedRewrite(body: string, prefix: string): string {
    const prefixPath = prefix.replace(/\/+$/, '');
    return body
        .replace(/("BASE_URL"\s*:\s*")\/"/g, `$1${prefixPath}/"`)
        .replace(/('BASE_URL'\s*:\s*')\/'/g, `$1${prefixPath}/'`)
        .replace(/\b(src|href|action)=("|')\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1=$2${prefix}/`)
        .replace(/\burl\(\s*(["']?)\/(?!\/|qaap-(?:dev|preview)\/)/g, `url($1${prefix}/`)
        .replace(/(\bimport\s*(?:\(|(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+\s*|\{[^{}"'`]{0,4096}\}\s*)?from\s*)?["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g,
            `$1${prefix}/`)
        .replace(/(\bexport\s+(?:type\s+)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^{}"'`]{0,4096}\})\s*from\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
        .replace(/(\bnew\s+URL\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
        .replace(/(\bfetch\(\s*["'`])\/(?!\/|qaap-(?:dev|preview)\/)/g, `$1${prefix}/`)
        .replace(/(__webpack_require__\.p\s*=\s*["'`])\/_next\//g, `$1${prefixPath}/_next/`);
}

const REWRITE_CORPUS = [
    '<script type="module" src="/src/main.tsx"></script><link href=\'/styles.css\' rel="stylesheet"><form action="/login">',
    '<img src="//cdn.test/a.png"><a href="/qaap-dev/5173/x">x</a><a href="/qaap-preview/abc/y">y</a>',
    'import "/@vite/client";\nimport React, { useState as s } from "/node_modules/.vite/deps/react.js?v=1";',
    'import * as ns from \'/src/ns.ts\'; import type { T } from "/src/types.ts"; import def from`/tpl.js`;',
    'export * from "/src/all.js"; export * as all from "/src/all.js"; export { a, b as c } from "/src/ab.js";',
    'const w = new URL( "/src/worker.js", import.meta.url); fetch("/api/items"); fetch(`/api/${id}`);',
    '.hero { background: url(/assets/bg.png) } .b { background: url( "/a.png") } .c { background: url(\'//cdn/x.png\') }',
    'import.meta.env = {"BASE_URL": "/", "MODE": "development"}; const env = {\'BASE_URL\': \'/\'}; const other = {"BASE_URL": "/app/"};',
    '__webpack_require__.p = "/_next/"; __webpack_require__.p="/static/";',
    'const route = createFileRoute("/_authenticated/")({ path: "/settings" }); const s = "import from export";',
    'import(`/src/lazy.js`).then(m => fetch(\'/x\', { method: "POST" })); url(url("/nested.png"))',
    'importScripts("/sw.js"); exported = "/not-a-module"; src="/ok.js" SRC="/upper.js"',
    '',
];

class ProxyTestEndpoint extends QaapDevPreviewEndpoint {
    forwarded: Array<{ port: number; path: string; prefix: string | undefined }> = [];

    override resolveTargetHost(): Promise<string | undefined> {
        return Promise.resolve(this.targetHost);
    }

    override resolvePublicOrigin(): string {
        return 'http://ide.test';
    }

    override isIdeListenPort(port: number): boolean {
        return port === 3000;
    }

    targetHost: string | undefined = '127.0.0.1';
    captureForward = false;

    override async forwardHttp(incoming: Request, outgoing: Response, targetPort: number, targetPath: string, publicPrefix?: string): Promise<void> {
        if (this.captureForward) {
            this.forwarded.push({ port: targetPort, path: targetPath, prefix: publicPrefix });
            return;
        }
        return super.forwardHttp(incoming, outgoing, targetPort, targetPath, publicPrefix);
    }

    useFakes(login: string | undefined, portOwner: string | undefined): void {
        const mutable = this as unknown as { auth: QaapGithubAuthGuard; portRegistry: QaapDevPreviewPortRegistry };
        mutable.auth = {
            authenticate: () => (login ? { kind: 'authenticated', userLogin: login, session: {}, sessionId: 's' } : { kind: 'unauthorized' }),
            resolveUserLogin: () => login,
        } as unknown as QaapGithubAuthGuard;
        mutable.portRegistry = {
            ownerOf: () => portOwner,
            touch: () => undefined,
        } as unknown as QaapDevPreviewPortRegistry;
    }
}

interface ProxiedResponse {
    readonly status: number;
    readonly headers: http.IncomingHttpHeaders;
    readonly body: string;
}

describe('QaapDevPreviewEndpoint proxy transport', () => {

    it('single-pass body rewrite matches the legacy chained rewrite on the fixture corpus', () => {
        const endpoint = new ProxyTestEndpoint();
        const combined = REWRITE_CORPUS.join('\n');
        for (const prefix of ['/qaap-dev/5173', '/qaap-preview/u-alice-w-site-p-site-x-run-abc1234', '']) {
            for (const sample of [...REWRITE_CORPUS, combined]) {
                expect(endpoint.rewriteDevPreviewBody(sample, 5173, prefix), `${prefix}: ${sample}`)
                    .to.equal(legacyChainedRewrite(sample, prefix));
            }
        }
    });

    describe('forwardHttp buffering', () => {
        let upstream: http.Server;
        let front: http.Server;
        let upstreamPort: number;
        let frontPort: number;
        let upstreamHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
        const endpoint = new ProxyTestEndpoint();

        before(async () => {
            upstream = http.createServer((req, res) => upstreamHandler(req, res));
            front = http.createServer((req, res) => {
                // Minimal express surface forwardHttp touches on the outgoing response.
                const outgoing: object = Object.assign(res, {
                    status(code: number): unknown { res.statusCode = code; return outgoing; },
                    type(value: string): unknown { res.setHeader('content-type', value); return outgoing; },
                    send(value: string): unknown { res.end(value); return outgoing; },
                });
                void endpoint.forwardHttp(req as unknown as Request, outgoing as unknown as Response, upstreamPort, req.url ?? '/');
            });
            await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
            await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
            upstreamPort = (upstream.address() as AddressInfo).port;
            frontPort = (front.address() as AddressInfo).port;
        });

        after(() => {
            upstream.close();
            front.close();
        });

        const request = (method: string, path: string, headers: http.OutgoingHttpHeaders = {}): Promise<ProxiedResponse> =>
            new Promise((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port: frontPort, method, path, headers }, res => {
                    const chunks: Buffer[] = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
                });
                req.on('error', reject);
                req.end();
            });

        const moduleSource = 'import "/src/a.js";';

        it('rewrites small JS bodies and drops the stale content-length', async () => {
            upstreamHandler = (_req, res) => {
                res.writeHead(200, { 'content-type': 'application/javascript', 'content-length': Buffer.byteLength(moduleSource) });
                res.end(moduleSource);
            };
            const response = await request('GET', '/a.js');
            expect(response.body).to.equal(`import "/qaap-dev/${upstreamPort}/src/a.js";`);
            expect(response.headers['content-length']).to.equal(undefined);
        });

        it('keeps content-length for HEAD and 304 responses', async () => {
            upstreamHandler = (_req, res) => {
                res.writeHead(200, { 'content-type': 'application/javascript', 'content-length': '1234' });
                res.end();
            };
            expect((await request('HEAD', '/a.js')).headers['content-length']).to.equal('1234');
            upstreamHandler = (_req, res) => {
                res.writeHead(304, { 'content-type': 'application/javascript', etag: '"x"' });
                res.end();
            };
            const notModified = await request('GET', '/a.js');
            expect(notModified.status).to.equal(304);
            expect(notModified.headers.etag).to.equal('"x"');
        });

        it('stream-rewrites large JS exactly like the buffered rewrite, with or without a declared length', async () => {
            const prefix = `/qaap-dev/${upstreamPort}`;
            const unit = 'import a from "/src/a.js"; fetch("/api/x"); const s = "/not-a-url"; new URL(`/w.js`, import.meta.url);\n';
            const large = unit.repeat(Math.ceil((MAX_REWRITE_BODY_BYTES + 1) / unit.length)) + 'export * from "/end.js";';
            const expected = endpoint.rewriteDevPreviewBody(large, upstreamPort, prefix);
            upstreamHandler = (_req, res) => {
                res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': Buffer.byteLength(large) });
                res.end(large);
            };
            const declared = await request('GET', '/vendor.js');
            expect(declared.headers['content-length']).to.equal(undefined);
            expect(declared.body).to.equal(expected);

            upstreamHandler = (_req, res) => {
                res.writeHead(200, { 'content-type': 'text/javascript' });
                res.write(large.slice(0, 1021));
                res.end(large.slice(1021));
            };
            const chunked = await request('GET', '/vendor.js');
            expect(chunked.body).to.equal(expected);
        });

        const serveHtml = (html: string, chunked: boolean): void => {
            upstreamHandler = (_req, res) => {
                res.writeHead(200, chunked
                    ? { 'content-type': 'text/html; charset=utf-8' }
                    : { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
                if (chunked) {
                    res.write(html.slice(0, 7));
                    res.end(html.slice(7));
                } else {
                    res.end(html);
                }
            };
        };

        it('renders small HTML with all preview scripts in one insertion (Vite and Next)', async () => {
            const prefix = `/qaap-dev/${upstreamPort}`;
            const documents = [
                '<!doctype html><html><head><script type="module" src="/@vite/client"></script></head><body><div id="app"></div></body></html>',
                '<html><head><link href="/_next/static/css/app.css"></head><body><script>self.__next_f=[]</script></body></html>',
            ];
            for (const html of documents) {
                const isNext = html.includes('_next/static');
                const placement = isNext ? 'body-end' : 'head';
                const rewritten = isNext ? html : endpoint.rewriteDevPreviewBody(html, upstreamPort, prefix);
                // Next (body-end) is byte-identical to the former two-pass bridge + scripts output;
                // head placement now puts the bridge after the other scripts right after <head>.
                const expected = injectQaapPreviewDocumentScripts(rewritten, prefix, placement, !isNext, buildQaapPreviewBridgeLoader('http://ide.test'));
                if (isNext) {
                    expect(expected).to.equal(injectQaapPreviewDocumentScripts(
                        injectQaapPreviewBridgeLoader(rewritten, 'http://ide.test', placement), prefix, placement, false));
                }
                for (const chunked of [false, true]) {
                    serveHtml(html, chunked);
                    expect((await request('GET', '/')).body).to.equal(expected);
                }
            }
        });

        it('streams huge HTML after patching the head look-ahead', async () => {
            const tail = '<p>tail é</p><img src="/tail.png">'.repeat(10);
            const html = '<html><head><title>big</title></head><body><img src="/logo.png">'
                + '<p>x</p>'.repeat(Math.ceil(MAX_REWRITE_BODY_BYTES / 8)) + tail + '</body></html>';
            serveHtml(html, true);
            const body = (await request('GET', '/')).body;
            const head = body.slice(0, body.indexOf('</head>'));
            expect(head).to.contain('data-qaap-preview-bridge-loader');
            expect(head).to.contain('data-qaap-preview-history-base');
            expect(body).to.contain(`<img src="/qaap-dev/${upstreamPort}/logo.png">`);
            // The tail beyond the look-ahead is still rewritten, with chunk-boundary-safe streaming.
            expect(body.endsWith(`${tail.split('src="/tail.png"').join(`src="/qaap-dev/${upstreamPort}/tail.png"`)}</body></html>`)).to.equal(true);
            expect(body.length - html.length).to.be.greaterThan(0);
        });

        it('appends Next body-end scripts after a huge streamed document', async () => {
            const html = '<html><head><script src="/_next/static/chunks/main.js"></script></head><body>'
                + '<p>x</p>'.repeat(Math.ceil(MAX_REWRITE_BODY_BYTES / 8)) + '</body></html>';
            serveHtml(html, false);
            const body = (await request('GET', '/'));
            expect(body.headers['content-length']).to.equal(undefined);
            expect(body.body.startsWith(html)).to.equal(true);
            const trailer = body.body.slice(html.length);
            expect(trailer.indexOf('data-qaap-preview-bridge-loader')).to.be.lessThan(trailer.indexOf('data-qaap-preview-history-base'));
            expect(trailer.indexOf('data-qaap-preview-history-base')).to.be.lessThan(trailer.indexOf('data-qaap-preview-diagnostics'));
        });

        it('probe treats the app\'s own 503 as served and the proxy-marked 503 as not ready', async () => {
            upstreamHandler = (_req, res) => {
                res.writeHead(503);
                res.end();
            };
            expect(await endpoint.probeLocalDevServer(upstreamPort)).to.equal(true);
            upstreamHandler = (_req, res) => {
                res.writeHead(503, { 'x-qaap-preview-waiting': '1' });
                res.end();
            };
            expect(await endpoint.probeLocalDevServer(upstreamPort)).to.equal(false);
        });

        it('probe uses HEAD and falls back to GET only when HEAD is unsupported or unanswered', async function (): Promise<void> {
            this.timeout(10_000);
            const methods: string[] = [];
            upstreamHandler = (req, res) => {
                methods.push(req.method ?? '');
                res.writeHead(404);
                res.end();
            };
            expect(await endpoint.probeLocalDevServer(upstreamPort)).to.equal(true);
            expect(methods).to.deep.equal(['HEAD']);

            methods.length = 0;
            upstreamHandler = (req, res) => {
                methods.push(req.method ?? '');
                res.writeHead(req.method === 'HEAD' ? 405 : 503, req.method === 'HEAD' ? {} : { 'x-qaap-preview-waiting': '1' });
                res.end();
            };
            const headless = new ProxyTestEndpoint();
            expect(await headless.probeLocalDevServer(upstreamPort)).to.equal(false);
            expect(methods).to.deep.equal(['HEAD', 'GET']);
            // Cached per endpoint and port: the next probe skips the rejected HEAD.
            methods.length = 0;
            expect(await headless.probeLocalDevServer(upstreamPort)).to.equal(false);
            expect(methods).to.deep.equal(['GET']);

            methods.length = 0;
            upstreamHandler = (req, res) => {
                methods.push(req.method ?? '');
                if (req.method === 'GET') {
                    res.writeHead(200);
                    res.end();
                }
                // HEAD hangs: the probe times out and retries with GET.
            };
            expect(await new ProxyTestEndpoint().probeLocalDevServer(upstreamPort)).to.equal(true);
            expect(methods).to.deep.equal(['HEAD', 'GET']);
        });

        it('probe does not retry a refused connection', async () => {
            const closed = http.createServer();
            await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
            const port = (closed.address() as AddressInfo).port;
            await new Promise<void>(resolve => closed.close(() => resolve()));
            const startedAt = Date.now();
            expect(await endpoint.probeLocalDevServer(port)).to.equal(false);
            expect(Date.now() - startedAt).to.be.lessThan(1000);
        });

        it('strips a spoofed waiting marker from upstream and sets it on its own 503', async () => {
            upstreamHandler = (_req, res) => {
                res.writeHead(503, { 'content-type': 'text/plain', 'x-qaap-preview-waiting': '1' });
                res.end('busy');
            };
            const appUnavailable = await request('GET', '/');
            expect(appUnavailable.status).to.equal(503);
            expect(appUnavailable.headers['x-qaap-preview-waiting']).to.equal(undefined);

            endpoint.targetHost = undefined;
            try {
                const waiting = await request('GET', '/', { accept: 'text/html', 'sec-fetch-dest': 'document' });
                expect(waiting.status).to.equal(503);
                expect(waiting.headers['x-qaap-preview-waiting']).to.equal('1');
                expect(waiting.body).to.contain('Starting dev server');
            } finally {
                endpoint.targetHost = '127.0.0.1';
            }
        });
    });

    describe('Referer fallback for legacy /qaap-dev/:port previews', () => {
        type Middleware = (req: unknown, res: unknown, next: () => void) => void;

        const refererMiddleware = (endpoint: ProxyTestEndpoint): Middleware => {
            const handlers: Middleware[] = [];
            const app = {
                use: (...args: unknown[]) => { handlers.push(args[args.length - 1] as Middleware); },
                get: () => undefined,
                post: () => undefined,
            };
            endpoint.configure(app as unknown as Application);
            return handlers[handlers.length - 1];
        };

        const fakeRequest = (referer: string, headers: Record<string, string> = {}): Record<string, unknown> => {
            const all: Record<string, string> = { referer, ...headers };
            return {
                path: '/_next/static/chunk.js',
                url: '/_next/static/chunk.js',
                originalUrl: '/_next/static/chunk.js',
                method: 'GET',
                headers: all,
                get: (name: string) => all[name.toLowerCase()],
            };
        };

        const fakeResponse = (): { statusCode?: number; redirectedTo?: string } & Record<string, unknown> => {
            const res: { statusCode?: number; redirectedTo?: string } & Record<string, unknown> = {};
            res.status = (code: number) => { res.statusCode = code; return res; };
            res.type = () => res;
            res.send = () => res;
            res.redirect = (code: number, target: string) => { res.statusCode = code; res.redirectedTo = target; };
            return res;
        };

        it('forwards sub-resources of an owned legacy preview under its port prefix', () => {
            const endpoint = new ProxyTestEndpoint();
            endpoint.useFakes('alice', 'alice');
            endpoint.captureForward = true;
            const req = fakeRequest('http://ide.test/qaap-dev/5173/');
            let nextCalled = false;
            refererMiddleware(endpoint)(req, fakeResponse(), () => { nextCalled = true; });
            expect(nextCalled).to.equal(false);
            expect(endpoint.forwarded).to.deep.equal([{ port: 5173, path: '/_next/static/chunk.js', prefix: '/qaap-dev/5173' }]);
            expect((req.headers as Record<string, string>)['x-qaap-preview-referer-id']).to.equal('5173');
        });

        it('redirects document navigations back under the port prefix', () => {
            const endpoint = new ProxyTestEndpoint();
            endpoint.useFakes('alice', 'alice');
            endpoint.captureForward = true;
            const res = fakeResponse();
            refererMiddleware(endpoint)(fakeRequest('http://ide.test/qaap-dev/5173/', { 'sec-fetch-dest': 'document' }), res, () => undefined);
            expect(res.statusCode).to.equal(307);
            expect(res.redirectedTo).to.equal('/qaap-dev/5173/_next/static/chunk.js');
        });

        it('denies ports owned by another tenant, the IDE port and anonymous callers', () => {
            const endpoint = new ProxyTestEndpoint();
            endpoint.captureForward = true;
            endpoint.useFakes('bob', 'alice');
            const foreign = fakeResponse();
            refererMiddleware(endpoint)(fakeRequest('http://ide.test/qaap-dev/5173/'), foreign, () => undefined);
            expect(foreign.statusCode).to.equal(403);

            endpoint.useFakes('alice', 'alice');
            const ide = fakeResponse();
            refererMiddleware(endpoint)(fakeRequest('http://ide.test/qaap-dev/3000/'), ide, () => undefined);
            expect(ide.statusCode).to.equal(403);

            endpoint.useFakes(undefined, 'alice');
            const anonymous = fakeResponse();
            refererMiddleware(endpoint)(fakeRequest('http://ide.test/qaap-dev/5173/'), anonymous, () => undefined);
            expect(anonymous.statusCode).to.equal(401);
            expect(endpoint.forwarded).to.deep.equal([]);
        });

        it('ignores cross-origin and non-preview referers', () => {
            const endpoint = new ProxyTestEndpoint();
            endpoint.useFakes('alice', 'alice');
            endpoint.captureForward = true;
            let nextCalls = 0;
            const middleware = refererMiddleware(endpoint);
            middleware(fakeRequest('http://evil.test/qaap-dev/5173/'), fakeResponse(), () => { nextCalls++; });
            middleware(fakeRequest('http://ide.test/workspace'), fakeResponse(), () => { nextCalls++; });
            expect(nextCalls).to.equal(2);
            expect(endpoint.forwarded).to.deep.equal([]);
        });
    });

    it('answers 504 and closes both sides when the dev server never completes the upgrade', async () => {
        let upstreamClosed!: Promise<void>;
        const silent = net.createServer(upstreamSocket => {
            upstreamClosed = new Promise(resolve => upstreamSocket.once('close', () => resolve()));
            upstreamSocket.resume(); // consume the request so the proxy's FIN surfaces as 'close'
        });
        await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
        const port = (silent.address() as AddressInfo).port;
        const [client, proxied] = await new Promise<[net.Socket, net.Socket]>(resolve => {
            const pair = net.createServer(serverSide => resolve([clientSide, serverSide]));
            const clientSide = new net.Socket();
            pair.listen(0, '127.0.0.1', () => clientSide.connect((pair.address() as AddressInfo).port, '127.0.0.1'));
            clientSide.once('close', () => pair.close());
        });
        const received: Buffer[] = [];
        client.on('data', chunk => received.push(chunk));
        const clientClosed = new Promise<void>(resolve => client.once('close', () => resolve()));
        const ctx = {
            resolveTargetHost: () => Promise.resolve('127.0.0.1'),
            invalidateTargetHost: () => undefined,
        } as unknown as QaapDevPreviewEndpointContext;
        const request = { method: 'GET', headers: { upgrade: 'websocket', connection: 'Upgrade' } } as unknown as http.IncomingMessage;
        try {
            await proxyWebSocketExtracted(ctx, request, proxied, Buffer.alloc(0), port, '/_next/webpack-hmr', 50);
            await clientClosed;
            expect(Buffer.concat(received).toString()).to.contain('504 Gateway Timeout');
            expect(proxied.bytesWritten).to.be.greaterThan(0);
            // Resolves only once the proxy tore down its upstream connection.
            await upstreamClosed;
        } finally {
            client.destroy();
            silent.close();
        }
    });

    it('holdUpgradeSocket masks bytesWritten until released', () => {
        const socket = new net.Socket();
        const release = holdUpgradeSocket(socket);
        expect(socket.bytesWritten).to.equal(1);
        release();
        release();
        expect(socket.bytesWritten).to.equal(0);
        socket.destroy();
    });
});

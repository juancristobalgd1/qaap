// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { AddressInfo } from 'net';
import * as express from '@theia/core/shared/express';
import {
    QaapFrontendStaticServer,
    qaapBrotliCandidatePath,
    qaapNormalizeVersionedFrontendEntryAssetRequest,
    qaapUncompressedBaseName,
} from './qaap-immutable-chunk-cache-contribution';

const ENTRY_HASH = 'c'.repeat(64);

class TestFrontendStaticServer extends QaapFrontendStaticServer {
    /** Same order as BackendApplication: core's gzip routes, then contributions, then static files. */
    createApp(frontendDir: string): express.Application {
        const app = express();
        // QaapFrontendStaticServer's early middleware.
        app.use((req, _res, next) => {
            qaapNormalizeVersionedFrontendEntryAssetRequest(req);
            next();
        });
        app.get('*.js', (req, res, next) => this.coreServeGzipped('text/javascript', frontendDir, req, res, next));
        app.get('*.css', (req, res, next) => this.coreServeGzipped('text/css', frontendDir, req, res, next));
        app.use((req, res, next) => this.serveBrotli(req, res, next, frontendDir));
        app.use(express.static(frontendDir, {
            setHeaders: (res, filePath) => this.setStaticHeaders(res, filePath, frontendDir),
        }));
        return app;
    }

    /** Mirrors `BackendApplication.serveGzipped` in @theia/core. */
    protected coreServeGzipped(contentType: string, frontendDir: string, req: express.Request, res: express.Response, next: express.NextFunction): void {
        const gzUrl = `${req.url}.gz`;
        if (req.acceptsEncodings().indexOf('gzip') === -1 || !fs.existsSync(path.join(frontendDir, gzUrl))) {
            next();
            return;
        }
        req.url = gzUrl;
        res.set('Content-Encoding', 'gzip');
        res.set('Content-Type', contentType);
        next();
    }
}

interface FetchedAsset {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

describe('QaapFrontendStaticServer brotli', () => {

    describe('candidate paths', () => {

        it('accepts top-level compressible assets, also after the gzip handler rewrote them', () => {
            expect(qaapBrotliCandidatePath('/bundle.js', false)).to.equal('/bundle.js');
            expect(qaapBrotliCandidatePath('/bundle.js.gz', true)).to.equal('/bundle.js');
            expect(qaapBrotliCandidatePath('/chunk-ABC123.css', false)).to.equal('/chunk-ABC123.css');
            expect(qaapBrotliCandidatePath('/editor.worker.js', false)).to.equal('/editor.worker.js');
            expect(qaapBrotliCandidatePath('/vscode-oniguruma.wasm', false)).to.equal('/vscode-oniguruma.wasm');
            expect(qaapBrotliCandidatePath('/chunk-ABC123.ttf', false)).to.equal('/chunk-ABC123.ttf');
            expect(qaapBrotliCandidatePath('/chunk-ABC123.eot', false)).to.equal('/chunk-ABC123.eot');
            // woff/woff2 are compressed formats already: never a .br lookup.
            expect(qaapBrotliCandidatePath('/chunk-ABC123.woff2', false)).to.equal(undefined);
        });

        it('rejects nested, queried, traversing and non-compressible paths', () => {
            for (const url of [
                '/',
                '/index.html',
                '/bundle.js.map',
                '/bundle.js?v=1',
                '/bundle.js.gz',
                '/nested/chunk-ABC123.js',
                '/..%2Fsecret.js',
                '/%2e%2e/secret.js',
                '/qaap-preview/abc/main.js',
                '/bad%zz.js',
                'bundle.js',
            ]) {
                expect(qaapBrotliCandidatePath(url, false), url).to.equal(undefined);
            }
        });

        it('strips pre-compression suffixes from served file names', () => {
            expect(qaapUncompressedBaseName('/x/service-worker.js.br')).to.equal('service-worker.js');
            expect(qaapUncompressedBaseName('/x/chunk-ABC.js.gz')).to.equal('chunk-ABC.js');
            expect(qaapUncompressedBaseName('/x/bundle.js')).to.equal('bundle.js');
        });
    });

    describe('serving', () => {

        const script = 'console.log("qaap");\n'.repeat(400);
        let frontendDir: string;
        let server: http.Server;
        let port: number;

        before(async () => {
            frontendDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-brotli-'));
            for (const name of ['chunk-ABC123.js', 'bundle.js', 'service-worker.js']) {
                fs.writeFileSync(path.join(frontendDir, name), script);
                fs.writeFileSync(path.join(frontendDir, name + '.gz'), zlib.gzipSync(script));
                fs.writeFileSync(path.join(frontendDir, name + '.br'), zlib.brotliCompressSync(script));
            }
            fs.writeFileSync(path.join(frontendDir, 'index.html'), `<script src="./bundle.js?qaap-build=${ENTRY_HASH}"></script>`);
            fs.writeFileSync(path.join(frontendDir, 'no-brotli.js'), script);
            fs.writeFileSync(path.join(frontendDir, 'no-brotli.js.gz'), zlib.gzipSync(script));
            fs.mkdirSync(path.join(frontendDir, 'nested'));
            fs.writeFileSync(path.join(frontendDir, 'nested', 'chunk-ABC123.js'), script);
            fs.writeFileSync(path.join(frontendDir, 'nested', 'chunk-ABC123.js.br'), zlib.brotliCompressSync(script));
            server = new TestFrontendStaticServer().createApp(frontendDir).listen(0, '127.0.0.1');
            await new Promise<void>(resolve => server.once('listening', () => resolve()));
            port = (server.address() as AddressInfo).port;
        });

        after(async () => {
            await new Promise<void>(resolve => server.close(() => resolve()));
            fs.rmSync(frontendDir, { recursive: true, force: true });
        });

        function get(url: string, acceptEncoding?: string, method = 'GET'): Promise<FetchedAsset> {
            return new Promise((resolve, reject) => {
                const headers: http.OutgoingHttpHeaders = acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding };
                http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
                    const chunks: Buffer[] = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
                }).on('error', reject).end();
            });
        }

        it('serves the .br sibling with the original content type and immutable caching', async () => {
            const res = await get('/chunk-ABC123.js', 'gzip, deflate, br');
            expect(res.status).to.equal(200);
            expect(res.headers['content-encoding']).to.equal('br');
            expect(res.headers['content-type']).to.match(/^text\/javascript/);
            expect(res.headers['cache-control']).to.equal('public, max-age=31536000, immutable');
            expect(res.headers.vary).to.match(/Accept-Encoding/i);
            expect(zlib.brotliDecompressSync(res.body).toString()).to.equal(script);
        });

        it('serves the fingerprinted entry bundle as brotli with immutable caching', async () => {
            const res = await get(`/bundle.js?qaap-build=${ENTRY_HASH}`, 'gzip, deflate, br, zstd');
            expect(res.headers['content-encoding']).to.equal('br');
            expect(res.headers['cache-control']).to.equal('public, max-age=31536000, immutable');
            expect(zlib.brotliDecompressSync(res.body).toString()).to.equal(script);
        });

        it('keeps gzip for clients that do not accept brotli', async () => {
            for (const acceptEncoding of ['gzip', 'gzip, br;q=0']) {
                const res = await get('/chunk-ABC123.js', acceptEncoding);
                expect(res.headers['content-encoding'], acceptEncoding).to.equal('gzip');
                expect(zlib.gunzipSync(res.body).toString()).to.equal(script);
            }
        });

        it('serves brotli to a brotli-only client', async () => {
            const res = await get('/bundle.js', 'br');
            expect(res.headers['content-encoding']).to.equal('br');
            expect(zlib.brotliDecompressSync(res.body).toString()).to.equal(script);
        });

        it('serves the raw file without Accept-Encoding', async () => {
            const res = await get('/bundle.js', '');
            expect(res.headers['content-encoding']).to.equal(undefined);
            expect(res.body.toString()).to.equal(script);
        });

        it('falls back to gzip when the build has no .br sibling', async () => {
            const res = await get('/no-brotli.js', 'gzip, br');
            expect(res.headers['content-encoding']).to.equal('gzip');
            expect(zlib.gunzipSync(res.body).toString()).to.equal(script);
        });

        it('does not serve brotli below the top level of the frontend directory', async () => {
            const res = await get('/nested/chunk-ABC123.js', 'br');
            expect(res.headers['content-encoding']).to.equal(undefined);
            expect(res.body.toString()).to.equal(script);
        });

        it('keeps the service worker revalidated when it is served compressed', async () => {
            const res = await get('/service-worker.js', 'gzip, br');
            expect(res.headers['content-encoding']).to.equal('br');
            expect(res.headers['cache-control']).to.equal('no-cache, no-store, must-revalidate');
            expect(res.headers['service-worker-allowed']).to.equal('/');
        });

        it('answers HEAD requests with the brotli representation headers', async () => {
            const res = await get('/bundle.js', 'br', 'HEAD');
            expect(res.status).to.equal(200);
            expect(res.headers['content-encoding']).to.equal('br');
            expect(res.body.length).to.equal(0);
        });

        it('gives the brotli, gzip and raw representations distinct ETags', async () => {
            const etags = await Promise.all(['br', 'gzip', ''].map(async encoding => (await get('/bundle.js', encoding)).headers.etag));
            expect(new Set(etags).size).to.equal(3);
        });
    });
});

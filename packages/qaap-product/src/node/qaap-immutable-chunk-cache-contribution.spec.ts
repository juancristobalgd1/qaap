// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as express from '@theia/core/shared/express';
import { BackendApplicationPath } from '@theia/core/lib/node';
import {
    qaapFrontendStaticHeaders,
    qaapIsImmutableHashedChunkPath,
    qaapPreferredStaticEncoding,
    QaapFrontendStaticServer,
    resolveQaapLegalPagesDir,
} from './qaap-immutable-chunk-cache-contribution';

class StaticAssetServerHarness extends QaapFrontendStaticServer {
    serve(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
        return this.servePrecompressedAsset(req, res, next);
    }
}

describe('qaap immutable frontend asset policy', () => {

    it('matches hashed entries and chunks, including .map and compression suffixes', () => {
        const samples = [
            '/bundle-ABCD1234.js',
            '/bundle-ABCD1234.css',
            '/bundle-ABCD1234.js.br',
            '/bundle-ABCD1234.css.gz',
            '/chunk-ABCD1234.js',
            '/chunk-ABCD1234.css',
            '/chunk-ABCD1234.js.map',
            '/chunk-ABCD1234.css.map',
            '/chunk-ABCD1234.js.gz',
            '/chunk-ABCD1234.css.gz',
            '/chunk-ABCD1234.js.map.gz',
            '/chunk-A1B2C3D4.js',
        ];
        for (const sample of samples) {
            expect(qaapIsImmutableHashedChunkPath(sample), sample).to.equal(true);
        }
    });

    it('sets immutable headers only on hashed assets and revalidates the shell and unhashed entries', () => {
        const frontendDir = path.resolve('app/lib/frontend');
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'bundle-A1B2C3D4.js'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'public, max-age=31536000, immutable' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'chunk-A1B2C3D4.css.br'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'public, max-age=31536000, immutable' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'bundle.js'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'no-cache' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'bundle.css'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'no-cache' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'index.html'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'no-cache' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'service-worker.js'), frontendDir))
            .to.deep.equal({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Service-Worker-Allowed': '/',
                'Content-Type': 'application/javascript; charset=utf-8',
            });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'bundle-A1B2C3D4.js'), path.join(frontendDir, 'nested')))
            .to.deep.equal({});
    });

    it('negotiates Brotli before gzip while respecting quality values', () => {
        expect(qaapPreferredStaticEncoding('br, gzip', true, true)).to.equal('br');
        expect(qaapPreferredStaticEncoding('br, gzip', false, true)).to.equal('gzip');
        expect(qaapPreferredStaticEncoding('gzip;q=1, br;q=0.7', true, true)).to.equal('gzip');
        expect(qaapPreferredStaticEncoding('br;q=0, gzip;q=0.8', true, true)).to.equal('gzip');
        expect(qaapPreferredStaticEncoding('br;q=0, gzip;q=0', true, true)).to.equal(undefined);
        expect(qaapPreferredStaticEncoding('gzip', false, true)).to.equal('gzip');
    });

    it('serves precompressed hashed assets with Vary and keeps gzip as the fallback', async () => {
        const frontendDir = path.join(BackendApplicationPath, 'lib', 'frontend');
        const missingDirectories: string[] = [];
        let directory = frontendDir;
        while (!fs.existsSync(directory)) {
            missingDirectories.push(directory);
            directory = path.dirname(directory);
        }
        fs.mkdirSync(frontendDir, { recursive: true });

        const hash = randomBytes(6).toString('hex').toUpperCase();
        const filename = `bundle-${hash}.js`;
        const sourcePath = path.join(frontendDir, filename);
        const brotliPath = `${sourcePath}.br`;
        const gzipPath = `${sourcePath}.gz`;
        fs.writeFileSync(sourcePath, 'source');
        fs.writeFileSync(brotliPath, 'brotli');
        fs.writeFileSync(gzipPath, 'gzip');

        try {
            const server = new StaticAssetServerHarness();
            const serve = async (acceptEncoding: string): Promise<{
                headers: Record<string, string>;
                sentPath: string | undefined;
                nextCalled: boolean;
            }> => {
                const headers: Record<string, string> = {};
                let sentPath: string | undefined;
                let nextCalled = false;
                const req = {
                    method: 'GET',
                    path: `/${filename}`,
                    get: (name: string) => name.toLowerCase() === 'accept-encoding' ? acceptEncoding : undefined,
                } as unknown as express.Request;
                const res = {
                    setHeader: (name: string, value: string | number) => { headers[name] = String(value); },
                    sendFile: (filePath: string, _options: unknown, callback: () => void) => {
                        sentPath = filePath;
                        callback();
                    },
                } as unknown as express.Response;

                await server.serve(req, res, () => { nextCalled = true; });
                return { headers, sentPath, nextCalled };
            };

            const brotli = await serve('br, gzip');
            expect(brotli.sentPath).to.equal(brotliPath);
            expect(brotli.headers).to.include({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Content-Encoding': 'br',
                'Content-Type': 'text/javascript',
                Vary: 'Accept-Encoding',
            });
            expect(brotli.nextCalled).to.equal(false);

            const gzip = await serve('br;q=0, gzip');
            expect(gzip.sentPath).to.equal(gzipPath);
            expect(gzip.headers['Content-Encoding']).to.equal('gzip');
            expect(gzip.headers.Vary).to.equal('Accept-Encoding');
            expect(gzip.nextCalled).to.equal(false);
        } finally {
            fs.rmSync(sourcePath, { force: true });
            fs.rmSync(brotliPath, { force: true });
            fs.rmSync(gzipPath, { force: true });
            for (const missingDirectory of missingDirectories) {
                fs.rmdirSync(missingDirectory);
            }
        }
    });

    it('does not match non-hashed frontend assets', () => {
        const samples = [
            '/bundle.js',
            '/bundle.js.map',
            '/index.html',
            '/worker.js',
            '/manifest.webmanifest',
            '/service-worker.js',
            '/chunk-abcd1234.js', // lower-case hash is not the esbuild hash format
            // Note: nested paths are guarded at the server level (top-level dirname check);
            // the matcher itself is basename-scoped.
            '/chunk-ABCD1234.png',
        ];
        for (const sample of samples) {
            expect(qaapIsImmutableHashedChunkPath(sample), sample).to.equal(false);
        }
    });

    it('keeps immutable chunk bytes untouched in the frontend static sync', () => {
        // A query stamp written into a chunk after esbuild hashed it makes one immutable URL
        // carry different bytes per build and duplicates the module graph after a rebuild.
        const sync = fs.readFileSync(
            path.resolve(__dirname, '../../../../examples/browser/scripts/copy-frontend-static.mjs'),
            'utf8',
        );
        expect(sync).to.include('verifyFrontendChunkGraph();');
        expect(sync).to.not.match(/\$2\?qaap-build=/);
        expect(sync).to.not.include('patchFrontendChunkImports');
    });

    it('resolves packaged legal HTML from the qaap-product resources tree', () => {
        const legalDir = resolveQaapLegalPagesDir();
        expect(path.basename(legalDir)).to.equal('legal');
        expect(fs.existsSync(path.join(legalDir, 'terms.html'))).to.equal(true);
        expect(fs.existsSync(path.join(legalDir, 'privacy.html'))).to.equal(true);
        expect(fs.existsSync(path.join(legalDir, 'legal.css'))).to.equal(true);
    });

});

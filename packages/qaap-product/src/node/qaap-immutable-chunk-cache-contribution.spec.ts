// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    qaapFrontendStaticHeaders,
    qaapIsImmutableHashedChunkPath,
    qaapPreferredStaticEncoding,
    resolveQaapLegalPagesDir,
} from './qaap-immutable-chunk-cache-contribution';

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

    it('sets immutable headers only on hashed entry/chunk assets and keeps the shell revalidated', () => {
        const frontendDir = path.resolve('app/lib/frontend');
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'bundle-A1B2C3D4.js'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'public, max-age=31536000, immutable' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'chunk-A1B2C3D4.css.br'), frontendDir))
            .to.deep.equal({ 'Cache-Control': 'public, max-age=31536000, immutable' });
        expect(qaapFrontendStaticHeaders(path.join(frontendDir, 'bundle.js'), frontendDir)).to.deep.equal({});
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
        expect(qaapPreferredStaticEncoding('gzip;q=1, br;q=0.7', true, true)).to.equal('gzip');
        expect(qaapPreferredStaticEncoding('br;q=0, gzip;q=0.8', true, true)).to.equal('gzip');
        expect(qaapPreferredStaticEncoding('br;q=0, gzip;q=0', true, true)).to.equal(undefined);
        expect(qaapPreferredStaticEncoding('gzip', false, true)).to.equal('gzip');
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

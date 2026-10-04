// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    qaapIsImmutableHashedChunkPath,
    qaapIsVersionedFrontendEntryAssetRequest,
    resolveQaapLegalPagesDir,
} from './qaap-immutable-chunk-cache-contribution';

describe('qaap-immutable-chunk-cache-contribution patterns', () => {

    it('matches hashed chunk js/css assets, including .map and .gz suffixes', () => {
        const samples = [
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

    it('matches only fingerprinted top-level frontend entry asset requests', () => {
        const hash = 'a'.repeat(64);
        for (const asset of ['bundle.js', 'bundle.css', 'qaap-login-gate.js']) {
            expect(qaapIsVersionedFrontendEntryAssetRequest(`/${asset}?qaap-build=${hash}`), asset).to.equal(true);
        }
        const samples = [
            `/bundle.js?qaap-build=${'a'.repeat(63)}`,
            `/bundle.js?qaap-build=${'A'.repeat(64)}`,
            `/bundle.js?qaap-build=${hash}&qaap-build=${hash}`,
            `/bundle.js?qaap-build=${hash}&other=1`,
            `/chunk-ABCD1234.js?qaap-build=${hash}`,
            `/nested/bundle.js?qaap-build=${hash}`,
            '/bundle.js',
        ];
        for (const sample of samples) {
            expect(qaapIsVersionedFrontendEntryAssetRequest(sample), sample).to.equal(false);
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
        expect(sync).to.include("createHash('sha256')");
        expect(sync).to.not.include('Date.now().toString(36)');
        expect(sync).to.not.match(/\$2\?qaap-build=/);
        expect(sync).to.not.include('patchFrontendChunkImports');
    });

    it('requires fresh compressed JS and CSS entry assets in frontend builds', () => {
        const sync = fs.readFileSync(
            path.resolve(__dirname, '../../../../examples/browser/scripts/copy-frontend-static.mjs'),
            'utf8',
        );
        expect(sync).to.include("const REQUIRED_GZIP_ASSETS = ['bundle.js', 'bundle.css']");
        expect(sync).to.include('Required pre-compressed frontend assets are missing or stale');
        expect(sync).to.include('fs.renameSync(temporaryGzPath, gzPath)');
    });

    it('resolves packaged legal HTML from the qaap-product resources tree', () => {
        const legalDir = resolveQaapLegalPagesDir();
        expect(path.basename(legalDir)).to.equal('legal');
        expect(fs.existsSync(path.join(legalDir, 'terms.html'))).to.equal(true);
        expect(fs.existsSync(path.join(legalDir, 'privacy.html'))).to.equal(true);
        expect(fs.existsSync(path.join(legalDir, 'legal.css'))).to.equal(true);
    });

});

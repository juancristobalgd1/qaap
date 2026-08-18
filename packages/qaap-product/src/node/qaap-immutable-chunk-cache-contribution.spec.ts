// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { qaapIsImmutableHashedChunkPath, resolveQaapLegalPagesDir } from './qaap-immutable-chunk-cache-contribution';

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

    it('resolves packaged legal HTML from the qaap-product resources tree', () => {
        const legalDir = resolveQaapLegalPagesDir();
        expect(path.basename(legalDir)).to.equal('legal');
        expect(fs.existsSync(path.join(legalDir, 'terms.html'))).to.equal(true);
        expect(fs.existsSync(path.join(legalDir, 'privacy.html'))).to.equal(true);
        expect(fs.existsSync(path.join(legalDir, 'legal.css'))).to.equal(true);
    });

});

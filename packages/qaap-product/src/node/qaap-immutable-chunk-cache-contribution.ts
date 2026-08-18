// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import * as fs from 'fs';
import { injectable } from '@theia/core/shared/inversify';
import * as express from '@theia/core/shared/express';
import { BackendApplicationServer, BackendApplicationPath } from '@theia/core/lib/node';

/**
 * esbuild emits content-addressed frontend chunks as `chunk-<hash>.(js|css)`, optionally followed
 * by a `.map` sourcemap suffix and/or a precompressed `.gz` suffix. Any file matching this pattern
 * is safe to cache forever: a content change always produces a new hash, so the old URL is never
 * reused for different bytes.
 */
const HASHED_CHUNK_FILE_PATTERN = /^chunk-[A-Z0-9]+\.(js|css)(\.map)?(\.gz)?$/;

/** @internal Exported for unit tests only. Accepts URL paths and filesystem paths alike. */
export function qaapIsImmutableHashedChunkPath(filePath: string): boolean {
    return HASHED_CHUNK_FILE_PATTERN.test(path.posix.basename(filePath.replace(/\\/g, '/')));
}

/** Directory of standalone Terms / Privacy HTML served at `/legal/*`. */
export function resolveQaapLegalPagesDir(): string {
    const candidates = [
        // Copied next to the frontend bundle (the backend webpack bundle's `__dirname` is not the package).
        path.join(BackendApplicationPath, 'lib', 'frontend', 'legal'),
        path.resolve(__dirname, '../../resources/legal'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'terms.html'))) {
            return candidate;
        }
    }
    return candidates[candidates.length - 1];
}

/**
 * Serves `lib/frontend` with long-term caching for hashed, content-addressed chunks,
 * and the packaged `/legal/*` Terms of Use and Privacy Notice (no bundle required).
 *
 * The generated `src-gen/backend/server.js` only binds its default static server when no
 * {@link BackendApplicationServer} is bound yet (`if (!container.isBound(...))`), so this binding
 * is the sanctioned seam to own frontend static serving. It replicates the generated defaults
 * (service worker / manifest / shell HTML must never be cached long-term) and adds the
 * chunk-immutable branch: `Cache-Control: public, max-age=31536000, immutable` for hashed chunks,
 * while `bundle.js` and other non-hashed assets keep the default revalidated behavior.
 */
@injectable()
export class QaapFrontendStaticServer implements BackendApplicationServer {

    configure(app: express.Application): void {
        const legalDir = resolveQaapLegalPagesDir();
        app.use('/legal', express.static(legalDir, {
            index: false,
            setHeaders: res => {
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('X-Content-Type-Options', 'nosniff');
            },
        }));
        const frontendDir = path.join(BackendApplicationPath, 'lib', 'frontend');
        app.use(express.static(frontendDir, {
            setHeaders: (res, filePath) => this.setStaticHeaders(res, filePath, frontendDir),
        }));
    }

    protected setStaticHeaders(res: express.Response, filePath: string, frontendDir: string): void {
        const base = path.basename(filePath);
        const topLevel = path.dirname(filePath) === frontendDir;
        if (base === 'service-worker.js') {
            // The service worker controls a wider scope than its own location and must not be
            // cached by the browser for long — users would otherwise be stuck on stale workers.
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Service-Worker-Allowed', '/');
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (base === 'manifest.webmanifest') {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        } else if (base === 'index.html' || base === 'secondary-window.html') {
            // The shell HTML is small and references hashed chunk URLs — never cache it
            // long-term, otherwise stale shells will reference deleted bundle hashes.
            res.setHeader('Cache-Control', 'no-cache');
        } else if (topLevel && qaapIsImmutableHashedChunkPath(base)) {
            // esbuild only ever emits hashed chunks at the top level of
            // lib/frontend — nested lookalikes are not content-addressed.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}

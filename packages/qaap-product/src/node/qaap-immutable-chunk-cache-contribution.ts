// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import * as fs from 'fs';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as express from '@theia/core/shared/express';
import { BackendApplicationServer, BackendApplicationPath, EarlyExpressMiddleware } from '@theia/core/lib/node';

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

/** @internal Exported for unit tests only. */
export function qaapGetVersionedFrontendEntryAssetPath(requestUrl: string): string | undefined {
    let url: URL;
    try {
        url = new URL(requestUrl, 'http://qaap.local');
    } catch {
        return undefined;
    }
    if (!['/bundle.js', '/bundle.css', '/qaap-login-gate.js'].includes(url.pathname)) {
        return undefined;
    }
    const buildHashes = url.searchParams.getAll('qaap-build');
    if (buildHashes.length !== 1 || !/^[a-f0-9]{64}$/.test(buildHashes[0])
        || url.searchParams.toString() !== `qaap-build=${buildHashes[0]}`) {
        return undefined;
    }
    return url.pathname;
}

/** @internal Exported for unit tests only. */
export function qaapIsVersionedFrontendEntryAssetRequest(requestUrl: string): boolean {
    return qaapGetVersionedFrontendEntryAssetPath(requestUrl) !== undefined;
}

/** @internal Exported for unit tests only. */
export function qaapNormalizeVersionedFrontendEntryAssetRequest(request: { url: string; originalUrl?: string }): void {
    const assetPath = qaapGetVersionedFrontendEntryAssetPath(request.originalUrl || request.url);
    if (assetPath) {
        request.url = assetPath;
    }
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
 * chunk-immutable branch: `Cache-Control: public, max-age=31536000, immutable` for hashed chunks
 * and content-fingerprinted entry URLs, while unversioned assets keep the default behavior.
 */
@injectable()
export class QaapFrontendStaticServer implements BackendApplicationServer {

    @inject(EarlyExpressMiddleware)
    protected readonly earlyMiddleware: EarlyExpressMiddleware;

    initialize(): void {
        this.earlyMiddleware.handlers.push((req, _res, next) => {
            // The core gzip handler appends `.gz` to req.url. Remove the validated query
            // there so bundle.js?qaap-build=<hash> resolves its bundle.js.gz sibling;
            // originalUrl remains intact for cache headers and tenant routing.
            qaapNormalizeVersionedFrontendEntryAssetRequest(req);
            next();
        });
    }

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
        } else if (topLevel && qaapIsVersionedFrontendEntryAssetRequest(
            (res.req as express.Request | undefined)?.originalUrl ?? '',
        )) {
            // serveGzipped rewrites req.url to the .gz sibling before static serving.
            // originalUrl still identifies the fingerprinted entry URL in the index.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}

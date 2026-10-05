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
 * by a `.map` sourcemap suffix and/or a precompressed `.gz` / `.br` suffix, and the stylesheet fonts
 * as `chunk-<hash>.(woff2|woff|ttf|eot|svg)` (examples/browser/esbuild.mjs `assetNames`). Any file matching this pattern
 * is safe to cache forever: a content change always produces a new hash, so the old URL is never
 * reused for different bytes.
 */
const HASHED_CHUNK_FILE_PATTERN = /^chunk-[A-Z0-9]+\.(?:(?:js|css)(?:\.map)?|woff2?|ttf|eot|svg)(?:\.gz|\.br)?$/;

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
    if (!['/bundle.js', '/bundle.mobile.js', '/bundle.css', '/qaap-login-gate.js'].includes(url.pathname)) {
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

/**
 * @internal Exported for unit tests only. True only when the request carries the fingerprint of the
 * build currently on disk: a client holding an older index (deploy race, offline shell) must not
 * cache today's bytes for a year under yesterday's URL.
 */
export function qaapIsCurrentFrontendEntryAssetRequest(requestUrl: string, currentBuildHash: string | undefined): boolean {
    if (!currentBuildHash || !qaapIsVersionedFrontendEntryAssetRequest(requestUrl)) {
        return false;
    }
    return new URL(requestUrl, 'http://qaap.local').searchParams.get('qaap-build') === currentBuildHash;
}

/** @internal Exported for unit tests only. Reads the entry fingerprint stamped into index.html. */
export function qaapReadFrontendEntryBuildHash(indexHtml: string): string | undefined {
    return /[?&]qaap-build=([a-f0-9]{64})(?![a-f0-9])/.exec(indexHtml)?.[1];
}

/** Content types of the frontend assets the build pre-compresses with brotli (`<file>.br`). */
const BROTLI_CONTENT_TYPES: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
};

/**
 * @internal Exported for unit tests only. URL path of a top-level frontend asset that may have a
 * pre-compressed `.br` sibling, or `undefined`. `url` is `req.url` after the early entry-fingerprint
 * normalization and possibly after core's `serveGzipped` appended `.gz` (pass `gzipped`).
 */
export function qaapBrotliCandidatePath(url: string, gzipped: boolean): string | undefined {
    let assetUrl = gzipped && url.endsWith('.gz') ? url.slice(0, -'.gz'.length) : url;
    // Stylesheet font URLs keep their package's cache-busting query (`chunk-<hash>.ttf?<md5>`,
    // `?v=4.7.0`). A content-addressed chunk is the same bytes whatever the query says.
    const queryStart = assetUrl.indexOf('?');
    if (queryStart > 0 && qaapIsImmutableHashedChunkPath(assetUrl.slice(0, queryStart))) {
        assetUrl = assetUrl.slice(0, queryStart);
    }
    // A remaining query would make the .br lookup ambiguous; keep the default handling.
    if (!assetUrl.startsWith('/') || /[?#\\]/.test(assetUrl)) {
        return undefined;
    }
    let decoded: string;
    try {
        decoded = decodeURIComponent(assetUrl);
    } catch {
        return undefined;
    }
    // Only files directly under lib/frontend are pre-compressed by the build.
    if (decoded.lastIndexOf('/') !== 0 || decoded === '/' || decoded.includes('\0')) {
        return undefined;
    }
    return BROTLI_CONTENT_TYPES[path.posix.extname(decoded).toLowerCase()] ? decoded : undefined;
}

/** @internal Exported for unit tests only. Base name of a served file without its pre-compression suffix. */
export function qaapUncompressedBaseName(filePath: string): string {
    return path.basename(filePath).replace(/\.(gz|br)$/, '');
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

    protected entryBuildHashCache: { indexMtimeMs: number; buildHash: string | undefined } | undefined;

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
        const frontendDir = path.join(BackendApplicationPath, 'lib', 'frontend');
        // Registered after core's serveGzipped routes and after the early middleware (where the
        // isolated preview host is answered), so only the IDE origin's own static files get here.
        app.use((req, res, next) => this.serveBrotli(req, res, next, frontendDir));
        const legalDir = resolveQaapLegalPagesDir();
        app.use('/legal', express.static(legalDir, {
            index: false,
            setHeaders: res => {
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('X-Content-Type-Options', 'nosniff');
            },
        }));
        app.use(express.static(frontendDir, {
            setHeaders: (res, filePath) => this.setStaticHeaders(res, filePath, frontendDir),
        }));
    }

    /**
     * Serves the build's `<asset>.br` sibling when the client accepts brotli. Caddy passes an
     * already-encoded response through, so phones get brotli instead of gzip. Falls back to the
     * gzip/raw handling whenever the `.br` file is missing.
     */
    protected async serveBrotli(req: express.Request, res: express.Response, next: express.NextFunction, frontendDir: string): Promise<void> {
        const assetPath = await this.brotliAssetPath(req, res, frontendDir);
        if (assetPath) {
            req.url = assetPath + '.br';
            res.set('Content-Encoding', 'br');
            res.set('Content-Type', BROTLI_CONTENT_TYPES[path.posix.extname(assetPath).toLowerCase()]);
        }
        next();
    }

    protected async brotliAssetPath(req: express.Request, res: express.Response, frontendDir: string): Promise<string | undefined> {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return undefined;
        }
        const assetPath = qaapBrotliCandidatePath(req.url, res.get('Content-Encoding') === 'gzip');
        if (!assetPath || req.acceptsEncodings('br') !== 'br') {
            return undefined;
        }
        const brotliPath = path.join(frontendDir, assetPath + '.br');
        return path.dirname(brotliPath) === frontendDir && await this.isFile(brotliPath) ? assetPath : undefined;
    }

    protected async isFile(filePath: string): Promise<boolean> {
        try {
            return (await fs.promises.stat(filePath)).isFile();
        } catch {
            return false;
        }
    }

    protected setStaticHeaders(res: express.Response, filePath: string, frontendDir: string): void {
        // Pre-compressed siblings (`.gz`, `.br`) carry the headers of the file they encode.
        const base = qaapUncompressedBaseName(filePath);
        const topLevel = path.dirname(filePath) === frontendDir;
        // serveGzipped picks the `.gz` sibling from Accept-Encoding; shared caches must key on it,
        // especially for the year-long public entries below.
        res.vary('Accept-Encoding');
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
        } else if (topLevel && qaapIsCurrentFrontendEntryAssetRequest(
            (res.req as express.Request | undefined)?.originalUrl ?? '',
            this.currentEntryBuildHash(frontendDir),
        )) {
            // serveGzipped rewrites req.url to the .gz sibling before static serving.
            // originalUrl still identifies the fingerprinted entry URL in the index.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }

    /** Fingerprint of the entry assets on disk, re-read whenever index.html is rewritten by a build. */
    protected currentEntryBuildHash(frontendDir: string): string | undefined {
        const indexPath = path.join(frontendDir, 'index.html');
        try {
            const indexMtimeMs = fs.statSync(indexPath).mtimeMs;
            if (this.entryBuildHashCache?.indexMtimeMs !== indexMtimeMs) {
                this.entryBuildHashCache = {
                    indexMtimeMs,
                    buildHash: qaapReadFrontendEntryBuildHash(fs.readFileSync(indexPath, 'utf8')),
                };
            }
            return this.entryBuildHashCache.buildHash;
        } catch {
            return undefined;
        }
    }
}

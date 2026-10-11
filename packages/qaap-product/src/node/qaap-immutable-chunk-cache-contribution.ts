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
 * Content-addressed frontend assets: esbuild's `chunk-<hash>` and the `bundle-<hash>` entry
 * copies published by copy-frontend-static, with JS/CSS extensions and optional sourcemap or
 * precompressed (`.gz`/`.br`) suffixes. A content change always produces a new URL.
 */
const HASHED_FRONTEND_ASSET_PATTERN = /^(?:bundle|chunk)-[A-Z0-9]+\.(?:js|css)(?:\.map)?(?:\.(?:gz|br))?$/;
const FRONTEND_CONTENT_TYPES = new Map<string, string>([
    ['.css', 'text/css'],
    ['.js', 'text/javascript'],
]);

/** @internal Exported for unit tests only. Accepts URL paths and filesystem paths alike. */
export function qaapIsImmutableHashedChunkPath(filePath: string): boolean {
    return HASHED_FRONTEND_ASSET_PATTERN.test(path.posix.basename(filePath.replace(/\\/g, '/')));
}

/** @internal Exported for unit tests only. */
export function qaapFrontendStaticHeaders(filePath: string, frontendDir: string): Record<string, string> {
    const base = path.basename(filePath);
    const headers: Record<string, string> = {};
    if (base === 'service-worker.js') {
        // The service worker controls a wider scope than its own location and must not be
        // cached by the browser for long — users would otherwise be stuck on stale workers.
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Service-Worker-Allowed'] = '/';
        headers['Content-Type'] = 'application/javascript; charset=utf-8';
    } else if (base === 'manifest.webmanifest') {
        headers['Cache-Control'] = 'no-cache';
        headers['Content-Type'] = 'application/manifest+json; charset=utf-8';
    } else if (base === 'index.html' || base === 'secondary-window.html') {
        // The shell HTML is small and references hashed asset URLs — never cache it
        // long-term, otherwise stale shells will reference deleted bundle hashes.
        headers['Cache-Control'] = 'no-cache';
    } else if (path.dirname(filePath) === frontendDir && qaapIsImmutableHashedChunkPath(base)) {
        // Hashed assets only ever live at the top level of lib/frontend — nested
        // lookalikes are not content-addressed.
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    return headers;
}

function encodingQuality(header: string, encoding: string): number {
    const parts = header.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    let wildcard: number | undefined;
    let explicit: number | undefined;
    for (const part of parts) {
        const [name, ...parameters] = part.split(';').map(value => value.trim());
        const parameter = parameters.find(value => value.startsWith('q='));
        const parsedQuality = parameter ? Number(parameter.slice(2)) : 1;
        const quality = Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
            ? parsedQuality : 0;
        if (name === '*') {
            wildcard = quality;
        } else if (name === encoding) {
            explicit = quality;
        }
    }
    if (explicit !== undefined) {
        return explicit;
    }
    return wildcard ?? 0;
}

/** @internal Exported for unit tests only. */
export function qaapPreferredStaticEncoding(
    acceptEncoding: string,
    hasBrotli: boolean,
    hasGzip: boolean,
): 'br' | 'gzip' | undefined {
    const brotliQuality = encodingQuality(acceptEncoding, 'br');
    const gzipQuality = encodingQuality(acceptEncoding, 'gzip');
    if (hasBrotli && brotliQuality > 0 && brotliQuality >= gzipQuality) {
        return 'br';
    }
    if (hasGzip && gzipQuality > 0) {
        return 'gzip';
    }
    if (hasBrotli && brotliQuality > 0) {
        return 'br';
    }
    return undefined;
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

    @inject(EarlyExpressMiddleware)
    protected readonly earlyMiddleware: EarlyExpressMiddleware;

    initialize(): void {
        this.earlyMiddleware.handlers.push((req, res, next) => {
            this.servePrecompressedAsset(req, res, next).catch(next);
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
        for (const [name, value] of Object.entries(qaapFrontendStaticHeaders(filePath, frontendDir))) {
            res.setHeader(name, value);
        }
    }

    protected async servePrecompressedAsset(
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
    ): Promise<void> {
        const frontendDir = path.join(BackendApplicationPath, 'lib', 'frontend');
        const contentType = FRONTEND_CONTENT_TYPES.get(path.extname(req.path).toLowerCase());
        // Only content-hashed entry/chunk files: the shell HTML, the service worker and every
        // other route keep going through Theia's handlers (cookies, preview proxy, gzip fallback).
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !contentType || !qaapIsImmutableHashedChunkPath(req.path)) {
            next();
            return;
        }

        const sourcePath = path.resolve(frontendDir, `.${req.path}`);
        const relativePath = path.relative(frontendDir, sourcePath);
        if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            next();
            return;
        }
        let sourceStat: fs.Stats;
        try {
            sourceStat = await fs.promises.stat(sourcePath);
        } catch {
            next();
            return;
        }
        if (!sourceStat.isFile()) {
            next();
            return;
        }

        res.setHeader('Vary', 'Accept-Encoding');
        this.setStaticHeaders(res, sourcePath, frontendDir);
        const accepts = req.get('Accept-Encoding') ?? '';
        const encoding = qaapPreferredStaticEncoding(
            accepts,
            fs.existsSync(`${sourcePath}.br`),
            fs.existsSync(`${sourcePath}.gz`),
        );
        if (!encoding) {
            next();
            return;
        }

        const encodedPath = `${sourcePath}.${encoding}`;
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Type', contentType);
        res.sendFile(encodedPath, error => {
            if (error) {
                next(error);
            }
        });
    }
}

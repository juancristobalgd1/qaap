// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import * as fs from 'fs';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import * as express from '@theia/core/shared/express';
import { BackendApplicationContribution, BackendApplicationPath } from '@theia/core/lib/node';
import { EarlyExpressMiddleware } from '@theia/core/lib/node/backend-application';

const BROTLI_CONTENT_TYPES: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
};

/**
 * Serves the `.br` companion of a frontend `.js` / `.css` file (written by copy-frontend-static)
 * to browsers that accept Brotli, ahead of upstream's `serveGzipped` (`.gz`): same `req.url`
 * rewrite, so `express.static` and the tenant proxy (which routes on `originalUrl`) treat it
 * exactly like the gzip companion. Files without a `.br` keep the gzip path.
 *
 * @internal Exported for unit tests only.
 */
export async function qaapServeBrotli(req: express.Request, res: express.Response, frontendDir: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return;
    }
    const queryIndex = req.url.indexOf('?');
    const pathname = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex);
    const contentType = BROTLI_CONTENT_TYPES[path.posix.extname(pathname)];
    if (!contentType || req.acceptsEncodings('br') !== 'br') {
        return;
    }
    let relative: string;
    try {
        relative = decodeURIComponent(pathname);
    } catch {
        return;
    }
    const brPath = path.join(frontendDir, relative + '.br');
    if (!brPath.startsWith(frontendDir + path.sep)) {
        return;
    }
    try {
        await fs.promises.access(brPath, fs.constants.R_OK);
    } catch {
        return;
    }
    req.url = pathname + '.br' + (queryIndex === -1 ? '' : req.url.slice(queryIndex));
    res.set('Content-Encoding', 'br');
    res.set('Content-Type', contentType);
    res.append('Vary', 'Accept-Encoding');
}

@injectable()
export class QaapBrotliStaticContribution implements BackendApplicationContribution {

    @inject(EarlyExpressMiddleware) @optional()
    protected readonly earlyMiddleware?: EarlyExpressMiddleware;

    initialize(): void {
        const frontendDir = path.join(BackendApplicationPath, 'lib', 'frontend');
        this.earlyMiddleware?.handlers.push((req, res, next) => {
            qaapServeBrotli(req, res, frontendDir).then(() => next(), next);
        });
    }
}

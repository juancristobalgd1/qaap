// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { Request, Response } from '@theia/core/shared/express';

/**
 * Express 4 ignores the promise an async handler returns. A route registered as
 * `(req, res) => void this.handleX(req, res)` that rejects (SQLite or filesystem failure) therefore
 * never answers, and the client waits for its own timeout. Wrap such handlers instead.
 */
export namespace QaapAsyncRoute {

    /** Answers 500 (or ends a response already in flight) when `handler` rejects. */
    export function wrap(label: string, handler: (req: Request, res: Response) => Promise<unknown>): (req: Request, res: Response) => void {
        return (req, res) => {
            handler(req, res).catch(error => {
                console.error(`[${label}] ${req.method} ${req.path} failed:`, error instanceof Error ? error.message : error);
                if (res.headersSent) {
                    res.end();
                } else {
                    res.status(500).json({ error: 'internal_error' });
                }
            });
        };
    }
}

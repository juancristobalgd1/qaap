// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Application } from '@theia/core/shared/express';

interface QaapExpressRouterLayer {
    name?: string;
}

/**
 * Route-order helpers for signed webhooks. Contributions configured earlier (upstream `@theia/filesystem`'s
 * download endpoint) install a global `json()` that consumes the request stream, so a route-level `raw()`
 * parser registered later never sees the signed bytes.
 */
export namespace QaapExpressRouteOrder {

    /**
     * Moves the layer just added ahead of every middleware, but after Express 4's own init layers (`query`,
     * `expressInit`: they give `req.header`, `res.status`, ...). Express 4 `_router`, Express 5 `router`.
     * Returns `false` (and warns) when the router stack cannot be reached.
     */
    export function moveLastRouteFirst(app: Application, label: string): boolean {
        const router = app as unknown as { _router?: { stack?: QaapExpressRouterLayer[] }; router?: { stack?: QaapExpressRouterLayer[] } };
        const stack = router._router?.stack ?? router.router?.stack;
        if (!Array.isArray(stack) || stack.length < 2) {
            console.warn(`[${label}] could not move the webhook route first; signed deliveries may be refused`);
            return false;
        }
        const layer = stack.pop()!;
        // Bundlers may suffix function names (`expressInit2`); `expressInit` comes right after `query` in
        // Express 4 and does not exist in Express 5 (its init runs in app.handle), where -1 + 1 puts it first.
        const init = stack.findIndex(candidate => /^expressInit\d*$/.test(candidate.name ?? ''));
        stack.splice(init + 1, 0, layer);
        return true;
    }
}

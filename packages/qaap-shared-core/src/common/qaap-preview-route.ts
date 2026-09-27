// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapPreviewId, qaapPreviewIdOwnerSegment } from './qaap-preview-identity';

/**
 * Response header a per-tenant backend attaches when it hands out a public preview identifier
 * (an identity preview id served on `<previewId>.<QAAP_PREVIEW_BASE_DOMAIN>`, or a public share
 * token). The control plane strips it and remembers `identifier → tenant` so unauthenticated
 * requests for that identifier can be routed to the right backend. The tenant is always taken
 * from the control plane's own authenticated session, never from the header.
 */
export const QAAP_PREVIEW_ROUTE_HEADER = 'x-qaap-preview-route';

export type QaapPreviewRouteKind = 'preview' | 'share';

export interface QaapPreviewRoute {
    readonly kind: QaapPreviewRouteKind;
    readonly id: string;
}

const SHARE_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
/** Bounds what a single response may advertise. */
const MAX_ROUTES_PER_HEADER = 8;

export function isQaapPreviewRouteId(kind: QaapPreviewRouteKind, id: string): boolean {
    return kind === 'preview' ? isQaapPreviewId(id) : SHARE_TOKEN_PATTERN.test(id);
}

export function formatQaapPreviewRoutes(routes: readonly QaapPreviewRoute[]): string {
    return routes
        .filter(route => isQaapPreviewRouteId(route.kind, route.id))
        .map(route => `${route.kind}:${route.id}`)
        .join(', ');
}

export function parseQaapPreviewRoutes(raw: string | string[] | number | undefined): QaapPreviewRoute[] {
    if (raw === undefined || typeof raw === 'number') {
        return [];
    }
    const routes: QaapPreviewRoute[] = [];
    for (const part of (Array.isArray(raw) ? raw.join(',') : raw).split(',')) {
        const match = /^\s*(preview|share):([^\s,]+)\s*$/.exec(part);
        if (!match) {
            continue;
        }
        const kind = match[1] as QaapPreviewRouteKind;
        if (isQaapPreviewRouteId(kind, match[2])) {
            routes.push({ kind, id: match[2] });
        }
        if (routes.length >= MAX_ROUTES_PER_HEADER) {
            break;
        }
    }
    return routes;
}

/**
 * Process preview ids embed the owner (`u-<owner>-w-…`). A route for such an id is only accepted
 * for the tenant it names, so a backend can never claim another tenant's preview host.
 */
export function qaapPreviewRouteMatchesTenant(route: QaapPreviewRoute, tenantLogin: string): boolean {
    if (route.kind !== 'preview' || !route.id.startsWith('u-')) {
        return true;
    }
    return route.id.startsWith(`u-${qaapPreviewIdOwnerSegment(tenantLogin)}-w-`);
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { BROWSER_TOKEN_COOKIE_NAME } from '@theia/core/lib/node/hosting/browser-connection-token';
import { QAAP_AUTH_SESSION_COOKIE } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

/** Capability cookie for a preview; re-exported as `QAAP_PREVIEW_ACCESS_COOKIE` by the endpoint. */
export const QAAP_PREVIEW_ACCESS_COOKIE_NAME = 'qaap_preview_access';

/**
 * Cookies owned by Qaap itself. On same-origin preview routes the browser attaches them to every
 * preview request, so they must never reach the previewed dev server (arbitrary, possibly cloned
 * and untrusted code) and the dev server must never be able to overwrite them via `Set-Cookie`.
 */
export const QAAP_RESERVED_COOKIE_NAMES: ReadonlySet<string> = new Set([
    QAAP_AUTH_SESSION_COOKIE,
    QAAP_PREVIEW_ACCESS_COOKIE_NAME,
    BROWSER_TOKEN_COOKIE_NAME,
]);

/** `x-qaap-*` headers are internal control-plane / proxy markers (e.g. the tenant HMAC assertion). */
const QAAP_INTERNAL_HEADER_PREFIX = 'x-qaap-';

function cookieName(pair: string): string {
    const separator = pair.indexOf('=');
    return (separator === -1 ? pair : pair.slice(0, separator)).trim();
}

/** Removes Qaap-owned cookies from a `Cookie` request header, keeping the app's own cookies. */
export function stripQaapReservedCookies(cookieHeader: string | string[] | undefined): string | undefined {
    if (cookieHeader === undefined) {
        return undefined;
    }
    const joined = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
    const kept = joined
        .split(';')
        .map(pair => pair.trim())
        .filter(pair => pair.length > 0 && !QAAP_RESERVED_COOKIE_NAMES.has(cookieName(pair)));
    return kept.length > 0 ? kept.join('; ') : undefined;
}

/** Drops `Set-Cookie` entries from the previewed app that would overwrite a Qaap-owned cookie. */
export function filterQaapReservedSetCookies(setCookie: string | string[] | undefined): string[] | undefined {
    if (setCookie === undefined) {
        return undefined;
    }
    const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
    const kept = entries.filter(entry => !QAAP_RESERVED_COOKIE_NAMES.has(cookieName(entry.split(';')[0] ?? '')));
    return kept.length > 0 ? kept : undefined;
}

/** Request headers to send to the previewed dev server. */
export function buildQaapPreviewUpstreamHeaders(
    incoming: http.IncomingHttpHeaders,
    host: string,
): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(incoming)) {
        const lowerKey = key.toLowerCase();
        if (value === undefined || lowerKey === 'cookie' || lowerKey.startsWith(QAAP_INTERNAL_HEADER_PREFIX)) {
            continue;
        }
        headers[key] = value;
    }
    const cookie = stripQaapReservedCookies(incoming.cookie);
    if (cookie) {
        headers.cookie = cookie;
    }
    headers.host = host;
    return headers;
}

/** Applies {@link filterQaapReservedSetCookies} to a response header bag in place. */
export function sanitizeQaapPreviewResponseHeaders(headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders): void {
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() !== 'set-cookie') {
            continue;
        }
        const filtered = filterQaapReservedSetCookies(headers[key] as string | string[] | undefined);
        if (filtered) {
            headers[key] = filtered;
        } else {
            delete headers[key];
        }
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Authenticated GET endpoint: `?url=<http(s) url>` answers whether the site may be framed. */
export const QAAP_FRAME_CHECK_API_PATH = '/qaap/api/frame-check';

export interface QaapFrameCheckResult {
    readonly embeddable: boolean;
    readonly reason?: string;
    /** Qaap's own preview host / origin: never preflighted, always framed like a same-origin preview. */
    readonly internal?: boolean;
    /** The check could not run (refused, rate-limited, failed): `embeddable` is only a default. */
    readonly unknown?: boolean;
}

/**
 * Decides embeddability from response headers (lower-case names), the way browsers do: when any CSP
 * `frame-ancestors` directive is present it alone decides and `X-Frame-Options` is ignored; it blocks
 * unless it allows `*` or the embedding Qaap origin (`appOrigin`, e.g. `https://qaap.example`).
 * Without `frame-ancestors`, `X-Frame-Options` DENY / SAMEORIGIN blocks.
 */
export function evaluateQaapFrameHeaders(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    appOrigin?: string,
): QaapFrameCheckResult {
    let app: URL | undefined;
    try {
        app = appOrigin ? new URL(appOrigin) : undefined;
    } catch {
        // No usable app origin: only `*` allows framing.
    }
    const joined = (name: string): string => {
        const value = headers[name];
        return (Array.isArray(value) ? value.join(',') : value ?? '').trim();
    };
    let hasFrameAncestors = false;
    for (const policy of joined('content-security-policy').split(',')) {
        for (const directive of policy.split(';')) {
            const parts = directive.trim().split(/\s+/);
            if (parts[0]?.toLowerCase() !== 'frame-ancestors') {
                continue;
            }
            hasFrameAncestors = true;
            // Every policy must allow the embedding origin (browsers enforce each policy separately).
            if (!parts.slice(1).some(source => frameAncestorSourceMatches(source, app))) {
                return { embeddable: false, reason: 'Content-Security-Policy: frame-ancestors' };
            }
        }
    }
    if (hasFrameAncestors) {
        return { embeddable: true };
    }
    const xfo = joined('x-frame-options').toLowerCase();
    if (/(^|[\s,])(deny|sameorigin)\b/.test(xfo)) {
        return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
    }
    return { embeddable: true };
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };
const FRAME_ANCESTOR_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\*|\d+))?(?:\/.*)?$/;

/**
 * CSP host-source / scheme-source match of one `frame-ancestors` source against the embedding app
 * origin: `*`, `https:`, `https://qaap.example`, `qaap.example`, `https://*.example` (subdomains only),
 * with optional port (`:*` = any). Keywords (`'self'`, `'none'`) never match a cross-origin embedder.
 */
function frameAncestorSourceMatches(rawSource: string, app: URL | undefined): boolean {
    const source = rawSource.toLowerCase();
    if (source === '*') {
        return true;
    }
    if (!app) {
        return false;
    }
    if (/^[a-z][a-z0-9+.-]*:$/.test(source)) {
        return source === app.protocol || (source === 'http:' && app.protocol === 'https:');
    }
    const match = FRAME_ANCESTOR_SOURCE.exec(source);
    if (!match) {
        return false;
    }
    const [, scheme, host, port] = match;
    if (scheme) {
        const schemeOk = `${scheme}:` === app.protocol || (scheme === 'http' && app.protocol === 'https:');
        if (!schemeOk) {
            return false;
        }
    } else if (app.protocol !== 'http:' && app.protocol !== 'https:') {
        return false;
    }
    const appHost = app.hostname.toLowerCase();
    const hostOk = host === '*'
        || (host.startsWith('*.') ? appHost.endsWith(host.slice(1)) : appHost === host);
    if (!hostOk) {
        return false;
    }
    if (port === '*') {
        return true;
    }
    const appPort = app.port || DEFAULT_PORTS[app.protocol];
    if (port) {
        return port === appPort;
    }
    // No port: the scheme's default port (an upgraded http source also allows 443).
    return appPort === DEFAULT_PORTS[app.protocol] || (!!scheme && appPort === DEFAULT_PORTS[`${scheme}:`]);
}

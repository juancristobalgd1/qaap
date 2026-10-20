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
 * Decides embeddability from response headers (lower-case names).
 * Not embeddable: `X-Frame-Options` DENY / SAMEORIGIN, or a CSP `frame-ancestors` directive that
 * allows neither `*` nor the embedding Qaap origin (`appOrigin`, e.g. `https://qaap.example`).
 */
export function evaluateQaapFrameHeaders(
    headers: Readonly<Record<string, string | string[] | undefined>>,
    appOrigin?: string,
): QaapFrameCheckResult {
    const allowedSources = new Set(['*']);
    if (appOrigin) {
        try {
            const app = new URL(appOrigin);
            allowedSources.add(app.origin.toLowerCase());
            allowedSources.add(app.protocol);
        } catch {
            // No usable app origin: only `*` allows framing.
        }
    }
    const joined = (name: string): string => {
        const value = headers[name];
        return (Array.isArray(value) ? value.join(',') : value ?? '').trim();
    };
    const xfo = joined('x-frame-options').toLowerCase();
    if (/(^|[\s,])(deny|sameorigin)\b/.test(xfo)) {
        return { embeddable: false, reason: `X-Frame-Options: ${xfo}` };
    }
    const csp = joined('content-security-policy');
    for (const policy of csp.split(',')) {
        for (const directive of policy.split(';')) {
            const parts = directive.trim().split(/\s+/);
            if (parts[0]?.toLowerCase() === 'frame-ancestors'
                && !parts.slice(1).some(source => allowedSources.has(source.toLowerCase().replace(/\/+$/, '')))) {
                return { embeddable: false, reason: 'Content-Security-Policy: frame-ancestors' };
            }
        }
    }
    return { embeddable: true };
}

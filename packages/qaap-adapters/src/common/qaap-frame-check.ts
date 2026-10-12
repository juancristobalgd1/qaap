// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Authenticated GET endpoint: `?url=<http(s) url>` answers whether the site may be framed. */
export const QAAP_FRAME_CHECK_API_PATH = '/qaap/api/frame-check';

export interface QaapFrameCheckResult {
    readonly embeddable: boolean;
    readonly reason?: string;
}

/**
 * Decides embeddability from response headers (lower-case names).
 * Not embeddable: `X-Frame-Options` DENY / SAMEORIGIN, or a CSP `frame-ancestors` directive other than `*`.
 */
export function evaluateQaapFrameHeaders(headers: Readonly<Record<string, string | string[] | undefined>>): QaapFrameCheckResult {
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
            if (parts[0]?.toLowerCase() === 'frame-ancestors' && !parts.slice(1).includes('*')) {
                return { embeddable: false, reason: 'Content-Security-Policy: frame-ancestors' };
            }
        }
    }
    return { embeddable: true };
}

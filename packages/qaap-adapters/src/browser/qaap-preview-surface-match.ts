// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { parsePreviewIdentityUrl, parsePreviewProxyPath } from './qaap-preview-url-utils';

interface QaapPreviewDescriptor {
    readonly previewId: string | undefined;
    readonly port: number | undefined;
}

function baseUrl(): string {
    return typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
}

/**
 * Extracts the strongest available identity from a preview URL.
 *
 * `/qaap-preview/:previewId/` carries the full process identity and is authoritative; an
 * isolated-origin preview (`https://<hostLabel>.<baseDomain>/`) is identity-bearing too, with the
 * host label standing in for the preview id.
 * `/qaap-dev/:port/` and direct `host:port` URLs only carry a port, which is ambiguous across
 * projects and must never be compared against an identity URL.
 */
function describe(url: string): QaapPreviewDescriptor {
    try {
        const parsed = new URL(url, baseUrl());
        const identity = parsePreviewIdentityUrl(parsed.toString());
        if (identity) {
            return { previewId: identity.previewId, port: undefined };
        }
        const proxy = parsePreviewProxyPath(parsed.pathname);
        if (proxy) {
            return { previewId: undefined, port: proxy.port };
        }
        const port = Number(parsed.port);
        return { previewId: undefined, port: Number.isInteger(port) && port > 0 ? port : undefined };
    } catch {
        return { previewId: undefined, port: undefined };
    }
}

/**
 * Matches a preview iframe to the exact preview identity (or dev port) of the current project.
 *
 * `equivalentPreviewIds` lists ids that denote the same claim — typically the claim's canonical
 * `previewId` and its isolated host label — so a same-origin identity URL and the isolated URL of
 * that claim count as one surface. Without it, the two only match when their ids are equal.
 */
export function qaapPreviewFrameMatchesUrl(
    frame: Pick<HTMLIFrameElement, 'src'>,
    expectedUrl: string,
    equivalentPreviewIds?: readonly (string | undefined)[],
): boolean {
    if (!frame.src || frame.src === 'about:blank') {
        return false;
    }
    const expected = describe(expectedUrl);
    const actual = describe(frame.src);

    // Identity wins whenever either side has one: an identity URL and a port-only URL are never
    // the same surface, even though both resolve to the IDE origin/port.
    if (expected.previewId !== undefined || actual.previewId !== undefined) {
        if (expected.previewId === undefined || actual.previewId === undefined) {
            return false;
        }
        if (actual.previewId === expected.previewId) {
            return true;
        }
        const aliases = (equivalentPreviewIds ?? []).filter((id): id is string => !!id);
        return aliases.includes(expected.previewId) && aliases.includes(actual.previewId);
    }
    if (expected.port !== undefined || actual.port !== undefined) {
        return expected.port !== undefined && actual.port === expected.port;
    }
    try {
        const base = baseUrl();
        const expectedUrlParsed = new URL(expectedUrl, base);
        const actualUrlParsed = new URL(frame.src, base);
        return actualUrlParsed.origin === expectedUrlParsed.origin
            && actualUrlParsed.pathname === expectedUrlParsed.pathname;
    } catch {
        return false;
    }
}

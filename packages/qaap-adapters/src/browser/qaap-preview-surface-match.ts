// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { parsePreviewProxyPath } from './qaap-preview-url-utils';

function previewPort(url: string): number | undefined {
    try {
        const parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
        const proxy = parsePreviewProxyPath(parsed.pathname);
        if (proxy) {
            return proxy.port;
        }
        const port = Number(parsed.port);
        return Number.isInteger(port) && port > 0 ? port : undefined;
    } catch {
        return undefined;
    }
}

/** Matches a preview iframe to the exact dev port selected for the current project. */
export function qaapPreviewFrameMatchesUrl(frame: Pick<HTMLIFrameElement, 'src'>, expectedUrl: string): boolean {
    if (!frame.src || frame.src === 'about:blank') {
        return false;
    }
    const expectedPort = previewPort(expectedUrl);
    const actualPort = previewPort(frame.src);
    if (expectedPort !== undefined || actualPort !== undefined) {
        return expectedPort !== undefined && actualPort === expectedPort;
    }
    try {
        const base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
        const expected = new URL(expectedUrl, base);
        const actual = new URL(frame.src, base);
        return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch {
        return false;
    }
}

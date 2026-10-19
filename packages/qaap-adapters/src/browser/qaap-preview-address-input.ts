// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { normalizeMiniBrowserOpenUrl } from '@theia/mini-browser/lib/browser/mini-browser-url-utils';

/** What the preview address bar should do with the text the user typed. */
export type QaapPreviewAddressInput =
    | { readonly kind: 'empty' }
    /** Navigate to `url` (already has a scheme, or is an IDE-origin path such as `/qaap-dev/3000/`). */
    | { readonly kind: 'url'; readonly url: string }
    /** Free text: navigate to a web search for it. */
    | { readonly kind: 'search'; readonly url: string; readonly query: string }
    /** A scheme the preview must never load (`javascript:`, `data:`, `file:`…). */
    | { readonly kind: 'rejected'; readonly scheme: string };

export const QAAP_PREVIEW_WEB_SEARCH_URL = 'https://www.google.com/search?q=';

const NAVIGABLE_SCHEMES = new Set(['http:', 'https:']);
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const BARE_LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{1,5})?([/?#].*)?$/i;
/** `host.tld`, `host.tld:8080/path`, `10.0.0.1`… — a dot inside the host part, no spaces. */
const HOST_LIKE_PATTERN = /^[^\s/?#:@]+\.[^\s/?#:@]+(:\d{1,5})?([/?#]\S*)?$/;

export function qaapPreviewWebSearchUrl(query: string): string {
    return `${QAAP_PREVIEW_WEB_SEARCH_URL}${encodeURIComponent(query)}`;
}

/**
 * Turns address-bar text into a navigation, the way browser omniboxes do:
 * `claude.ai` → `https://claude.ai`, `localhost:5173` → `http://localhost:5173/`,
 * `react hooks` → web search; non-web schemes are refused so the frame never runs `javascript:`.
 */
export function resolveQaapPreviewAddressInput(raw: string): QaapPreviewAddressInput {
    const text = normalizeMiniBrowserOpenUrl(raw);
    if (!text) {
        return { kind: 'empty' };
    }
    if (text.startsWith('/') && !text.startsWith('//')) {
        return { kind: 'url', url: text };
    }
    if (text.toLowerCase() === 'about:blank') {
        return { kind: 'url', url: 'about:blank' };
    }
    const local = BARE_LOCAL_HOST_PATTERN.exec(text);
    if (local) {
        return { kind: 'url', url: `http://${local[1]}${local[2] ?? ''}${local[3] ?? '/'}` };
    }
    const scheme = SCHEME_PATTERN.exec(text);
    // `host.tld:8080` is a port, not a scheme.
    if (scheme && !/^:\d/.test(text.slice(scheme[1].length))) {
        const protocol = `${scheme[1].toLowerCase()}:`;
        if (!NAVIGABLE_SCHEMES.has(protocol)) {
            return { kind: 'rejected', scheme: protocol };
        }
        return { kind: 'url', url: text };
    }
    if (text.startsWith('//')) {
        return { kind: 'url', url: `https:${text}` };
    }
    if (HOST_LIKE_PATTERN.test(text)) {
        return { kind: 'url', url: `https://${text}` };
    }
    return { kind: 'search', url: qaapPreviewWebSearchUrl(text), query: text };
}

/** True for URLs the preview frame may load: http(s), `about:blank`, or a path on the IDE origin. */
export function isQaapPreviewNavigableUrl(url: string, base: string): boolean {
    const trimmed = url.trim();
    if (!trimmed || trimmed === 'about:blank') {
        return true;
    }
    try {
        return NAVIGABLE_SCHEMES.has(new URL(trimmed, base).protocol);
    } catch {
        return false;
    }
}

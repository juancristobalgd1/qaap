// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { MaybePromise } from '@theia/core/lib/common/types';
import { LocationMapper } from '@theia/mini-browser/lib/browser/location-mapper-service';

const EXPLICIT_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const OPAQUE_SCHEME_PATTERN = /^(about|data|blob|javascript|mailto|file):/i;
const PRIVATE_IPV4_PATTERN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

/** Search engine used for text that does not look like an address. */
export const QAAP_MINI_BROWSER_SEARCH_URL = 'https://duckduckgo.com/?q=';

/** True for loopback, `*.local`, `*.localhost` and private-range hosts, which keep plain `http://`. */
export function isQaapLocalPreviewHost(host: string): boolean {
    const h = host.toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1'
        || h.startsWith('127.') || h.endsWith('.local') || h.endsWith('.localhost') || PRIVATE_IPV4_PATTERN.test(h);
}

function extractHost(input: string): string {
    const authority = input.split(/[/?#]/, 1)[0];
    if (authority.startsWith('[')) {
        const end = authority.indexOf(']');
        return end < 0 ? authority : authority.substring(0, end + 1);
    }
    return authority.replace(/:\d*$/, '');
}

/**
 * Maps user input without a scheme to something loadable:
 * local hosts get `http://`, other hosts `https://`, and free text (whitespace, or no dot/colon/slash) a search URL.
 */
export function resolveQaapMiniBrowserLocation(input: string): string {
    const text = input.trim();
    if (/\s/.test(text)) {
        return `${QAAP_MINI_BROWSER_SEARCH_URL}${encodeURIComponent(text)}`;
    }
    if (isQaapLocalPreviewHost(extractHost(text))) {
        return `http://${text}`;
    }
    if (!/[.:/]/.test(text)) {
        return `${QAAP_MINI_BROWSER_SEARCH_URL}${encodeURIComponent(text)}`;
    }
    return `https://${text}`;
}

/** True when the location carries its own scheme (or is a path) and must be left to the other mappers. */
export function hasQaapExplicitLocationScheme(location: string): boolean {
    return location.length === 0 || location.startsWith('/') || EXPLICIT_SCHEME_PATTERN.test(location) || OPAQUE_SCHEME_PATTERN.test(location);
}

/** Replaces upstream `LocationWithoutSchemeMapper` (priority 1) with https default and search fallback. */
@injectable()
export class QaapLocationWithoutSchemeMapper implements LocationMapper {

    canHandle(location: string): MaybePromise<number> {
        return hasQaapExplicitLocationScheme(location) ? 0 : 2;
    }

    map(location: string): MaybePromise<string> {
        return resolveQaapMiniBrowserLocation(location);
    }

}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Isolated-origin preview host label: an opaque capability derived from the preview secret. It is
 * NOT the canonical preview id, but the backend accepts it anywhere a preview id is accepted.
 */
export const QAAP_ISOLATED_PREVIEW_HOST_LABEL_PATTERN = /^[0-9a-f]{32}$/;

export interface QaapIsolatedPreviewUrl {
    /** First hostname label (`<hostLabel>.<baseDomain>`), usable as a preview id alias. */
    readonly hostLabel: string;
    /** `https://<hostLabel>.<baseDomain>` without a trailing slash. */
    readonly origin: string;
    /** App route served at the isolated origin root: pathname + search + hash. */
    readonly targetPath: string;
}

export function isQaapIsolatedPreviewHostLabel(value: string | undefined): boolean {
    return !!value && QAAP_ISOLATED_PREVIEW_HOST_LABEL_PATTERN.test(value);
}

/**
 * Recognizes an isolated-origin preview URL (`https://<32 hex>.<baseDomain>/…`, backend env
 * `QAAP_PREVIEW_BASE_DOMAIN`). The frontend does not know the base domain, so the shape is the
 * contract: an absolute http(s) URL whose first host label is the 32-hex capability, followed by at
 * least two more labels, on an origin other than the Qaap app origin (when `appOrigin` is given).
 */
export function parseQaapIsolatedPreviewUrl(url: string | undefined, appOrigin?: string): QaapIsolatedPreviewUrl | undefined {
    const trimmed = url?.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
        return undefined;
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return undefined;
    }
    const labels = parsed.hostname.split('.');
    if (labels.length < 3 || labels.slice(1).some(label => !label) || !isQaapIsolatedPreviewHostLabel(labels[0])) {
        return undefined;
    }
    if (appOrigin) {
        try {
            if (new URL(appOrigin).origin === parsed.origin) {
                return undefined;
            }
        } catch {
            // An unparsable app origin cannot equal a valid preview origin.
        }
    }
    return {
        hostLabel: labels[0],
        origin: parsed.origin,
        targetPath: `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`,
    };
}

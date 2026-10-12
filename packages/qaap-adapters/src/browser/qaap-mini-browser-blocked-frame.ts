// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Sandbox tokens added for external origins on top of the upstream default. */
export const QAAP_EXTERNAL_FRAME_SANDBOX_TOKENS: readonly string[] = [
    'allow-downloads',
    'allow-popups-to-escape-sandbox',
    'allow-top-navigation-by-user-activation',
];

/**
 * Heuristic: how long to wait for the iframe `load` event before assuming the site refuses framing.
 * Cross-origin content cannot be inspected, so a missing `load` is the only signal we can trust;
 * a late `load` hides the card again.
 */
export const QAAP_BLOCKED_FRAME_TIMEOUT_MS = 4000;

/** External = http(s) URL on another origin than the IDE (so never `/qaap-dev/` or `/qaap-preview/`, which are same-origin). */
export function isQaapExternalPreviewUrl(url: string, ideOrigin: string): boolean {
    try {
        const parsed = new URL(url, ideOrigin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }
        return parsed.origin !== new URL(ideOrigin).origin;
    } catch {
        return false;
    }
}

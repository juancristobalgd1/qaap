// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Sandbox tokens added for external origins on top of the upstream default. Top navigation and
 * `allow-popups-to-escape-sandbox` stay forbidden: a framed third-party page (or an unsandboxed popup
 * it opens, which keeps `opener`) must never be able to replace the Qaap tab (tab-nabbing).
 */
export const QAAP_EXTERNAL_FRAME_SANDBOX_TOKENS: readonly string[] = [
    'allow-downloads',
];

/**
 * Sandbox tokens always stripped from a frame pointed at an external origin, even when the frame was
 * created with them: each one lets the framed site (or a popup it opens) navigate the Qaap tab.
 * Without `allow-popups-to-escape-sandbox` a popup inherits the sandbox, so it cannot use
 * `window.opener` to redirect Qaap. "Open in new tab" is done by Qaap itself with `noopener,noreferrer`.
 */
export const QAAP_EXTERNAL_FRAME_FORBIDDEN_SANDBOX_TOKENS: readonly string[] = [
    'allow-popups-to-escape-sandbox',
    'allow-top-navigation',
    'allow-top-navigation-by-user-activation',
    'allow-top-navigation-to-custom-protocols',
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

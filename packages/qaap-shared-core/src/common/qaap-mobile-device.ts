// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The single "mobile = Work Hub only" rule. On a device matching this query qaap shows only the
 * Work Hub; the classic IDE is a desktop-only surface and no code path may switch to it.
 *
 * It is the same string as `MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY` in
 * `@theia/core/lib/browser/shell/mobile-layout-state` (narrow viewport **or** coarse pointer, so a
 * phone in landscape still counts). It is duplicated here because `common` code must not import
 * `core/browser`; the pre-bundle `qaap-product/resources/qaap-login-gate.js` hardcodes it as well.
 * Specs assert the three copies stay equal.
 */
export const QAAP_MOBILE_DEVICE_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';

/**
 * `true` on a mobile device (see {@link QAAP_MOBILE_DEVICE_MEDIA_QUERY}): Work Hub only, never the
 * classic IDE. Safe without `window` / `matchMedia` (returns `false`, i.e. desktop semantics).
 */
export function isQaapMobileDevice(): boolean {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia(QAAP_MOBILE_DEVICE_MEDIA_QUERY).matches === true;
    } catch {
        return false;
    }
}

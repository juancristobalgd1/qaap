// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The shared mobile rule used by the Work Hub and mobile shell. A phone remains mobile in
 * landscape, and touch-first devices remain mobile at wider widths.
 */
export const QAAP_MOBILE_DEVICE_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';

/**
 * `true` on a mobile device. Safe in non-browser environments (returns `false`, desktop semantics).
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

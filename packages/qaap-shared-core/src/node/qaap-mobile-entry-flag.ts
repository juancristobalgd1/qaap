// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Server flag `QAAP_MOBILE_ENTRY` (default ON). While on, the auth session/config probes report
 * `mobileEntry: true` and the login gate loads `bundle-mobile.js` (the Work Hub without IDE code)
 * for signed-in users in mobile Work Hub mode. `0`/`false`/`off`/`no` is the kill switch: the
 * probes then omit the field and phones load `bundle.js`.
 */
export function isQaapMobileEntryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = env.QAAP_MOBILE_ENTRY?.trim().toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'off' && value !== 'no';
}

/** `{ mobileEntry: true }` while the flag is on, else `{}` (spread into probe responses). */
export function qaapMobileEntryProbeFields(env: NodeJS.ProcessEnv = process.env): { mobileEntry?: true } {
    return isQaapMobileEntryEnabled(env) ? { mobileEntry: true } : {};
}

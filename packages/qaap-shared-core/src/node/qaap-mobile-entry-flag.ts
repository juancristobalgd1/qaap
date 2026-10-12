// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Server flag `QAAP_MOBILE_ENTRY` (default OFF). When on, the auth session/config probes report
 * `mobileEntry: true` and the login gate loads `bundle-mobile.js` (the Work Hub without IDE code)
 * for signed-in users in mobile Work Hub mode. Responses are unchanged while the flag is off.
 */
export function isQaapMobileEntryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = env.QAAP_MOBILE_ENTRY?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

/** `{ mobileEntry: true }` while the flag is on, else `{}` (spread into probe responses). */
export function qaapMobileEntryProbeFields(env: NodeJS.ProcessEnv = process.env): { mobileEntry?: true } {
    return isQaapMobileEntryEnabled(env) ? { mobileEntry: true } : {};
}

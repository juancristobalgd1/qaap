// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * True when this backend runs as the local desktop app (`examples/electron`, `scripts/qaap-start-electron.mjs`
 * sets `QAAP_DESKTOP=1`). Only then are the GitHub device-flow routes served and the skip-auth guard
 * honours a GitHub session. Web and mobile never set it, so their behaviour is unchanged.
 */
export function isQaapDesktopRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = env.QAAP_DESKTOP?.trim().toLowerCase();
    return value === '1' || value === 'true';
}

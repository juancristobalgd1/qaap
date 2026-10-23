// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Removes every Home getting-started flag, account-scoped keys included, so a flag left by one
 * test cannot hide the checklist in the next.
 */
export function clearGettingStartedTestFlags(): void {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('qaap.workHubHome.gettingStarted')) {
            keys.push(key);
        }
    }
    keys.forEach(key => window.localStorage.removeItem(key));
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_HEALTH_API_PATH } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

const MIN_REFRESH_INTERVAL_MS = 5_000;

let inFlight: Promise<void> | undefined;
let lastStartedAt = 0;

/**
 * Hits a lightweight control-plane endpoint before a dropped WebSocket reconnects so a browser tab
 * left open across a control-plane deploy receives the new `theia-connection-token` cookie instead
 * of failing WebSocket validation in a loop. Throttled and deduplicated across WS clients.
 */
export function refreshControlPlaneConnectionToken(now: number = Date.now()): Promise<void> {
    if (typeof fetch !== 'function') {
        return Promise.resolve();
    }
    if (inFlight) {
        return inFlight;
    }
    if (lastStartedAt > 0 && now - lastStartedAt < MIN_REFRESH_INTERVAL_MS) {
        return Promise.resolve();
    }
    lastStartedAt = now;
    const run = Promise.resolve()
        .then(() => fetch(QAAP_HEALTH_API_PATH, { credentials: 'include', cache: 'no-store' }))
        .then(() => undefined, () => undefined)
        .finally(() => {
            if (inFlight === run) {
                inFlight = undefined;
            }
        });
    inFlight = run;
    return run;
}

/** @internal Resets throttle state for unit tests. */
export function resetControlPlaneConnectionTokenRefreshForTests(): void {
    inFlight = undefined;
    lastStartedAt = 0;
}

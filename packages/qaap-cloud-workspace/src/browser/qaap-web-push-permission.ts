// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type QaapWebPushPermission = 'granted' | 'denied' | 'default' | undefined;

/**
 * Decides whether the browser may call `pushManager.subscribe()` without triggering a console
 * error or an unprompted permission failure:
 * - `'denied'`: never attempt (throws `AbortError: permission denied` on every call).
 * - `'default'`: only attempt inside an explicit user gesture (e.g. toggling notifications on in
 *   Settings); automatic boot registration throws `NotAllowedError: user gesture required`.
 * - `'granted'` (or environments without `Notification`): safe to register automatically.
 */
export function canAttemptWebPushSubscription(
    permission: QaapWebPushPermission,
    options?: { readonly userGesture?: boolean },
): boolean {
    if (permission === 'denied') {
        return false;
    }
    if (!options?.userGesture && permission !== undefined && permission !== 'granted') {
        return false;
    }
    return true;
}

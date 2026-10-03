// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type HarnessAvailabilityState = 'loading' | 'ready' | 'unavailable';

export type HarnessCardAction = 'loading' | 'toggle' | 'install' | 'install-unavailable' | 'availability-unknown';

export function resolveHarnessCardAction(
    available: boolean,
    availabilityState: HarnessAvailabilityState,
    installSupported: boolean,
): HarnessCardAction {
    if (availabilityState === 'loading') {
        return 'loading';
    }
    if (available) {
        return 'toggle';
    }
    if (availabilityState === 'unavailable') {
        return 'availability-unknown';
    }
    return installSupported ? 'install' : 'install-unavailable';
}

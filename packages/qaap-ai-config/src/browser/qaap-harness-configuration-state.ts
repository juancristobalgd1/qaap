// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type HarnessAvailabilityState = 'loading' | 'ready' | 'unavailable';

export type HarnessConnectionState = 'connected' | 'disconnected' | 'unknown' | 'not-required';

export type HarnessCardStatus =
    | 'loading'
    | 'availability-unknown'
    | 'available'
    | 'installed-disconnected'
    | 'installed-connection-unknown'
    | 'not-installed';

export type HarnessCardAction =
    | 'loading'
    | 'toggle'
    | 'install'
    | 'install-unavailable'
    | 'install-no-package'
    | 'availability-unknown';

export function resolveHarnessCardAction(
    installed: boolean,
    availabilityState: HarnessAvailabilityState,
    installSupported: boolean,
    installPackageAvailable: boolean = true,
): HarnessCardAction {
    if (availabilityState === 'loading') {
        return 'loading';
    }
    if (installed) {
        return 'toggle';
    }
    if (availabilityState === 'unavailable') {
        return 'availability-unknown';
    }
    if (installSupported) {
        return 'install';
    }
    // Packageless harnesses must not read like a server policy that an administrator could lift.
    return installPackageAvailable ? 'install-unavailable' : 'install-no-package';
}

export function resolveHarnessCardStatus(
    installed: boolean,
    availabilityState: HarnessAvailabilityState,
    connectionState: HarnessConnectionState,
): HarnessCardStatus {
    if (availabilityState === 'loading') {
        return 'loading';
    }
    if (availabilityState === 'unavailable') {
        return 'availability-unknown';
    }
    if (!installed) {
        return 'not-installed';
    }
    if (connectionState === 'connected' || connectionState === 'not-required') {
        return 'available';
    }
    return connectionState === 'disconnected' ? 'installed-disconnected' : 'installed-connection-unknown';
}

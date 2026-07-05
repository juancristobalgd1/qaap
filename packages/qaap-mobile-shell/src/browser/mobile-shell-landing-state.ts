// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    shouldBootstrapMobileAgentsChat,
    shouldSkipMobileProjectsLanding,
} from './mobile-projects-open';
import { peekPreferDesktopIde } from '../common/qaap-mobile-work-surface-preference';

/** Hub queues a pending action across reloads — see qaap-hub-actions-contribution. */
export const QAAP_HUB_PENDING_ACTION_KEY = 'qaap.hub.pendingAction';

/** Snapshot of sessionStorage + bootstrap flags read synchronously at mobile shell boot. */
export interface MobileShellLandingBootSnapshot {
    skipLanding: boolean;
    bootstrapAgents: boolean;
    hasPendingHubAction: boolean;
    /** User explicitly chose the classic IDE this session — the landing must never paint over it. */
    preferDesktopIde: boolean;
}

export function peekHasPendingHubAction(): boolean {
    try {
        return typeof sessionStorage !== 'undefined'
            && sessionStorage.getItem(QAAP_HUB_PENDING_ACTION_KEY) !== null;
    } catch {
        return false;
    }
}

export function readMobileShellLandingBootSnapshot(): MobileShellLandingBootSnapshot {
    return {
        skipLanding: shouldSkipMobileProjectsLanding(),
        bootstrapAgents: shouldBootstrapMobileAgentsChat(),
        hasPendingHubAction: peekHasPendingHubAction(),
        preferDesktopIde: peekPreferDesktopIde(),
    };
}

/** True when in-memory landing should be skipped (post-open reload or agents bootstrap). */
export function shouldMarkLandingLeftFromStorage(snapshot: MobileShellLandingBootSnapshot = readMobileShellLandingBootSnapshot()): boolean {
    return snapshot.skipLanding || snapshot.bootstrapAgents;
}

export type MobileShellInitialLandingBodyClass = 'landing' | 'agents' | 'none';

/**
 * Body class to apply in {@link MobileOneColumnShellContribution.onStart} before layout init.
 * Returns `none` when the mobile MQ does not match or a hub action is pending across reload.
 */
export function resolveInitialLandingBodyClass(
    mobileMqMatches: boolean,
    snapshot: MobileShellLandingBootSnapshot = readMobileShellLandingBootSnapshot(),
): MobileShellInitialLandingBodyClass {
    if (!mobileMqMatches || snapshot.hasPendingHubAction) {
        return 'none';
    }
    if (snapshot.preferDesktopIde) {
        // Reloading inside the classic IDE (markPreferDesktopIde): restore that surface —
        // painting the landing here hides the whole dock behind the landing CSS (blank shell).
        return 'none';
    }
    if (snapshot.bootstrapAgents) {
        return 'agents';
    }
    if (!snapshot.skipLanding) {
        return 'landing';
    }
    return 'none';
}

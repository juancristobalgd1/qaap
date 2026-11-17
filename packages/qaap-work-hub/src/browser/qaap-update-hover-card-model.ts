// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Pure parts of the sessions sidebar "Update ready" button card: the text it shows for a pending
// backend update and where it sits next to the footer button. No DOM, so specs run without a window.

import { nls } from '@theia/core/lib/common/nls';
import type { QaapTenantBackendUpdate } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';

/** Text of the update card: a bold first line and muted detail lines. */
export interface QaapUpdateHoverCardModel {
    readonly title: string;
    readonly details: readonly string[];
}

export interface QaapUpdateHoverCardRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface QaapUpdateHoverCardSize {
    readonly width: number;
    readonly height: number;
}

export interface QaapUpdateHoverCardPosition {
    readonly left: number;
    readonly top: number;
    readonly side: 'above' | 'below';
}

/** Length of the build SHAs shown in the card. */
const SHORT_SHA_LENGTH = 7;

/**
 * Short form of a build id for the card: a git SHA is cut to 7 characters, any other id is kept
 * as is. `undefined` for a missing or blank build.
 */
export function shortQaapBuildSha(build: string | undefined): string | undefined {
    const trimmed = build?.trim();
    if (!trimmed) {
        return undefined;
    }
    return /^[0-9a-f]{8,40}$/i.test(trimmed) ? trimmed.slice(0, SHORT_SHA_LENGTH) : trimmed;
}

/** "Running build A → new build B", omitting the build that is unknown; `undefined` when both are. */
export function qaapUpdateBuildsLine(update: QaapTenantBackendUpdate): string | undefined {
    const running = shortQaapBuildSha(update.backendBuild);
    const next = shortQaapBuildSha(update.controlPlaneBuild);
    if (running && next) {
        return nls.localize('qaap/sessionsSidebar/updateCardBuilds', 'Running build {0} → new build {1}', running, next);
    }
    if (running) {
        return nls.localize('qaap/sessionsSidebar/updateCardRunningBuild', 'Running build {0}', running);
    }
    if (next) {
        return nls.localize('qaap/sessionsSidebar/updateCardNewBuild', 'New build {0}', next);
    }
    return undefined;
}

/** Card text for a pending update, or for the update in flight (`updating`). */
export function buildQaapUpdateHoverCardModel(update: QaapTenantBackendUpdate, updating = false): QaapUpdateHoverCardModel {
    const builds = qaapUpdateBuildsLine(update);
    if (updating) {
        return {
            title: nls.localize('qaap/sessionsSidebar/backendUpdating', 'Updating…'),
            details: [
                ...(builds ? [builds] : []),
                nls.localize('qaap/sessionsSidebar/updateCardReloading', 'The page reloads when the new build is ready.'),
            ],
        };
    }
    const details: string[] = builds ? [builds] : [];
    if (update.reason === 'agent-turns-running') {
        details.push(nls.localize('qaap/sessionsSidebar/updateCardClickToInterrupt',
            'Click to update now instead; you are asked before running tasks stop. The page then reloads.'));
        return { title: qaapUpdateWaitingTitle(update.runningTasks), details };
    }
    details.push(nls.localize('qaap/sessionsSidebar/updateCardReloadExplanation',
        'Qaap restarts your backend on the new build and reloads this page.'));
    return {
        title: nls.localize('qaap/sessionsSidebar/updateCardReady', 'Update ready. Click to update Qaap.'),
        details,
    };
}

function qaapUpdateWaitingTitle(runningTasks: number): string {
    if (runningTasks === 1) {
        return nls.localize('qaap/sessionsSidebar/updateCardWaitingOne', 'Update ready — it applies when your running task finishes.');
    }
    if (runningTasks > 1) {
        return nls.localize('qaap/sessionsSidebar/updateCardWaitingMany',
            'Update ready — it applies when your {0} running tasks finish.', runningTasks);
    }
    return nls.localize('qaap/sessionsSidebar/updateCardWaiting', 'Update ready — it applies when your running tasks finish.');
}

/**
 * Places the card above the button (the footer sits at the bottom of the sidebar), below when
 * there is no room above, left-aligned with the button and clamped inside the viewport.
 */
export function computeQaapUpdateHoverCardPosition(
    anchor: QaapUpdateHoverCardRect,
    card: QaapUpdateHoverCardSize,
    viewport: QaapUpdateHoverCardSize,
    gap = 8,
    margin = 8,
): QaapUpdateHoverCardPosition {
    const maxLeft = Math.max(margin, viewport.width - margin - card.width);
    const maxTop = Math.max(margin, viewport.height - margin - card.height);
    const left = Math.min(Math.max(anchor.left, margin), maxLeft);
    const above = anchor.top - gap - card.height;
    if (above >= margin) {
        return { left: Math.round(left), top: Math.round(above), side: 'above' };
    }
    const below = Math.min(Math.max(anchor.bottom + gap, margin), maxTop);
    return { left: Math.round(left), top: Math.round(below), side: 'below' };
}

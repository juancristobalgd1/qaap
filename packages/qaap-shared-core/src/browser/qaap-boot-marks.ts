// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Prefix of every boot milestone recorded with `performance.mark` (also read by `qaap-login-gate.js`). */
export const QAAP_BOOT_MARK_PREFIX = 'qaap-boot:';

/**
 * Work Hub boot milestones, in their usual order:
 * - `workhub-onstart` — the Work Hub shell contribution starts (before the shell is attached).
 * - `landing-rendered` — the Work Hub panel built its first DOM (may still be detached / guarded).
 * - `workspace-ready` — `WorkspaceService.ready` resolved (default / most recent workspace restored).
 * - `workhub-bootstrap-start` — `onDidInitializeLayout` started the post-layout Work Hub bootstrap.
 * - `landing-painted` — the boot guard lifted with the Work Hub attached and visible.
 * - `startup-ready` — `qaap-startup-ready` was dispatched.
 */
export type QaapBootMilestone =
    | 'workhub-onstart'
    | 'landing-rendered'
    | 'workspace-ready'
    | 'workhub-bootstrap-start'
    | 'landing-painted'
    | 'startup-ready';

const recordedQaapBootMilestones = new Set<QaapBootMilestone>();

/** Records `qaap-boot:<milestone>` once per page load. Never throws. */
export function markQaapBootMilestone(milestone: QaapBootMilestone): void {
    if (recordedQaapBootMilestones.has(milestone)) {
        return;
    }
    recordedQaapBootMilestones.add(milestone);
    try {
        if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
            performance.mark(QAAP_BOOT_MARK_PREFIX + milestone);
        }
    } catch {
        // Diagnostics only.
    }
}

/** True once {@link markQaapBootMilestone} recorded `milestone` in this page. */
export function hasQaapBootMilestone(milestone: QaapBootMilestone): boolean {
    return recordedQaapBootMilestones.has(milestone);
}

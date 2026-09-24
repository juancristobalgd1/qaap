// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The key {@link ShellLayoutRestorer} persists the serialized shell layout under (via
 * {@link StorageService}, prefixed to `theia:<pathname>:layout` in the browser). Clearing this
 * exact key with `setData(SHELL_LAYOUT_STORAGE_KEY, undefined)` removes the same entry the
 * restorer reads on boot — no hand-rolled localStorage string manipulation required.
 */
export const SHELL_LAYOUT_STORAGE_KEY = 'layout';

/** SessionStorage flag set once a layout-recovery reload has been attempted, to prevent reload loops. */
export const QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY = 'qaap.layoutRecovery.attempted';

export interface LayoutRecoveryDecisionInput {
    /**
     * A Work Hub surface (the projects panel root, an agents transcript, or an active-transcript
     * body chrome) is mounted in the DOM. When true the boot succeeded and no recovery is needed.
     */
    workHubSurfacePresent: boolean;
    /** The user explicitly chose the classic desktop IDE this session (Work Hub contract opt-out). */
    preferDesktopIde: boolean;
    /** A layout-recovery reload was already attempted this session (see {@link QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY}). */
    recoveryAlreadyAttempted: boolean;
}

export type LayoutRecoveryDecision =
    /** Boot is healthy or the IDE was chosen — do nothing. */
    | 'noop'
    /** The Work Hub never mounted and no recovery ran yet — clear the poisoned layout and reload once. */
    | 'recover'
    /** The Work Hub is still absent after a recovery reload — stop to avoid an infinite reload loop. */
    | 'abort-loop';

/**
 * Pure last-resort decision for the blank-shell guard. When a valid-but-empty persisted layout is
 * restored, the Work Hub can fail to mount and no on-screen surface exists to fall back to. This
 * decides — from DOM/session facts only — whether to clear the layout and reload, do nothing, or
 * abort because a previous reload already tried and failed.
 */
export function decideLayoutRecovery(input: LayoutRecoveryDecisionInput): LayoutRecoveryDecision {
    if (input.preferDesktopIde || input.workHubSurfacePresent) {
        return 'noop';
    }
    if (input.recoveryAlreadyAttempted) {
        return 'abort-loop';
    }
    return 'recover';
}

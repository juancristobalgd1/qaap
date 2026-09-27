// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    ensureStickyComposerPillRow,
    pruneStickyComposerPillsOnlyHost,
    STEP_PILL_CLASS,
} from './qaap-sticky-composer-step-pill';

/** Shares the Step pill look (same strip above the card); read-only status, not a menu. */
export const GOAL_LOOP_PILL_CLASS = 'theia-mobile-sticky-composer-goal-loop-pill';
const GOAL_LOOP_PILL_LABEL_CLASS = 'theia-mobile-sticky-composer-goal-loop-pill-label';

export interface StickyComposerGoalLoopPillOptions {
    /** "Iteration 2/8 · Verifying"; `undefined` removes the pill. */
    readonly label: string | undefined;
}

/** Sync the "Until done" iteration pill into every sticky-composer column under the given roots. */
export function syncStickyComposerGoalLoopPillInRoots(
    roots: ReadonlyArray<HTMLElement | undefined | null>,
    options: StickyComposerGoalLoopPillOptions,
): void {
    for (const root of roots) {
        if (!root?.isConnected) {
            continue;
        }
        root.querySelectorAll('.theia-mobile-projects-sticky-composer-inner').forEach(wrap => {
            if (wrap instanceof HTMLElement) {
                syncStickyComposerGoalLoopPill(wrap, options);
            }
        });
    }
}

export function syncStickyComposerGoalLoopPill(wrap: HTMLElement, options: StickyComposerGoalLoopPillOptions): void {
    const card = wrap.querySelector(':scope > .theia-mobile-projects-sticky-composer-card');
    if (!(card instanceof HTMLElement)) {
        return;
    }
    if (!options.label) {
        wrap.querySelectorAll(`.${GOAL_LOOP_PILL_CLASS}`).forEach(node => node.remove());
        pruneStickyComposerPillsOnlyHost(wrap);
        return;
    }
    const row = ensureStickyComposerPillRow(wrap, card);
    if (!row) {
        return;
    }
    const pill = row.querySelector<HTMLElement>(`:scope > .${GOAL_LOOP_PILL_CLASS}`) ?? createGoalLoopPill();
    const labelEl = pill.querySelector(`.${GOAL_LOOP_PILL_LABEL_CLASS}`);
    if (labelEl && labelEl.textContent !== options.label) {
        labelEl.textContent = options.label;
    }
    const aria = nls.localize('theia/qaap/goalLoop/pillAria', 'Until done — {0}', options.label);
    pill.title = aria;
    pill.setAttribute('aria-label', aria);
    if (pill.parentElement !== row) {
        // After the Step pill when present, else first: the loop status leads the strip.
        const step = row.querySelector(`:scope > .${STEP_PILL_CLASS}`);
        if (step) {
            step.after(pill);
        } else {
            row.insertBefore(pill, row.firstChild);
        }
    }
}

function createGoalLoopPill(): HTMLElement {
    const pill = document.createElement('span');
    pill.className = GOAL_LOOP_PILL_CLASS;
    pill.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = 'codicon codicon-sync codicon-modifier-spin';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = GOAL_LOOP_PILL_LABEL_CLASS;
    pill.append(icon, label);
    return pill;
}

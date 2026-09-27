// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGoalLoopChipView } from '@theia/qaap-shared-core/lib/common/qaap-agent-goal-loop-labels';

export const TRANSCRIPT_GOAL_LOOP_CHIP_CLASS = 'theia-mobile-transcript-goal-loop-chip';
/** Both transcript headers (overlay sheet and Agents Hub inline) host their tab strip in this element. */
const EXECUTION_TABS_HOST_SELECTOR = '.theia-mobile-projects-header-execution-tabs';
const TONES = ['running', 'ok', 'fail', 'cancelled'] as const;

/**
 * Goal loop phase chip in the transcript header, placed right before the execution tab strip:
 * "Executing 2/8" (running), "Goal done" (ok), "Goal blocked" (fail, tooltip = stop reason),
 * "Goal cancelled". `view === undefined` removes it.
 */
export function syncTranscriptGoalLoopChips(root: ParentNode, view: QaapGoalLoopChipView | undefined): void {
    root.querySelectorAll(EXECUTION_TABS_HOST_SELECTOR).forEach(tabsHost => {
        if (tabsHost instanceof HTMLElement) {
            syncTranscriptGoalLoopChip(tabsHost, view);
        }
    });
}

export function syncTranscriptGoalLoopChip(tabsHost: HTMLElement, view: QaapGoalLoopChipView | undefined): void {
    const parent = tabsHost.parentElement;
    if (!parent) {
        return;
    }
    const existing = parent.querySelector<HTMLElement>(`:scope > .${TRANSCRIPT_GOAL_LOOP_CHIP_CLASS}`);
    if (!view || tabsHost.hidden) {
        existing?.remove();
        return;
    }
    const chip = existing ?? createChip();
    for (const tone of TONES) {
        chip.classList.toggle(`theia-mod-${tone}`, tone === view.tone);
    }
    chip.dataset.goalLoopPhase = view.phase;
    const label = chip.querySelector(`.${TRANSCRIPT_GOAL_LOOP_CHIP_CLASS}-label`);
    if (label && label.textContent !== view.label) {
        label.textContent = view.label;
    }
    const icon = chip.querySelector(`.${TRANSCRIPT_GOAL_LOOP_CHIP_CLASS}-icon`);
    if (icon) {
        icon.className = `${TRANSCRIPT_GOAL_LOOP_CHIP_CLASS}-icon codicon ${iconClass(view)}`;
    }
    chip.title = view.title;
    chip.setAttribute('aria-label', view.title === view.label ? view.label : `${view.label}. ${view.title}`);
    if (chip.nextElementSibling !== tabsHost) {
        parent.insertBefore(chip, tabsHost);
    }
}

function createChip(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = TRANSCRIPT_GOAL_LOOP_CHIP_CLASS;
    chip.setAttribute('role', 'status');
    const icon = document.createElement('span');
    icon.className = `${TRANSCRIPT_GOAL_LOOP_CHIP_CLASS}-icon codicon`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = `${TRANSCRIPT_GOAL_LOOP_CHIP_CLASS}-label`;
    chip.append(icon, label);
    return chip;
}

function iconClass(view: QaapGoalLoopChipView): string {
    switch (view.tone) {
        case 'ok':
            return 'codicon-pass';
        case 'fail':
            return 'codicon-warning';
        case 'cancelled':
            return 'codicon-circle-slash';
        default:
            return 'codicon-sync codicon-modifier-spin';
    }
}

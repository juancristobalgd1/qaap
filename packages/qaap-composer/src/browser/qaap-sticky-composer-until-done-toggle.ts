// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { bindStickyComposerControlClick } from '../common/qaap-sticky-composer-control-click';

export const UNTIL_DONE_TOGGLE_CLASS = 'theia-mobile-projects-sticky-composer-until-done';

export interface StickyComposerUntilDoneToggleOptions {
    readonly checked: boolean;
    /** Tooltip when the toggle cannot be used (manual approval, Plan mode); disables it. */
    readonly disabledReason?: string;
    readonly onToggle: (checked: boolean) => void;
    /** When set, a disabled row offers to fix its cause (e.g. open the approval picker). */
    readonly onResolveDisabled?: () => void;
}

/**
 * "Until done" toolbar toggle (agent goal loop) next to the mode / approval controls. A plain
 * `aria-pressed` button; when disabled it stays focusable so the tooltip still explains why.
 */
export function createStickyComposerUntilDoneToggle(options: StickyComposerUntilDoneToggleOptions): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = UNTIL_DONE_TOGGLE_CLASS;
    const disabled = !!options.disabledReason;
    const checked = options.checked && !disabled;
    button.classList.toggle('theia-mod-checked', checked);
    button.classList.toggle('theia-mod-disabled', disabled);
    button.setAttribute('aria-pressed', String(checked));
    if (disabled) {
        button.setAttribute('aria-disabled', 'true');
        button.dataset.disabledReason = options.disabledReason;
    }
    const label = nls.localize('theia/qaap/goalLoop/untilDone', 'Goal');
    button.title = disabled
        ? options.disabledReason!
        : checked
            ? nls.localize('theia/qaap/goalLoop/untilDoneOnTitle', 'Goal: the agent keeps iterating, verifying and reviewing until the goal is met')
            : nls.localize('theia/qaap/goalLoop/untilDoneOffTitle', 'Goal: off — run a single turn');
    button.setAttribute('aria-label', `${label}. ${button.title}`);

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-target';
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = `${UNTIL_DONE_TOGGLE_CLASS}-label`;
    text.textContent = label;
    button.append(icon, text);

    bindStickyComposerControlClick(button, ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (disabled) {
            return;
        }
        options.onToggle(!checked);
    });
    return button;
}

/** Whether "Until done" is on and usable (disabled toggles never count as checked). */
export function isStickyComposerUntilDoneActive(options: StickyComposerUntilDoneToggleOptions | undefined): boolean {
    return !!options && options.checked && !options.disabledReason;
}

/**
 * "Until done" as a checkable row at the end of the Mode sheet (Build / Plan…), so the goal loop
 * lives with the other run-mode choices instead of taking a toolbar slot.
 */
export function createStickyComposerUntilDoneSheetOption(
    options: StickyComposerUntilDoneToggleOptions,
    onDidToggle: () => void,
): HTMLButtonElement {
    const disabled = !!options.disabledReason;
    const resolvable = disabled && !!options.onResolveDisabled;
    const checked = isStickyComposerUntilDoneActive(options);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theia-mobile-sticky-composer-sheet-option ${UNTIL_DONE_TOGGLE_CLASS}-option`;
    btn.setAttribute('role', 'menuitemcheckbox');
    btn.setAttribute('aria-checked', String(checked));
    btn.classList.toggle('theia-mod-selected', checked);
    btn.classList.toggle('theia-mod-disabled', disabled && !resolvable);
    btn.classList.toggle('theia-mod-resolvable', resolvable);
    if (disabled && !resolvable) {
        btn.setAttribute('aria-disabled', 'true');
    }
    btn.title = disabled
        ? options.disabledReason!
        : nls.localize('theia/qaap/goalLoop/untilDoneOnTitle', 'Goal: the agent keeps iterating, verifying and reviewing until the goal is met');

    const content = document.createElement('span');
    content.className = 'theia-mobile-sticky-composer-sheet-option-content';
    const icon = document.createElement('span');
    icon.className = 'codicon codicon-target';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'theia-mobile-sticky-composer-sheet-option-label';
    label.textContent = nls.localize('theia/qaap/goalLoop/untilDone', 'Goal');
    content.append(icon, label);
    if (checked) {
        const check = document.createElement('span');
        check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
        check.setAttribute('aria-hidden', 'true');
        content.append(check);
    }
    // Touch has no tooltips: always say what Goal does, or why it is unavailable and how to fix it.
    const hint = document.createElement('span');
    hint.className = `${UNTIL_DONE_TOGGLE_CLASS}-option-hint`;
    hint.textContent = !disabled
        ? nls.localize('theia/qaap/goalLoop/untilDoneDescription', 'Keeps working and verifying until the goal is met')
        : resolvable
            ? nls.localize('theia/qaap/goalLoop/requiresAutoApproveAction', '{0} · Change approvals', options.disabledReason!)
            : options.disabledReason!;
    content.append(hint);
    btn.append(content);
    btn.addEventListener('click', event => {
        event.stopPropagation();
        if (resolvable) {
            onDidToggle();
            options.onResolveDisabled!();
            return;
        }
        if (disabled) {
            return;
        }
        onDidToggle();
        options.onToggle(!checked);
    });
    return btn;
}

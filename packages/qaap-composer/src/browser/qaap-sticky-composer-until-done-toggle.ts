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
    const label = nls.localize('theia/qaap/goalLoop/untilDone', 'Until done');
    button.title = disabled
        ? options.disabledReason!
        : checked
            ? nls.localize('theia/qaap/goalLoop/untilDoneOnTitle', 'Until done: the agent keeps iterating, verifying and reviewing until the goal is met')
            : nls.localize('theia/qaap/goalLoop/untilDoneOffTitle', 'Until done: off — run a single turn');
    button.setAttribute('aria-label', `${label}. ${button.title}`);

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-sync';
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

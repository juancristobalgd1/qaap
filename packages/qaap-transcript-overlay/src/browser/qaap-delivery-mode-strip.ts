// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** How to deliver a follow-up while an agent is already working. */
export type QaapComposerDeliveryMode = 'queue' | 'parallel' | 'interrupt';

export interface QaapDeliveryModeStripOptions {
    readonly draft: string;
    readonly onChoose: (mode: QaapComposerDeliveryMode) => void;
    readonly onDismiss: () => void;
}

/**
 * Inline strip above the composer (Cursor-style) so the user picks queue / isolated
 * parallel / interrupt without blocking the input.
 */
export function renderQaapDeliveryModeStrip(options: QaapDeliveryModeStripOptions): HTMLElement {
    const strip = document.createElement('div');
    strip.className = 'qaap-delivery-mode-strip';
    strip.setAttribute('role', 'region');
    strip.setAttribute('aria-label', nls.localize(
        'qaap/mobileProjects/deliveryModeStripLabel',
        'Choose how to send your message while the agent is working',
    ));

    const topRow = document.createElement('div');
    topRow.className = 'qaap-delivery-mode-strip-top';

    const statusIcon = document.createElement('span');
    statusIcon.className = 'qaap-delivery-mode-strip-icon codicon codicon-sync~spin';
    statusIcon.setAttribute('aria-hidden', 'true');

    const draftPreview = document.createElement('span');
    draftPreview.className = 'qaap-delivery-mode-strip-draft';
    const previewText = options.draft.length > 80
        ? options.draft.slice(0, 80) + '\u2026'
        : options.draft;
    draftPreview.textContent = previewText;
    draftPreview.title = options.draft;

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'qaap-delivery-mode-strip-dismiss';
    dismissBtn.setAttribute('aria-label', nls.localize('qaap/mobileProjects/dismissDelivery', 'Dismiss'));
    const dismissIcon = document.createElement('span');
    dismissIcon.className = 'codicon codicon-close';
    dismissBtn.append(dismissIcon);
    dismissBtn.addEventListener('click', () => options.onDismiss());

    topRow.append(statusIcon, draftPreview, dismissBtn);
    strip.append(topRow);

    const pills = document.createElement('div');
    pills.className = 'qaap-delivery-mode-strip-pills';

    const choices: Array<{
        mode: QaapComposerDeliveryMode;
        iconClass: string;
        label: string;
        title: string;
    }> = [
        {
            mode: 'queue',
            iconClass: 'codicon codicon-clock',
            label: nls.localize('qaap/mobileProjects/deliveryQueue', 'Queue'),
            title: nls.localize(
                'qaap/mobileProjects/deliveryQueueTitle',
                'Wait for the current agent to finish, then process this message',
            ),
        },
        {
            mode: 'parallel',
            iconClass: 'codicon codicon-split-horizontal',
            label: nls.localize('qaap/mobileProjects/deliveryParallel', 'Parallel'),
            title: nls.localize(
                'qaap/mobileProjects/deliveryParallelTitle',
                'Start a new agent in an isolated worktree — no file conflicts with the current turn',
            ),
        },
        {
            mode: 'interrupt',
            iconClass: 'codicon codicon-stop-circle',
            label: nls.localize('qaap/mobileProjects/deliveryInterrupt', 'Interrupt'),
            title: nls.localize(
                'qaap/mobileProjects/deliveryInterruptTitle',
                'Cancel the current agent and process this message immediately',
            ),
        },
    ];

    for (const choice of choices) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'qaap-delivery-mode-pill theia-mod-' + choice.mode;
        pill.title = choice.title;
        const icon = document.createElement('span');
        icon.className = 'qaap-delivery-mode-pill-icon ' + choice.iconClass;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'qaap-delivery-mode-pill-label';
        label.textContent = choice.label;
        pill.append(icon, label);
        pill.addEventListener('click', () => options.onChoose(choice.mode));
        pills.append(pill);
    }

    strip.append(pills);
    return strip;
}

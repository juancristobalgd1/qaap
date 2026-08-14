// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapComposerDeliveryMode } from './qaap-delivery-mode-strip';

export type { QaapComposerDeliveryMode } from './qaap-delivery-mode-strip';

export const QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY = 'qaap.mobileProjects.composerDeliveryMode';
export const QAAP_DEFAULT_COMPOSER_DELIVERY_MODE: QaapComposerDeliveryMode = 'queue';

const DELIVERY_MODES: readonly QaapComposerDeliveryMode[] = ['queue', 'parallel', 'interrupt'];

export interface QaapComposerDeliveryModeChoice {
    readonly mode: QaapComposerDeliveryMode;
    readonly iconClass: string;
    readonly label: string;
    readonly title: string;
    readonly shortcut: string;
}

let memoryDeliveryMode: QaapComposerDeliveryMode = QAAP_DEFAULT_COMPOSER_DELIVERY_MODE;

export function isQaapComposerDeliveryMode(value: unknown): value is QaapComposerDeliveryMode {
    return value === 'queue' || value === 'parallel' || value === 'interrupt';
}

export function readComposerDeliveryMode(): QaapComposerDeliveryMode {
    if (typeof sessionStorage === 'undefined') {
        return memoryDeliveryMode;
    }
    try {
        const raw = sessionStorage.getItem(QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY);
        if (isQaapComposerDeliveryMode(raw)) {
            memoryDeliveryMode = raw;
            return raw;
        }
    } catch {
        /* sessionStorage may be unavailable */
    }
    return memoryDeliveryMode;
}

export function writeComposerDeliveryMode(mode: QaapComposerDeliveryMode): void {
    memoryDeliveryMode = mode;
    if (typeof sessionStorage === 'undefined') {
        return;
    }
    try {
        sessionStorage.setItem(QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY, mode);
    } catch {
        /* ignore quota / private-mode failures */
    }
}

function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') {
        return false;
    }
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
        || /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function resolveComposerDeliveryModeShortcut(mode: QaapComposerDeliveryMode): string {
    if (mode === 'parallel') {
        return nls.localize('qaap/mobileProjects/deliveryParallelShortcut', 'Shift+Enter');
    }
    if (mode === 'interrupt') {
        return isApplePlatform()
            ? nls.localize('qaap/mobileProjects/deliveryInterruptShortcutMac', '⌘Enter')
            : nls.localize('qaap/mobileProjects/deliveryInterruptShortcut', 'Ctrl+Enter');
    }
    return nls.localize('qaap/mobileProjects/deliveryQueueShortcut', 'Enter');
}

export function listComposerDeliveryModeChoices(): readonly QaapComposerDeliveryModeChoice[] {
    return DELIVERY_MODES.map(mode => {
        if (mode === 'parallel') {
            return {
                mode,
                iconClass: 'codicon codicon-split-horizontal',
                label: nls.localize('qaap/mobileProjects/deliveryParallel', 'Parallel'),
                title: nls.localize(
                    'qaap/mobileProjects/deliveryParallelTitle',
                    'Start a new agent in an isolated worktree — no file conflicts with the current turn',
                ),
                shortcut: resolveComposerDeliveryModeShortcut(mode),
            };
        }
        if (mode === 'interrupt') {
            return {
                mode,
                iconClass: 'codicon codicon-stop-circle',
                label: nls.localize('qaap/mobileProjects/deliveryInterrupt', 'Interrupt'),
                title: nls.localize(
                    'qaap/mobileProjects/deliveryInterruptTitle',
                    'Cancel the current agent and process this message immediately',
                ),
                shortcut: resolveComposerDeliveryModeShortcut(mode),
            };
        }
        return {
            mode,
            iconClass: 'codicon codicon-clock',
            label: nls.localize('qaap/mobileProjects/deliveryQueue', 'Queue'),
            title: nls.localize(
                'qaap/mobileProjects/deliveryQueueTitle',
                'Wait for the current agent to finish, then process this message',
            ),
            shortcut: resolveComposerDeliveryModeShortcut(mode),
        };
    });
}

export function resolveComposerDeliveryModeLabel(mode: QaapComposerDeliveryMode): string {
    return listComposerDeliveryModeChoices().find(choice => choice.mode === mode)?.label
        ?? nls.localize('qaap/mobileProjects/deliveryQueue', 'Queue');
}

export function resolveComposerDeliveryModeIconClass(mode: QaapComposerDeliveryMode): string {
    return listComposerDeliveryModeChoices().find(choice => choice.mode === mode)?.iconClass
        ?? 'codicon codicon-clock';
}

/**
 * One-shot override from a composer Enter keydown.
 * Plain Enter uses the persisted selector; Shift+Enter is Parallel; Cmd/Ctrl+Enter is Interrupt.
 */
export function resolveComposerEnterDeliveryOverride(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>): QaapComposerDeliveryMode | undefined {
    if (event.key !== 'Enter' || event.altKey) {
        return undefined;
    }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey) {
        return 'parallel';
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
        return 'interrupt';
    }
    return undefined;
}

export function resolveBusyFollowUpDeliveryMode(options: {
    readonly forceDeliveryMode?: QaapComposerDeliveryMode;
    readonly selectedDeliveryMode?: QaapComposerDeliveryMode;
}): QaapComposerDeliveryMode {
    return options.forceDeliveryMode
        ?? options.selectedDeliveryMode
        ?? QAAP_DEFAULT_COMPOSER_DELIVERY_MODE;
}

export function shouldBypassLocalFollowUpQueue(mode: QaapComposerDeliveryMode): boolean {
    return mode === 'parallel' || mode === 'interrupt';
}

export function populateDeliveryModeToolbarButton(
    button: HTMLButtonElement,
    options: {
        readonly mode: QaapComposerDeliveryMode;
        readonly label?: string;
    },
): void {
    const choice = listComposerDeliveryModeChoices().find(item => item.mode === options.mode);
    const labelText = options.label ?? choice?.label ?? resolveComposerDeliveryModeLabel(options.mode);
    button.replaceChildren();
    const icon = document.createElement('span');
    icon.className = 'qaap-delivery-mode-toolbar-icon ' + (choice?.iconClass ?? 'codicon codicon-clock');
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'theia-mobile-projects-sticky-composer-mode-label';
    label.textContent = labelText;
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(icon, label, chevron);
}

export function renderQaapDeliveryModeMenu(options: {
    readonly selected: QaapComposerDeliveryMode;
    readonly onChoose: (mode: QaapComposerDeliveryMode) => void;
}): HTMLElement {
    const list = document.createElement('div');
    list.className = 'theia-mobile-sticky-composer-sheet-list qaap-delivery-mode-menu';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', nls.localize(
        'qaap/mobileProjects/deliveryModeMenuLabel',
        'Choose how to send follow-ups while an agent is working',
    ));
    for (const choice of listComposerDeliveryModeChoices()) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-sticky-composer-sheet-option qaap-delivery-mode-menu-option theia-mod-' + choice.mode;
        btn.setAttribute('role', 'menuitemradio');
        btn.setAttribute('aria-checked', choice.mode === options.selected ? 'true' : 'false');
        btn.title = choice.title;
        if (choice.mode === options.selected) {
            btn.classList.add('theia-mod-selected');
        }
        const content = document.createElement('span');
        content.className = 'theia-mobile-sticky-composer-sheet-option-content';
        const icon = document.createElement('span');
        icon.className = 'qaap-delivery-mode-menu-icon ' + choice.iconClass;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-sticky-composer-sheet-option-label';
        label.textContent = choice.label;
        const shortcut = document.createElement('span');
        shortcut.className = 'qaap-delivery-mode-menu-shortcut';
        shortcut.textContent = choice.shortcut;
        content.append(icon, label, shortcut);
        if (choice.mode === options.selected) {
            const check = document.createElement('span');
            check.className = 'codicon codicon-check theia-mobile-sticky-composer-sheet-option-check';
            check.setAttribute('aria-hidden', 'true');
            content.append(check);
        }
        btn.append(content);
        btn.addEventListener('click', event => {
            event.stopPropagation();
            options.onChoose(choice.mode);
        });
        list.append(btn);
    }
    return list;
}

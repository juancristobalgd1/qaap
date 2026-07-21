// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { createWorkHubWorkingAgentsIcon } from '@theia/qaap-adapters/lib/browser/qaap-lucide-icons';
import {
    WORKING_CONTROL_CLASS,
    ensureWorkingControlShell,
    isWorkingAgentsExpandPinnedOpen,
    reclaimParkedWorkingControlIntoRow,
} from './qaap-sticky-composer-working-agents-popover';

export interface StickyComposerWorkingPillOptions {
    readonly count: number;
    readonly onOpen: (anchor: HTMLButtonElement) => void;
    /**
     * Stop All / explicit clear — remove the pill even if an expand session was pinned
     * for reading after summary/settled.
     */
    readonly forceHide?: boolean;
}

const WORKING_PILL_CLASS = 'theia-mobile-sticky-composer-working-pill';
const WORKING_ONLY_HOST_CLASS = 'theia-mod-working-only';

/**
 * Cursor-style "N Working" pill above the sticky composer card.
 * Prefers the Changes/Commit/Preview pill row when present; otherwise mounts a
 * matching host row so the affordance still sits above the composer.
 * Click expands the control in place into the working-agents panel.
 */
export function syncStickyComposerWorkingPill(
    wrap: HTMLElement,
    options: StickyComposerWorkingPillOptions,
): void {
    const card = wrap.querySelector(':scope > .theia-mobile-projects-sticky-composer-card');
    if (!(card instanceof HTMLElement)) {
        return;
    }

    const workingOnlyHost = wrap.querySelector(
        `:scope > .theia-mobile-sticky-composer-changes-pill-host.${WORKING_ONLY_HOST_CLASS}`,
    );
    const changesHost = Array.from(
        wrap.querySelectorAll(':scope > .theia-mobile-sticky-composer-changes-pill-host'),
    ).find(host => !host.classList.contains(WORKING_ONLY_HOST_CLASS));

    if (options.count <= 0) {
        // Summary/settled can report 0 working while the user still has the expand open.
        // Never tear down that control — unless Stop All (forceHide) explicitly clears it.
        if (isWorkingAgentsExpandPinnedOpen() && !options.forceHide) {
            return;
        }
        wrap.querySelectorAll(`.${WORKING_CONTROL_CLASS}, .${WORKING_PILL_CLASS}`).forEach(node => {
            if (node.classList.contains(WORKING_CONTROL_CLASS)) {
                node.remove();
                return;
            }
            if (!node.closest(`.${WORKING_CONTROL_CLASS}`)) {
                node.remove();
            }
        });
        workingOnlyHost?.remove();
        return;
    }

    if (changesHost instanceof HTMLElement) {
        const row = changesHost.querySelector(':scope .theia-mobile-sticky-composer-changes-pill-row');
        if (row instanceof HTMLElement) {
            upsertWorkingPillInRow(row, options);
            workingOnlyHost?.remove();
            return;
        }
    }

    let host = workingOnlyHost instanceof HTMLElement ? workingOnlyHost : undefined;
    if (!host) {
        host = createWorkingOnlyPillHost();
        wrap.insertBefore(host, card);
    }
    const row = host.querySelector('.theia-mobile-sticky-composer-changes-pill-row');
    if (row instanceof HTMLElement) {
        upsertWorkingPillInRow(row, options);
    }
}

/** Sync the Working pill into every sticky-composer column under the given roots. */
export function syncStickyComposerWorkingPillInRoots(
    roots: ReadonlyArray<HTMLElement | undefined | null>,
    options: StickyComposerWorkingPillOptions,
): void {
    for (const root of roots) {
        if (!root?.isConnected) {
            continue;
        }
        const wraps = root.querySelectorAll('.theia-mobile-projects-sticky-composer-inner');
        wraps.forEach(wrap => {
            if (wrap instanceof HTMLElement) {
                syncStickyComposerWorkingPill(wrap, options);
            }
        });
    }
}

function createWorkingOnlyPillHost(): HTMLElement {
    const host = document.createElement('div');
    host.className = `theia-mobile-sticky-composer-changes-pill-host ${WORKING_ONLY_HOST_CLASS}`;
    const section = document.createElement('div');
    section.className = 'theia-mobile-sticky-composer-activity-section theia-mod-files theia-mod-changes-pill';
    const row = document.createElement('div');
    row.className = 'theia-mobile-sticky-composer-changes-pill-row';
    section.append(row);
    host.append(section);
    return host;
}

function upsertWorkingPillInRow(row: HTMLElement, options: StickyComposerWorkingPillOptions): void {
    // Prefer the parked open control (survives composer remounts) over creating a fresh pill.
    if (reclaimParkedWorkingControlIntoRow(row, { onOpen: options.onOpen })) {
        const pill = row.querySelector<HTMLButtonElement>(
            `:scope > .${WORKING_CONTROL_CLASS} > .${WORKING_PILL_CLASS}`,
        );
        if (pill) {
            applyWorkingPillContent(pill, options);
            bindWorkingPillClick(pill, options.onOpen);
        }
        return;
    }

    const existingControl = row.querySelector(`:scope > .${WORKING_CONTROL_CLASS}`);
    const existingPill = (existingControl?.querySelector(`:scope > .${WORKING_PILL_CLASS}`)
        ?? row.querySelector(`:scope > .${WORKING_PILL_CLASS}`));
    if (existingPill instanceof HTMLButtonElement) {
        applyWorkingPillContent(existingPill, options);
        bindWorkingPillClick(existingPill, options.onOpen);
        const shell = ensureWorkingControlShell(existingPill);
        if (row.firstElementChild !== shell) {
            row.insertBefore(shell, row.firstChild);
        }
        return;
    }
    const pill = createWorkingPillButton(options);
    const shell = ensureWorkingControlShell(pill);
    row.insertBefore(shell, row.firstChild);
}

function createWorkingPillButton(options: StickyComposerWorkingPillOptions): HTMLButtonElement {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = WORKING_PILL_CLASS;
    pill.setAttribute('aria-haspopup', 'dialog');
    pill.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'theia-mobile-sticky-composer-working-pill-label';
    pill.append(createWorkHubWorkingAgentsIcon(), label);
    bindWorkingPillClick(pill, options.onOpen);
    applyWorkingPillContent(pill, options);
    return pill;
}

function bindWorkingPillClick(
    pill: HTMLButtonElement,
    onOpen: (anchor: HTMLButtonElement) => void,
): void {
    // Property assignment replaces any prior handler so re-sync keeps a fresh callback.
    pill.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(pill);
    };
}

function applyWorkingPillContent(pill: HTMLButtonElement, options: StickyComposerWorkingPillOptions): void {
    const labelEl = pill.querySelector('.theia-mobile-sticky-composer-working-pill-label');
    const label = nls.localize('qaap/workHubChrome/workingPill', '{0} Working', String(options.count));
    const aria = nls.localize(
        'qaap/workHubChrome/workingPillAria',
        '{0} agents working — open queue',
        String(options.count),
    );
    if (labelEl) {
        labelEl.textContent = label;
    }
    pill.title = aria;
    pill.setAttribute('aria-label', aria);
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Information card for a sessions sidebar task row: rest the pointer on the row (or focus it with
// the keyboard) and a floating card to its right lists the task's full title, project, worktree,
// branch, agent · model, status, last activity, diff stats and pull requests. Desktop only: it is
// never armed on touch or on devices whose primary pointer cannot hover.

import { createAgentBrandIcon } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import { QaapLiveTaskDiff } from '@theia/qaap-shared-core/lib/common/qaap-live-task-diff';
import { nls } from '@theia/core/lib/common/nls';
import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { computeQaapTaskHoverCardPosition, type QaapTaskHoverCardLine, type QaapTaskHoverCardModel } from './qaap-task-hover-card-model';

/** Media query of devices whose primary pointer can rest on a row. */
export const QAAP_TASK_HOVER_CARD_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

/** How long the pointer (or keyboard focus) rests on a row before the card appears. */
export const QAAP_TASK_HOVER_CARD_DELAY_MS = 400;

const CARD_CLASS = 'theia-qaap-task-hover-card';
const CARD_ID = 'theia-qaap-task-hover-card';
const ATTACHED_ATTR = 'qaapTaskHoverCard';

/**
 * True when rows should show the hover card instead of a native `title` tooltip: a fine pointer
 * that hovers, outside the narrow (one-column) layout. Safe without `window`.
 */
export function isQaapTaskHoverCardSupported(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(QAAP_TASK_HOVER_CARD_MEDIA_QUERY).matches && !matchesMobileNarrowViewport();
}

/** Shows at most one task hover card at a time; rows attach to the shared instance. */
export class QaapTaskHoverCard {

    protected card: HTMLElement | undefined;
    protected pendingTimer: number | undefined;
    /** Row the card is shown for (or scheduled for). */
    protected activeRow: HTMLElement | undefined;
    protected activeTrigger: HTMLElement | undefined;
    protected globalListenersBound = false;

    /**
     * Arms `row` (whose focusable main control is `trigger`): `resolve` is called when the card is
     * about to show, so it reflects the task's latest state rather than the render's.
     */
    attach(row: HTMLElement, trigger: HTMLElement, resolve: () => QaapTaskHoverCardModel | undefined): void {
        if (row.dataset[ATTACHED_ATTR] === 'true') {
            return;
        }
        row.dataset[ATTACHED_ATTR] = 'true';
        row.addEventListener('pointerenter', event => {
            if (event.pointerType === 'mouse' && isQaapTaskHoverCardSupported()) {
                this.schedule(row, trigger, resolve);
            }
        });
        row.addEventListener('pointerleave', event => {
            if (event.pointerType === 'mouse' && this.activeRow === row && !this.isKeyboardFocused(trigger)) {
                this.hide();
            }
        });
        // Clicking the row (open, archive, menu, retry) dismisses the card and never waits on it.
        row.addEventListener('pointerdown', () => this.hideFor(row), { capture: true });
        row.addEventListener('click', () => this.hideFor(row), { capture: true });
        row.addEventListener('contextmenu', () => this.hideFor(row), { capture: true });
        trigger.addEventListener('focus', () => {
            // Only keyboard focus: a mouse click also focuses the button but already dismissed the card.
            if (this.isKeyboardFocused(trigger) && isQaapTaskHoverCardSupported()) {
                this.schedule(row, trigger, resolve);
            }
        });
        trigger.addEventListener('blur', () => this.hideFor(row));
    }

    hide(): void {
        if (this.pendingTimer !== undefined) {
            window.clearTimeout(this.pendingTimer);
            this.pendingTimer = undefined;
        }
        this.activeTrigger?.removeAttribute('aria-describedby');
        this.activeRow = undefined;
        this.activeTrigger = undefined;
        const card = this.card;
        if (card) {
            try {
                card.hidePopover?.();
            } catch {
                // Not shown as a popover (engine without the Popover API): removing it is enough.
            }
            card.remove();
            this.card = undefined;
        }
        this.unbindGlobalListeners();
    }

    protected hideFor(row: HTMLElement): void {
        if (this.activeRow === row) {
            this.hide();
        }
    }

    protected isKeyboardFocused(trigger: HTMLElement): boolean {
        try {
            return trigger.matches(':focus-visible');
        } catch {
            return false;
        }
    }

    protected schedule(row: HTMLElement, trigger: HTMLElement, resolve: () => QaapTaskHoverCardModel | undefined): void {
        if (this.activeRow === row && (this.card || this.pendingTimer !== undefined)) {
            return;
        }
        this.hide();
        this.activeRow = row;
        this.activeTrigger = trigger;
        this.bindGlobalListeners();
        this.pendingTimer = window.setTimeout(() => {
            this.pendingTimer = undefined;
            if (this.activeRow !== row || !row.isConnected) {
                this.hide();
                return;
            }
            const model = resolve();
            if (!model) {
                this.hide();
                return;
            }
            this.show(row, trigger, model);
        }, QAAP_TASK_HOVER_CARD_DELAY_MS);
    }

    protected show(row: HTMLElement, trigger: HTMLElement, model: QaapTaskHoverCardModel): void {
        const card = this.renderCard(model);
        this.card = card;
        const doc = row.ownerDocument;
        doc.body.append(card);
        // Top layer when available so the card is never clipped by the sidebar's stacking context.
        try {
            card.showPopover?.();
        } catch {
            // Not supported in this engine: the fixed position and z-index still apply.
        }
        const view = doc.defaultView ?? window;
        const anchor = row.getBoundingClientRect();
        const size = card.getBoundingClientRect();
        const position = computeQaapTaskHoverCardPosition(
            anchor,
            { width: size.width, height: size.height },
            { width: view.innerWidth, height: view.innerHeight },
        );
        card.style.left = `${position.left}px`;
        card.style.top = `${position.top}px`;
        card.classList.add(`theia-mod-side-${position.side}`, 'theia-mod-visible');
        trigger.setAttribute('aria-describedby', CARD_ID);
    }

    protected renderCard(model: QaapTaskHoverCardModel): HTMLElement {
        const card = document.createElement('div');
        card.className = CARD_CLASS;
        card.id = CARD_ID;
        card.setAttribute('role', 'tooltip');
        card.setAttribute('popover', 'manual');
        const title = document.createElement('div');
        title.className = `${CARD_CLASS}-title`;
        title.textContent = model.title;
        card.append(title);
        if (model.lines.length > 0) {
            const list = document.createElement('ul');
            list.className = `${CARD_CLASS}-lines`;
            for (const line of model.lines) {
                list.append(this.renderLine(line));
            }
            card.append(list);
        }
        return card;
    }

    /** The harness logos of an `agent` line, or `undefined` (codicon) when no harness has a logo. */
    protected renderAgentLogos(line: QaapTaskHoverCardLine): HTMLElement | undefined {
        if (line.kind !== 'agent' || !line.agentIds?.length) {
            return undefined;
        }
        const logos = line.agentIds
            .map(agentId => createAgentBrandIcon(agentId, 'sm'))
            .filter((logo): logo is HTMLElement => !!logo);
        if (logos.length === 0) {
            return undefined;
        }
        const host = document.createElement('span');
        host.className = `${CARD_CLASS}-icon ${CARD_CLASS}-agent-logos`;
        host.append(...logos);
        return host;
    }

    protected renderLine(line: QaapTaskHoverCardLine): HTMLElement {
        const item = document.createElement('li');
        item.className = `${CARD_CLASS}-line theia-mod-${line.kind}`;
        if (line.modifierClass) {
            item.classList.add(...line.modifierClass.split(/\s+/).filter(Boolean));
        }
        const icon = this.renderAgentLogos(line) ?? document.createElement('span');
        if (!icon.className) {
            icon.className = `${CARD_CLASS}-icon codicon ${line.iconClass}`;
        }
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = `${CARD_CLASS}-text`;
        if (line.kind === 'diff') {
            // Visible "+N −M" in the diff colors; the localized sentence stays the accessible text.
            text.setAttribute('aria-label', line.text);
            const added = document.createElement('span');
            added.className = `${CARD_CLASS}-added`;
            added.textContent = `+${line.added ?? 0}`;
            added.setAttribute('aria-hidden', 'true');
            const removed = document.createElement('span');
            removed.className = `${CARD_CLASS}-removed`;
            removed.textContent = `−${line.removed ?? 0}`;
            removed.setAttribute('aria-hidden', 'true');
            text.append(added, removed);
            // Keep the counts current while the card is open; the binding releases once the card is removed.
            QaapLiveTaskDiff.bindTotals(text, line.baselineCommit, totals => {
                added.textContent = `+${Math.max(0, totals.added)}`;
                removed.textContent = `−${Math.max(0, totals.removed)}`;
                text.setAttribute('aria-label', nls.localize('qaap/taskHoverCard/diffStats', '{0} lines added, {1} removed', String(Math.max(0, totals.added)), String(Math.max(0, totals.removed))));
            });
        } else {
            text.textContent = line.text;
        }
        item.append(icon, text);
        return item;
    }

    protected readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && (this.card || this.pendingTimer !== undefined)) {
            this.hide();
        }
    };

    protected readonly onDismissingEvent = (): void => {
        this.hide();
    };

    /**
     * Only a scroll that moves the row (its list or the page) dismisses the card: the transcript
     * auto-scrolls while a reply streams, and that must not close a card over the sidebar.
     */
    protected readonly onScroll = (event: Event): void => {
        const row = this.activeRow;
        const target = event.target;
        if (!row || !(target instanceof Node) || target.nodeType === Node.DOCUMENT_NODE || target.contains(row)) {
            this.hide();
        }
    };

    /** Window size when the card was armed: only a real size change dismisses it. */
    protected armedViewport: { width: number; height: number } | undefined;

    /**
     * The Work Hub dispatches synthetic `resize` events to relayout its panels (the sessions sidebar
     * does on row updates), which dismissed the card before it ever showed. Only a real window
     * resize does.
     */
    protected readonly onWindowResize = (): void => {
        const armed = this.armedViewport;
        if (!armed || armed.width !== window.innerWidth || armed.height !== window.innerHeight) {
            this.hide();
        }
    };

    /** The row may be re-rendered away under a resting pointer: drop the card once it is detached. */
    protected readonly onDocumentPointerMove = (event: PointerEvent): void => {
        const row = this.activeRow;
        if (!row) {
            return;
        }
        if (!row.isConnected || (event.pointerType === 'mouse' && event.target instanceof Node && !row.contains(event.target)
            && !(this.activeTrigger && this.isKeyboardFocused(this.activeTrigger)))) {
            this.hide();
        }
    };

    protected bindGlobalListeners(): void {
        if (this.globalListenersBound) {
            return;
        }
        this.globalListenersBound = true;
        document.addEventListener('keydown', this.onDocumentKeyDown, true);
        document.addEventListener('pointermove', this.onDocumentPointerMove, { capture: true, passive: true });
        window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
        window.addEventListener('wheel', this.onDismissingEvent, { capture: true, passive: true });
        this.armedViewport = { width: window.innerWidth, height: window.innerHeight };
        window.addEventListener('resize', this.onWindowResize);
        window.addEventListener('blur', this.onDismissingEvent);
    }

    protected unbindGlobalListeners(): void {
        if (!this.globalListenersBound) {
            return;
        }
        this.globalListenersBound = false;
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);
        document.removeEventListener('pointermove', this.onDocumentPointerMove, true);
        window.removeEventListener('scroll', this.onScroll, true);
        window.removeEventListener('wheel', this.onDismissingEvent, true);
        window.removeEventListener('resize', this.onWindowResize);
        this.armedViewport = undefined;
        window.removeEventListener('blur', this.onDismissingEvent);
    }
}

let sharedTaskHoverCard: QaapTaskHoverCard | undefined;

/** The one card instance shared by every sessions sidebar row (one card at a time). */
export function getQaapTaskHoverCard(): QaapTaskHoverCard {
    if (!sharedTaskHoverCard) {
        sharedTaskHoverCard = new QaapTaskHoverCard();
    }
    return sharedTaskHoverCard;
}

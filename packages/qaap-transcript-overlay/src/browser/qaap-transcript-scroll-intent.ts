// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common';
import { ensureTranscriptScrollController } from './qaap-transcript-scroll-controller';

export const TRANSCRIPT_USER_SCROLL_INTENT_AT_ATTR = 'data-transcript-user-scroll-intent-at';
export const TRANSCRIPT_USER_SCROLL_INTENT_REASON_ATTR = 'data-transcript-user-scroll-intent-reason';

const RECENT_INTENT_WINDOW_MS = 1_200;
const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function eventHasUserIntent(event: Event): boolean {
    if (event instanceof KeyboardEvent) {
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && ['f', 'g'].includes(key)) {
            return true;
        }
        if (key === 'escape') {
            return true;
        }
        return ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'].includes(event.key);
    }
    return true;
}

export function markTranscriptUserScrollIntent(scroller: HTMLElement, reason: string, at = Date.now()): void {
    scroller.setAttribute(TRANSCRIPT_USER_SCROLL_INTENT_AT_ATTR, String(at));
    scroller.setAttribute(TRANSCRIPT_USER_SCROLL_INTENT_REASON_ATTR, reason);
    ensureTranscriptScrollController(scroller).notifyUserDetach(reason);
}

export function clearTranscriptUserScrollIntent(scroller: HTMLElement): void {
    scroller.removeAttribute(TRANSCRIPT_USER_SCROLL_INTENT_AT_ATTR);
    scroller.removeAttribute(TRANSCRIPT_USER_SCROLL_INTENT_REASON_ATTR);
}

export function transcriptHasActiveSelection(scroller: HTMLElement): boolean {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    return (!!anchor && scroller.contains(anchor)) || (!!focus && scroller.contains(focus));
}

export function transcriptHasInteractiveFocus(scroller: HTMLElement): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !scroller.contains(active)) {
        return false;
    }
    return active.matches(INTERACTIVE_SELECTOR) || !!active.closest(INTERACTIVE_SELECTOR);
}

export function transcriptHasRecentUserScrollIntent(scroller: HTMLElement, now = Date.now()): boolean {
    const at = Number(scroller.getAttribute(TRANSCRIPT_USER_SCROLL_INTENT_AT_ATTR));
    return Number.isFinite(at) && now - at <= RECENT_INTENT_WINDOW_MS;
}

export function shouldPauseTranscriptAutoFollow(scroller: HTMLElement): boolean {
    return transcriptHasActiveSelection(scroller)
        || transcriptHasInteractiveFocus(scroller)
        || transcriptHasRecentUserScrollIntent(scroller);
}

export function attachTranscriptScrollIntentObserver(scroller: HTMLElement): Disposable {
    const mark = (reason: string) => (): void => markTranscriptUserScrollIntent(scroller, reason);
    const onWheel = mark('wheel');
    const onTouch = mark('touch');
    const onPointer = (event: PointerEvent): void => {
        if (event.pointerType !== 'mouse' || event.buttons > 0) {
            markTranscriptUserScrollIntent(scroller, 'pointer');
        }
    };
    const onKeydown = (event: KeyboardEvent): void => {
        if (eventHasUserIntent(event)) {
            markTranscriptUserScrollIntent(scroller, 'keyboard');
        }
    };
    const onSelectionChange = (): void => {
        if (transcriptHasActiveSelection(scroller)) {
            markTranscriptUserScrollIntent(scroller, 'selection');
        }
    };
    const onFocusIn = (event: FocusEvent): void => {
        if (event.target instanceof HTMLElement && event.target.closest(INTERACTIVE_SELECTOR)) {
            markTranscriptUserScrollIntent(scroller, 'focus');
        }
    };
    const onClick = (event: MouseEvent): void => {
        if (event.target instanceof HTMLElement && event.target.closest('a[href], button, summary')) {
            markTranscriptUserScrollIntent(scroller, 'interaction');
        }
    };

    scroller.addEventListener('wheel', onWheel, { passive: true });
    scroller.addEventListener('touchstart', onTouch, { passive: true });
    scroller.addEventListener('touchmove', onTouch, { passive: true });
    scroller.addEventListener('pointerdown', onPointer, { passive: true });
    scroller.addEventListener('keydown', onKeydown);
    scroller.addEventListener('focusin', onFocusIn);
    scroller.addEventListener('click', onClick, true);
    document.addEventListener('selectionchange', onSelectionChange);

    return Disposable.create(() => {
        scroller.removeEventListener('wheel', onWheel);
        scroller.removeEventListener('touchstart', onTouch);
        scroller.removeEventListener('touchmove', onTouch);
        scroller.removeEventListener('pointerdown', onPointer);
        scroller.removeEventListener('keydown', onKeydown);
        scroller.removeEventListener('focusin', onFocusIn);
        scroller.removeEventListener('click', onClick, true);
        document.removeEventListener('selectionchange', onSelectionChange);
    });
}

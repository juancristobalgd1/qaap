// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface StickyComposerControlClickOptions {
    /** Runs once per press before activation (e.g. slash-menu pick-in-progress flags). */
    readonly onPressStart?: (ev: Event) => void;
}

const ACTIVATION_COOLDOWN_MS = 400;

/**
 * On mobile, tapping a composer control while the textarea is focused often blurs the
 * field (dismissing the keyboard) without delivering `click`. Swallow focus-steal on
 * pointer/touch down and activate on pointerup/click — same pattern as the mobile
 * keyboard accessory bar.
 *
 * A press is only treated as a tap if the pointer stays within a small radius while the
 * touch is held. This prevents a swipe/scroll gesture that begins on a control (e.g.
 * the empty-chat quick-action slider) from accidentally filling the composer prompt.
 */
const MAX_TAP_DRAG_PX = 10;

export function bindStickyComposerControlClick(
    control: HTMLElement,
    handler: (ev: Event) => void,
    options?: StickyComposerControlClickOptions,
): void {
    let pressStartAt = 0;
    let pressStartX = 0;
    let pressStartY = 0;
    let pressed = false;
    const onPressStart = (ev: Event): void => {
        ev.preventDefault();
        const point = pointerPoint(ev);
        pressStartX = point.x;
        pressStartY = point.y;
        pressed = true;
        if (!options?.onPressStart) {
            return;
        }
        const now = Date.now();
        if (now - pressStartAt < ACTIVATION_COOLDOWN_MS) {
            return;
        }
        pressStartAt = now;
        options.onPressStart(ev);
    };

    const swallowFocusSteal = (ev: Event): void => {
        ev.preventDefault();
    };

    const onPressMove = (ev: Event): void => {
        if (!pressed) {
            return;
        }
        const point = pointerPoint(ev);
        if (Math.hypot(point.x - pressStartX, point.y - pressStartY) > MAX_TAP_DRAG_PX) {
            pressed = false;
        }
    };

    const onPressCancel = (): void => {
        pressed = false;
    };

    control.addEventListener('mousedown', swallowFocusSteal);
    control.addEventListener('pointerdown', onPressStart);
    control.addEventListener('touchstart', onPressStart, { passive: false });
    control.addEventListener('pointermove', onPressMove);
    control.addEventListener('touchmove', onPressMove, { passive: true });
    control.addEventListener('pointercancel', onPressCancel);
    control.addEventListener('touchcancel', onPressCancel);
    control.addEventListener('pointerleave', onPressCancel);

    let lastActivationAt = 0;
    const activate = (ev: Event): void => {
        const wasPressed = pressed;
        pressed = false;
        if (!wasPressed) {
            return;
        }
        const now = Date.now();
        if (now - lastActivationAt < ACTIVATION_COOLDOWN_MS) {
            return;
        }
        lastActivationAt = now;
        handler(ev);
    };

    control.addEventListener('pointerup', activate);
    control.addEventListener('click', activate);
}

function pointerPoint(ev: Event): { x: number; y: number } {
    if (window.PointerEvent && ev instanceof PointerEvent) {
        return { x: ev.clientX, y: ev.clientY };
    }
    if (window.TouchEvent && ev instanceof TouchEvent) {
        const touch = ev.touches[0] ?? ev.changedTouches[0];
        if (touch) {
            return { x: touch.clientX, y: touch.clientY };
        }
    }
    if (ev instanceof MouseEvent) {
        return { x: ev.clientX, y: ev.clientY };
    }
    return { x: 0, y: 0 };
}

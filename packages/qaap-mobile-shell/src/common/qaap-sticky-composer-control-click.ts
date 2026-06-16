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
 */
export function bindStickyComposerControlClick(
    control: HTMLElement,
    handler: (ev: Event) => void,
    options?: StickyComposerControlClickOptions,
): void {
    let pressStartAt = 0;
    const onPressStart = (ev: Event): void => {
        ev.preventDefault();
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

    control.addEventListener('mousedown', swallowFocusSteal);
    control.addEventListener('pointerdown', onPressStart);
    control.addEventListener('touchstart', onPressStart, { passive: false });

    let lastActivationAt = 0;
    const activate = (ev: Event): void => {
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

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { positionStickyComposerPopover } from '@theia/qaap-transcript/lib/browser/qaap-sticky-composer-popover';
import { pickerPopoverHeight } from './qaap-composer-model-picker';

/**
 * The one placement for the picker, used on open, on every repaint (rail, search, effort) and on resize:
 * the height is set first, then the popover is placed with its bottom edge 8px over the pill and its
 * left edge on the pill (clamped 16px inside the viewport). The list scrolls inside the fixed height.
 */
export function placePickerAbove(popover: HTMLElement, anchor: HTMLElement | undefined): void {
    if (!anchor || !popover.classList.contains('qaap-sticky-composer-sheet-popover')) {
        return;
    }
    // The shared popover positioning reads this flag on every resize and scroll too.
    popover.dataset.placement = 'above-start';
    popover.style.height = `${pickerPopoverHeight(anchor.getBoundingClientRect().top, window.innerHeight)}px`;
    positionStickyComposerPopover(popover, anchor, 'start', Math.min(560, window.innerWidth - 32));
}

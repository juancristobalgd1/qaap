// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure, DOM-independent decision logic that decides whether a terminal link
 * should be *opened* (its handler executed) or whether the click should merely
 * *focus* the terminal.
 *
 * Extracted from {@link XtermLinkAdapter} so the behaviour can be unit-tested
 * without spinning up xterm.js. See `qaap-xterm-link-adapter.ts` for the wiring.
 *
 * Why this exists (the Qaap seam):
 *  - Upstream only opens a link on Cmd/Ctrl+click, or when a fragile touch
 *    heuristic matches a synthetic `click` to a preceding `touchend`.
 *  - That heuristic compared `event.pageX` against `touchEnd.pageX`, but a
 *    `TouchEvent` has no top-level `pageX` (the coordinates live in
 *    `changedTouches[0]`), so the distance guards were dead code (`NaN > 5`
 *    is always `false`) and only the 400ms window did any filtering.
 *  - On a real phone (Qaap is mobile-first) there is no modifier key, so a
 *    simple tap on an OAuth/login URL frequently failed to open.
 *
 * The rewritten logic:
 *  1. Cmd/Ctrl+click always opens (desktop standard, preserves text selection).
 *  2. On a touch-primary device (coarse pointer / no hover — i.e. a phone or
 *     tablet) every activation is a tap and opens the link. This is the robust
 *     mobile path: it does not depend on matching a synthetic click at all.
 *  3. On hybrid devices (touch laptop with a mouse) a click that was produced
 *     by a recent tap still opens, using a hardened match that reads the real
 *     touch coordinates and tolerates missing ones instead of silently passing.
 */

export interface TerminalLinkActivationContext {
    /** `true` when Cmd (macOS) / Ctrl (other) was held during the click. */
    modifierKeyDown: boolean;
    /**
     * `true` when the primary input is touch (coarse pointer / no hover),
     * i.e. a phone or tablet. On such devices every link activation is a tap.
     */
    touchPrimaryDevice: boolean;
    /** `true` when the activating click was produced by a recent tap. */
    recentTouch: boolean;
}

/**
 * Decide whether a terminal link click should open the link (`true`) or just
 * focus the terminal (`false`).
 */
export function shouldActivateTerminalLink(context: TerminalLinkActivationContext): boolean {
    return context.modifierKeyDown || context.touchPrimaryDevice || context.recentTouch;
}

/** Minimal shape of the activating click needed to match it to a tap. */
export interface ClickPoint {
    timeStamp: number;
    pageX: number;
    pageY: number;
}

/** Coordinates + time extracted from a `touchend` event's `changedTouches[0]`. */
export interface TouchEndInfo {
    timeStamp: number;
    /** `undefined` when the touch point could not be read. */
    pageX?: number;
    pageY?: number;
}

export interface TapMatchOptions {
    /**
     * Maximum delay (ms) between the `touchend` and the synthetic `click`.
     * Widened from upstream's 400ms because mobile browsers can delay the
     * synthetic click (300ms tap delay, layout, momentum settling).
     */
    maxDelayMs?: number;
    /**
     * Small negative tolerance (ms) for clock jitter, since the synthetic click
     * always follows the `touchend`.
     */
    minDelayMs?: number;
    /** Maximum distance (px) between the touch point and the click point. */
    maxDistancePx?: number;
}

export const DEFAULT_TAP_MATCH_OPTIONS: Required<TapMatchOptions> = {
    maxDelayMs: 1200,
    minDelayMs: -50,
    maxDistancePx: 24
};

/**
 * Extract the time and (when available) the page coordinates from a `touchend`.
 * A `TouchEvent` keeps coordinates in `changedTouches`, not at the top level;
 * reading them here is what upstream's cast to `MouseEvent` got wrong.
 */
export function touchEndInfo(event: TouchEvent): TouchEndInfo {
    const touch = event.changedTouches && event.changedTouches.length > 0
        ? event.changedTouches[0]
        : undefined;
    return {
        timeStamp: event.timeStamp,
        pageX: touch ? touch.pageX : undefined,
        pageY: touch ? touch.pageY : undefined
    };
}

/**
 * Decide whether a synthetic `click` was produced by a recent tap.
 *
 * Unlike upstream this reads the real touch coordinates and, crucially, does
 * NOT reject the match when coordinates are unavailable — it falls back to the
 * time window alone rather than silently passing a `NaN` comparison.
 */
export function wasRecentTap(click: ClickPoint, lastTouchEnd: TouchEndInfo | undefined, options?: TapMatchOptions): boolean {
    if (!lastTouchEnd) {
        return false;
    }
    const { maxDelayMs, minDelayMs, maxDistancePx } = { ...DEFAULT_TAP_MATCH_OPTIONS, ...options };

    const delay = click.timeStamp - lastTouchEnd.timeStamp;
    if (delay < minDelayMs || delay > maxDelayMs) {
        return false;
    }

    // Only enforce the distance guard when we actually know both points and the
    // click carries meaningful coordinates. If either is missing, accept on the
    // time window alone (the previous code compared against `undefined`, i.e.
    // `NaN`, which always passed anyway — now that is explicit and intentional).
    const hasTouchPoint = lastTouchEnd.pageX !== undefined && lastTouchEnd.pageY !== undefined;
    const hasClickPoint = Number.isFinite(click.pageX) && Number.isFinite(click.pageY);
    if (hasTouchPoint && hasClickPoint) {
        if (Math.abs(click.pageX - lastTouchEnd.pageX!) > maxDistancePx) {
            return false;
        }
        if (Math.abs(click.pageY - lastTouchEnd.pageY!) > maxDistancePx) {
            return false;
        }
    }

    return true;
}

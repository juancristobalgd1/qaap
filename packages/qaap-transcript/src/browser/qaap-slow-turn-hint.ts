// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Slow-turn hint ───────────────────────────────────────────────────────────
//
// A subtle, dismissible one-line hint rendered right after the process
// accordion once a turn has been continuously working for a long stretch
// (e.g. the underlying model is slow to respond). Driven entirely by the
// shared 1s ticker ({@link sharedSecondTicker}) -- no dedicated `setInterval`
// -- so it keeps ticking during quiet stretches with no new segments, which
// is exactly the "slow model" scenario this hint targets.
//
// Shown at most once per turn -- but once shown, it stays *visible* for the
// remainder of that turn: the turn's `turnStartMs` is recorded as "shown" the
// moment the hint is inserted, and if the process accordion element is later
// replaced wholesale by a full timeline rebuild mid-turn, the hint is
// re-inserted next to the fresh accordion (it is never re-scheduled through
// the threshold wait again). Dismissing the hint instead records the turn as
// "dismissed", which suppresses it permanently -- even across rebuilds --
// unlike the "shown" state. Callers should call {@link ensureSlowTurnHint}
// from every sync of the process accordion (creation and every subsequent
// streaming sync); it is cheap and idempotent.
//
// Optionally renders a "Stop turn" action next to the dismiss (✕) control
// when `options.onStopTurn` is supplied. Clicking it invokes the callback
// *and* dismisses the hint (permanently, like the ✕) -- there is nothing
// left for the hint to say once the turn has been asked to stop.
// ─────────────────────────────────────────────────────────────────────────────

import { nls } from '@theia/core/lib/common/nls';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';

/** CSS class on the hint element. */
export const MOBILE_SLOW_TURN_HINT_CLASS = 'theia-mobile-slow-turn-hint';

/**
 * Data attribute marking the hint element. It is always rendered as a sibling
 * of (immediately after) the process accordion -- never inside the accordion
 * or the execution-event timeline -- so the streaming patch/rebuild logic in
 * `qaap-execution-event-timeline.ts` never has to know about it. The
 * attribute lets {@link removeSlowTurnHint} identify it unambiguously.
 */
export const MOBILE_SLOW_TURN_HINT_ATTR = 'data-mobile-slow-turn-hint';

/** How long (ms) a turn must be continuously "working" before the hint appears. */
export const SLOW_TURN_HINT_THRESHOLD_MS = 90_000;

/** Per-turn hint lifecycle: shown at least once, or dismissed (permanently). */
type SlowTurnHintState = 'shown' | 'dismissed';

/**
 * Turns (keyed by `turnStartMs`) that have already shown -- or had dismissed
 * -- the hint. A simple LRU `Map` capped at {@link SLOW_TURN_HINT_SEEN_MAX} so
 * a long-lived session/tab can't grow this unboundedly.
 */
const slowTurnHintState = new Map<number, SlowTurnHintState>();
const SLOW_TURN_HINT_SEEN_MAX = 32;

function setSlowTurnHintState(turnStartMs: number, state: SlowTurnHintState): void {
    // Delete-then-set bumps the key to "most recently used" so the eviction
    // below only ever drops the oldest, still-untouched entries.
    slowTurnHintState.delete(turnStartMs);
    slowTurnHintState.set(turnStartMs, state);
    while (slowTurnHintState.size > SLOW_TURN_HINT_SEEN_MAX) {
        const oldest = slowTurnHintState.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        slowTurnHintState.delete(oldest);
    }
}

export interface SlowTurnHintOptions {
    /** Whether the turn is currently working/streaming. */
    readonly isWorking: boolean;
    /** Start timestamp (ms epoch) of the current turn, if known. */
    readonly turnStartMs: number | undefined;
    /**
     * Invoked when the user clicks the hint's "Stop turn" button. When
     * omitted, the hint renders without a stop button (dismiss-only). The
     * click also marks the turn "dismissed" (so the hint never reappears for
     * it) and removes the hint immediately -- callers do not need to call
     * anything themselves to make the hint go away.
     */
    readonly onStopTurn?: () => void;
}

/**
 * Ensures the slow-turn hint is registered against the shared 1s ticker for
 * `accordion`. Intended to be called from every sync of the process
 * accordion (initial creation and every subsequent streaming sync) so that a
 * fresh `accordion` element -- created whenever the row/timeline is rebuilt
 * mid-stream -- keeps a live ticker registration for the remainder of the
 * turn. Re-registering on every call is cheap: {@link sharedSecondTicker}
 * simply replaces the target for that element.
 *
 * Tears down (unregisters + removes) any existing hint once the turn stops
 * working or its start time is unknown, and permanently suppresses the hint
 * once it has been dismissed for that turn. If the turn already showed the
 * hint (but was not dismissed) and `accordion` has no hint sibling -- e.g.
 * because a timeline rebuild replaced the element mid-turn -- the hint is
 * re-inserted immediately, without waiting through the threshold again.
 */
export function ensureSlowTurnHint(accordion: HTMLElement, options: SlowTurnHintOptions): void {
    const { isWorking, turnStartMs, onStopTurn } = options;
    if (!isWorking || turnStartMs === undefined) {
        sharedSecondTicker.unregister(accordion);
        removeSlowTurnHint(accordion);
        return;
    }
    const state = slowTurnHintState.get(turnStartMs);
    if (state === 'dismissed') {
        sharedSecondTicker.unregister(accordion);
        removeSlowTurnHint(accordion);
        return;
    }
    if (state === 'shown') {
        // Nothing left for the ticker to drive -- the hint either already
        // exists next to `accordion`, or needs to be re-inserted right away
        // because a rebuild replaced the element since it was last shown.
        sharedSecondTicker.unregister(accordion);
        reinsertSlowTurnHintIfMissing(accordion, turnStartMs, onStopTurn);
        return;
    }
    sharedSecondTicker.register({
        element: accordion,
        render: now => {
            if (slowTurnHintState.get(turnStartMs) === 'dismissed') {
                sharedSecondTicker.unregister(accordion);
                return;
            }
            if (now - turnStartMs < SLOW_TURN_HINT_THRESHOLD_MS) {
                return;
            }
            showSlowTurnHint(accordion, turnStartMs, onStopTurn);
            sharedSecondTicker.unregister(accordion);
        },
    });
}

/** Builds and inserts the hint element right after `accordion` (if not
 *  already present), then marks the turn as "shown" -- only once insertion
 *  actually succeeds, so a no-op call (no parent, e.g. a detached element)
 *  never falsely records the turn as shown. */
function showSlowTurnHint(accordion: HTMLElement, turnStartMs: number, onStopTurn: (() => void) | undefined): void {
    const existing = accordion.nextElementSibling;
    if (existing?.hasAttribute(MOBILE_SLOW_TURN_HINT_ATTR)) {
        setSlowTurnHintState(turnStartMs, 'shown');
        return;
    }
    if (!accordion.parentElement) {
        return;
    }
    insertSlowTurnHintElement(accordion, turnStartMs, onStopTurn);
    setSlowTurnHintState(turnStartMs, 'shown');
}

/** Re-inserts the hint next to `accordion` if it isn't already there --
 *  without touching the turn's recorded state (it is already "shown"). Used
 *  when a timeline rebuild replaced the accordion element mid-turn. */
function reinsertSlowTurnHintIfMissing(accordion: HTMLElement, turnStartMs: number, onStopTurn: (() => void) | undefined): void {
    const existing = accordion.nextElementSibling;
    if (existing?.hasAttribute(MOBILE_SLOW_TURN_HINT_ATTR)) {
        return;
    }
    if (!accordion.parentElement) {
        return;
    }
    insertSlowTurnHintElement(accordion, turnStartMs, onStopTurn);
}

/** Marks `turnStartMs` as permanently dismissed, removes `hint`, and stops
 *  the shared ticker for `accordion` immediately rather than waiting for its
 *  next tick to notice the turn is now dismissed -- there is nothing left
 *  for it to drive once the hint has been dismissed. Shared by both the
 *  dismiss (✕) and "Stop turn" click handlers. */
function dismissSlowTurnHint(accordion: HTMLElement, hint: HTMLElement, turnStartMs: number): void {
    setSlowTurnHintState(turnStartMs, 'dismissed');
    hint.remove();
    sharedSecondTicker.unregister(accordion);
}

/** Builds the hint element and inserts it right after `accordion`. Does not
 *  check for an existing sibling or update any recorded state -- callers are
 *  responsible for both. */
function insertSlowTurnHintElement(accordion: HTMLElement, turnStartMs: number, onStopTurn: (() => void) | undefined): void {
    const hint = document.createElement('div');
    hint.className = MOBILE_SLOW_TURN_HINT_CLASS;
    hint.setAttribute(MOBILE_SLOW_TURN_HINT_ATTR, '1');

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-clock theia-mobile-slow-turn-hint-icon';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'theia-mobile-slow-turn-hint-text';
    text.textContent = nls.localize(
        'theia/qaap-mobile-shell/processTimeline/slowTurnHint',
        'This model is taking a while.',
    );

    hint.append(icon, text);

    if (onStopTurn) {
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'theia-mobile-slow-turn-hint-stop';
        stop.textContent = nls.localize('theia/qaap-mobile-shell/processTimeline/slowTurnHintStop', 'Stop turn');
        stop.addEventListener('click', () => {
            onStopTurn();
            dismissSlowTurnHint(accordion, hint, turnStartMs);
        });
        hint.append(stop);
    }

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'theia-mobile-slow-turn-hint-dismiss codicon codicon-close';
    dismiss.title = nls.localizeByDefault('Dismiss');
    dismiss.setAttribute('aria-label', dismiss.title);
    dismiss.addEventListener('click', () => {
        dismissSlowTurnHint(accordion, hint, turnStartMs);
    });
    hint.append(dismiss);

    accordion.insertAdjacentElement('afterend', hint);
}

/** Removes the hint sibling of `accordion`, if present. Does NOT mark the
 *  turn as seen -- a turn that stops working before the threshold is simply
 *  no longer eligible (`isWorking` gates that in {@link ensureSlowTurnHint}),
 *  it does not need to be remembered forever. */
function removeSlowTurnHint(accordion: HTMLElement): void {
    const sibling = accordion.nextElementSibling;
    if (sibling?.hasAttribute(MOBILE_SLOW_TURN_HINT_ATTR)) {
        sibling.remove();
    }
}

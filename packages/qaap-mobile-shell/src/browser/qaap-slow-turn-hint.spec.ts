// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    ensureSlowTurnHint,
    MOBILE_SLOW_TURN_HINT_ATTR,
    MOBILE_SLOW_TURN_HINT_CLASS,
    SLOW_TURN_HINT_THRESHOLD_MS,
} from './qaap-slow-turn-hint';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';

describe('qaap-slow-turn-hint', () => {

    let disableJSDOM: (() => void) | undefined;
    // Distinct per test so the module-level "seen" LRU set from one test can
    // never leak into another (each test uses its own synthetic turn).
    let turnCounter = 0;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    afterEach(() => {
        // Avoid leaking ticker registrations (and their shared interval)
        // across tests/files.
        document.querySelectorAll('details').forEach(el => sharedSecondTicker.unregister(el as HTMLElement));
        document.body.innerHTML = '';
    });

    function freshTurnStartMs(elapsedMs: number): number {
        turnCounter += 1;
        // The per-test offset must be larger than any plausible `Date.now()`
        // drift between calls within a fast synchronous test run (a few ms at
        // most), or two tests could compute the exact same `turnStartMs` and
        // spuriously share "seen" state via the module-level LRU set. It must
        // also stay much smaller than the 1000ms margin every test below
        // uses around the threshold, so it never flips a test from "under"
        // to "over" (or vice versa).
        return Date.now() - elapsedMs - turnCounter * 100;
    }

    function createAccordion(): HTMLElement {
        const parent = document.createElement('div');
        document.body.append(parent);
        const accordion = document.createElement('details');
        accordion.className = 'theia-mobile-process-accordion';
        parent.append(accordion);
        return accordion;
    }

    it('does nothing while the turn is under the threshold', () => {
        const accordion = createAccordion();
        const turnStartMs = freshTurnStartMs(1000);
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        expect(accordion.nextElementSibling).to.be.null;
    });

    it('shows the hint once the turn has been working past the threshold', () => {
        const accordion = createAccordion();
        const turnStartMs = freshTurnStartMs(SLOW_TURN_HINT_THRESHOLD_MS + 1000);
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        const hint = accordion.nextElementSibling;
        expect(hint).to.not.be.null;
        expect(hint!.classList.contains(MOBILE_SLOW_TURN_HINT_CLASS)).to.be.true;
        expect(hint!.hasAttribute(MOBILE_SLOW_TURN_HINT_ATTR)).to.be.true;
        expect(hint!.textContent).to.contain('This model is taking a while');
        expect(hint!.querySelector('.codicon-clock')).to.not.be.null;
        expect(hint!.querySelector('.theia-mobile-slow-turn-hint-dismiss')).to.not.be.null;
    });

    it('keeps the hint in place on a later sync of the same accordion', () => {
        const accordion = createAccordion();
        const turnStartMs = freshTurnStartMs(SLOW_TURN_HINT_THRESHOLD_MS + 1000);
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        const hint = accordion.nextElementSibling;
        expect(hint).to.not.be.null;

        // A later sync of the same (still working, not dismissed) turn must
        // not destroy the hint that is already showing.
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        expect(accordion.nextElementSibling).to.equal(hint);
    });

    it('re-inserts the hint next to a rebuilt accordion mid-turn', () => {
        const turnStartMs = freshTurnStartMs(SLOW_TURN_HINT_THRESHOLD_MS + 1000);
        const accordion = createAccordion();
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        expect(accordion.nextElementSibling).to.not.be.null;

        // A rebuild replaces the accordion element entirely (mirrors a full
        // timeline/row rebuild mid-stream) -- the hint element (a sibling of
        // the old accordion) is gone along with it, but the turn is still
        // working and was never dismissed, so the hint must re-appear next
        // to the fresh element rather than staying suppressed.
        const rebuiltAccordion = createAccordion();
        ensureSlowTurnHint(rebuiltAccordion, { isWorking: true, turnStartMs });
        const hint = rebuiltAccordion.nextElementSibling;
        expect(hint).to.not.be.null;
        expect(hint!.hasAttribute(MOBILE_SLOW_TURN_HINT_ATTR)).to.be.true;
    });

    it('removes the hint and never re-shows it once dismissed', () => {
        const accordion = createAccordion();
        const turnStartMs = freshTurnStartMs(SLOW_TURN_HINT_THRESHOLD_MS + 1000);
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        const hint = accordion.nextElementSibling as HTMLElement;
        const dismissBtn = hint.querySelector<HTMLButtonElement>('.theia-mobile-slow-turn-hint-dismiss');
        expect(dismissBtn).to.not.be.null;
        dismissBtn!.click();
        expect(accordion.nextElementSibling).to.be.null;

        // A later sync call for the same (still working) turn must not bring
        // it back.
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        expect(accordion.nextElementSibling).to.be.null;

        // Nor must it come back next to a rebuilt accordion for that turn --
        // dismissal is permanent, unlike the ordinary "shown" state.
        const rebuiltAccordion = createAccordion();
        ensureSlowTurnHint(rebuiltAccordion, { isWorking: true, turnStartMs });
        expect(rebuiltAccordion.nextElementSibling).to.be.null;
    });

    it('removes the hint once the turn stops working, and does not re-show it later', () => {
        const accordion = createAccordion();
        const turnStartMs = freshTurnStartMs(SLOW_TURN_HINT_THRESHOLD_MS + 1000);
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs });
        expect(accordion.nextElementSibling).to.not.be.null;

        ensureSlowTurnHint(accordion, { isWorking: false, turnStartMs });
        expect(accordion.nextElementSibling).to.be.null;
    });

    it('does nothing for a settled/historical turn even past the threshold', () => {
        const accordion = createAccordion();
        const turnStartMs = freshTurnStartMs(SLOW_TURN_HINT_THRESHOLD_MS + 1000);
        ensureSlowTurnHint(accordion, { isWorking: false, turnStartMs });
        expect(accordion.nextElementSibling).to.be.null;
    });

    it('does nothing when the turn start time is unknown', () => {
        const accordion = createAccordion();
        ensureSlowTurnHint(accordion, { isWorking: true, turnStartMs: undefined });
        expect(accordion.nextElementSibling).to.be.null;
    });
});

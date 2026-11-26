// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createMobileTurnResultFooterElement, MOBILE_TURN_RESULT_CLASS } from './mobile-turn-result-footer';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

describe('mobile-turn-result-footer', () => {

    useSuiteJSDOM();

    it('shows only the verdict: no per-turn buttons (the composer pills own preview, commit and Create PR)', () => {
        const footer = createMobileTurnResultFooterElement({
            tone: 'warning',
            title: 'Completed with warnings — the independent review rejected the change',
            details: ['Independent review: rejected by claude — package.json:6'],
            reviewRejected: true,
        })!;
        expect(footer.classList.contains(MOBILE_TURN_RESULT_CLASS)).to.equal(true);
        expect(footer.querySelectorAll('button')).to.have.length(0);
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict`)?.classList.contains('theia-mod-warning')).to.equal(true);
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-title`)?.textContent)
            .to.equal('Completed with warnings — the independent review rejected the change');
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-details`)?.textContent)
            .to.equal('Independent review: rejected by claude — package.json:6');
    });

    it('renders a passed verdict without details', () => {
        const footer = createMobileTurnResultFooterElement({ tone: 'done', title: 'Completed', details: [] })!;
        expect(footer.querySelector('.codicon-pass')).to.not.equal(null);
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-details`)).to.equal(null);
    });

    it('renders nothing when the turn has no verdict', () => {
        expect(createMobileTurnResultFooterElement(undefined)).to.equal(undefined);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createMobileTurnResultFooterElement, MOBILE_TURN_RESULT_CLASS } from './mobile-turn-result-footer';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

describe('mobile-turn-result-footer', () => {

    useSuiteJSDOM();

    it('renders a warning verdict with details as a collapsed disclosure and no action buttons', () => {
        const footer = createMobileTurnResultFooterElement({
            tone: 'warning',
            title: 'Completed with warnings — the independent review rejected the change',
            details: ['Independent review: rejected by claude — package.json:6'],
            reviewRejected: true,
        })!;
        expect(footer.classList.contains(MOBILE_TURN_RESULT_CLASS)).to.equal(true);
        expect(footer.querySelectorAll('button')).to.have.length(0);
        const disclosure = footer.querySelector(`details.${MOBILE_TURN_RESULT_CLASS}-verdict`) as HTMLDetailsElement | null;
        expect(disclosure).to.not.equal(null);
        expect(disclosure?.classList.contains('theia-mod-warning')).to.equal(true);
        expect(disclosure?.open).to.equal(false);
        expect(disclosure?.querySelector(`summary.${MOBILE_TURN_RESULT_CLASS}-verdict-summary`)).to.not.equal(null);
        expect(disclosure?.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-chevron`)).to.not.equal(null);
        expect(disclosure?.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-title`)?.textContent)
            .to.equal('Completed with warnings — the independent review rejected the change');
        expect(disclosure?.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-details`)?.textContent)
            .to.equal('Independent review: rejected by claude — package.json:6');
    });

    it('renders a warning verdict without details as a compact non-collapsible row', () => {
        const footer = createMobileTurnResultFooterElement({
            tone: 'warning',
            title: 'Completed with warnings',
            details: [],
        })!;
        expect(footer.querySelector('details')).to.equal(null);
        expect(footer.querySelector('.codicon-warning')).to.not.equal(null);
        expect(footer.querySelector(`.${MOBILE_TURN_RESULT_CLASS}-verdict-details`)).to.equal(null);
    });

    it('hides the verdict footer on clean done turns', () => {
        expect(createMobileTurnResultFooterElement({ tone: 'done', title: 'Completed', details: [] })).to.equal(undefined);
    });

    it('renders nothing when the turn has no verdict', () => {
        expect(createMobileTurnResultFooterElement(undefined)).to.equal(undefined);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { mountQaapCounterPush } from '../browser/qaap-counter-push-dom';

describe('qaap-counter-push-dom', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('renders the formatted value inside the push viewport', () => {
        const counter = mountQaapCounterPush({
            value: 42,
            format: value => `+${value}`,
            className: 'theia-mod-added',
        });
        document.body.append(counter.element);
        expect(counter.getValue()).to.equal(42);
        expect(counter.element.querySelector('.qaap-counter-push-number')?.textContent).to.equal('+42');
        counter.dispose();
    });

    it('updates instantly when animation is disabled', () => {
        const counter = mountQaapCounterPush({
            value: 1,
            format: value => `-${value}`,
        });
        counter.setValue(3, { animate: false });
        expect(counter.getValue()).to.equal(3);
        expect(counter.element.querySelector('.qaap-counter-push-number')?.textContent).to.equal('-3');
        counter.dispose();
    });

    it('ignores duplicate values', () => {
        const counter = mountQaapCounterPush({
            value: 5,
            format: value => `+${value}`,
        });
        counter.setValue(5, { animate: false });
        expect(counter.getValue()).to.equal(5);
        counter.dispose();
    });
});

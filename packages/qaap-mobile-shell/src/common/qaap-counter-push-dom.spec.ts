// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { mountQaapCounterPush, readQaapCounterPushDisplayText } from '../browser/qaap-counter-push-dom';

describe('qaap-counter-push-dom', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('renders the formatted value inside per-digit columns', () => {
        const counter = mountQaapCounterPush({
            value: 42,
            format: value => `+${value}`,
            className: 'theia-mod-added',
        });
        document.body.append(counter.element);
        expect(counter.getValue()).to.equal(42);
        expect(readQaapCounterPushDisplayText(counter.element)).to.equal('+42');
        expect(counter.element.querySelectorAll('.qaap-counter-push-digit-col').length).to.equal(2);
        counter.dispose();
    });

    it('updates instantly when animation is disabled', () => {
        const counter = mountQaapCounterPush({
            value: 1,
            format: value => `-${value}`,
        });
        counter.setValue(3, { animate: false });
        expect(counter.getValue()).to.equal(3);
        expect(readQaapCounterPushDisplayText(counter.element)).to.equal('-3');
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

    it('animates increment upward', () => {
        const counter = mountQaapCounterPush({
            value: 2,
            format: value => `+${value}`,
        });
        document.body.append(counter.element);
        counter.setValue(5, { animate: true });
        const entering = counter.element.querySelector<HTMLElement>('.qaap-mod-entering');
        const exiting = counter.element.querySelector<HTMLElement>('.qaap-mod-exiting');
        expect(entering?.style.transform).to.include('100%');
        expect(exiting?.style.transform).to.equal('translateY(0)');
        counter.dispose();
    });

    it('animates decrement downward', () => {
        const counter = mountQaapCounterPush({
            value: 8,
            format: value => `-${value}`,
        });
        document.body.append(counter.element);
        counter.setValue(3, { animate: true });
        const entering = counter.element.querySelector<HTMLElement>('.qaap-mod-entering');
        const exiting = counter.element.querySelector<HTMLElement>('.qaap-mod-exiting');
        expect(entering?.style.transform).to.include('-100%');
        expect(exiting?.style.transform).to.equal('translateY(0)');
        counter.dispose();
    });

    it('animates each digit column independently for multi-digit values', async () => {
        const counter = mountQaapCounterPush({
            value: 1299,
            format: value => `+${value}`,
        });
        document.body.append(counter.element);
        counter.setValue(1300, { animate: true });
        expect(counter.element.querySelectorAll('.qaap-counter-push-digit-col').length).to.equal(4);
        await new Promise(resolve => window.setTimeout(resolve, 400));
        expect(readQaapCounterPushDisplayText(counter.element)).to.equal('+1300');
        counter.dispose();
    });
});

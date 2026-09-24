// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { createModelCapabilitySlider } from './model-capability-slider';

describe('model-capability-slider', () => {
    it('renders a discrete slider with four marks and localized aria metadata', () => {
        const slider = createModelCapabilitySlider({
            level: 1,
            onCommit: () => undefined,
        });
        document.body.append(slider.root);
        expect(slider.root.getAttribute('role')).to.equal('slider');
        expect(slider.root.getAttribute('aria-valuenow')).to.equal('1');
        expect(slider.root.querySelectorAll('.qaap-model-capability-slider-mark')).to.have.length(4);
        slider.dispose();
    });

    it('commits only when the level changes', () => {
        let commits = 0;
        let last = 1;
        const slider = createModelCapabilitySlider({
            level: 1,
            onCommit: level => {
                commits += 1;
                last = level;
            },
        });
        slider.setLevel(2, { commit: true });
        slider.setLevel(2, { commit: true });
        expect(commits).to.equal(1);
        expect(last).to.equal(2);
        slider.dispose();
    });

    it('moves with keyboard arrows and snaps to endpoints', () => {
        const slider = createModelCapabilitySlider({
            level: 1,
            onCommit: () => undefined,
        });
        document.body.append(slider.root);
        slider.root.focus();
        slider.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(slider.getLevel()).to.equal(0);
        slider.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(slider.getLevel()).to.equal(3);
        slider.dispose();
    });
});

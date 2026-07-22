// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import {
    MODEL_CAPABILITY_ZAP_STRIKE_CLASS,
    playModelCapabilityZapStrike,
    renderModelCapabilityPopoverPanel,
} from './model-capability-popover';

describe('model-capability-popover', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('shows Effort with the current slider level and updates while previewing', () => {
        const panel = renderModelCapabilityPopoverPanel({
            level: 1,
            onCommit: () => undefined,
        });
        document.body.append(panel);
        const label = panel.querySelector('.qaap-model-capability-popover-advanced-label');
        expect(label?.textContent).to.equal('Effort: Standard');

        const slider = panel.querySelector('.qaap-model-capability-slider') as HTMLElement;
        slider.focus();
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(label?.textContent).to.equal('Effort: Max');
        panel.remove();
    });

    it('renders an SVG zap icon in the effort header', () => {
        const panel = renderModelCapabilityPopoverPanel({
            level: 1,
            onCommit: () => undefined,
        });
        document.body.append(panel);
        const bolt = panel.querySelector('svg.qaap-model-capability-popover-bolt');
        const path = bolt?.querySelector('.qaap-model-capability-popover-bolt-path');
        expect(bolt).to.not.equal(null);
        expect(path?.getAttribute('pathLength')).to.equal('1');
        panel.remove();
    });

    it('strikes the zap icon when effort level changes via the slider', () => {
        const panel = renderModelCapabilityPopoverPanel({
            level: 1,
            onCommit: () => undefined,
        });
        document.body.append(panel);
        const bolt = panel.querySelector('.qaap-model-capability-popover-bolt') as SVGSVGElement;
        expect(bolt.classList.contains(MODEL_CAPABILITY_ZAP_STRIKE_CLASS)).to.equal(false);

        const slider = panel.querySelector('.qaap-model-capability-slider') as HTMLElement;
        slider.focus();
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(bolt.classList.contains(MODEL_CAPABILITY_ZAP_STRIKE_CLASS)).to.equal(true);

        bolt.classList.remove(MODEL_CAPABILITY_ZAP_STRIKE_CLASS);
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(bolt.classList.contains(MODEL_CAPABILITY_ZAP_STRIKE_CLASS)).to.equal(true);
        panel.remove();
    });

    it('does not strike the zap icon when prefers-reduced-motion is enabled', () => {
        const matchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
        try {
            const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            playModelCapabilityZapStrike(bolt);
            expect(bolt.classList.contains(MODEL_CAPABILITY_ZAP_STRIKE_CLASS)).to.equal(false);
        } finally {
            window.matchMedia = matchMedia;
        }
    });
});

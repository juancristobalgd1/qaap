// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { renderModelCapabilityPopoverPanel } from './model-capability-popover';

describe('model-capability-popover', () => {
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
});

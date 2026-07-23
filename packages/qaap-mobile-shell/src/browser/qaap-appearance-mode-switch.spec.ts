// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createQaapAppearanceModeSwitch } from './qaap-appearance-mode-switch';

describe('qaap-appearance-mode-switch', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('renders three options and reports selection changes', () => {
        const selected: string[] = [];
        const control = createQaapAppearanceModeSwitch({
            value: 'system',
            onChange: mode => selected.push(mode),
        });
        document.body.append(control.root);

        const options = control.root.querySelectorAll<HTMLButtonElement>('.theia-qaap-appearance-mode-switch-option');
        expect(options).to.have.length(3);
        expect(control.root.querySelector('.theia-mod-selected')?.getAttribute('data-mode')).to.equal('system');

        options[0].click();
        expect(selected).to.deep.equal(['light']);
        expect(control.getValue()).to.equal('light');

        control.setValue('dark');
        expect(control.root.querySelector('.theia-mod-selected')?.getAttribute('data-mode')).to.equal('dark');
    });
});

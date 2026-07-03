// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

import { expect } from 'chai';
import { attachTranscriptDensityToggle } from './qaap-transcript-density';

describe('qaap-transcript-density', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        window.localStorage.clear();
    });

    it('toggles compact density without changing scrollTop', () => {
        const mount = document.createElement('div');
        const scroller = document.createElement('div');
        scroller.scrollTop = 120;
        mount.append(scroller);
        document.body.append(mount);

        const disposable = attachTranscriptDensityToggle(mount, scroller);
        const button = mount.querySelector<HTMLButtonElement>('.theia-mobile-agent-transcript-density-toggle')!;
        expect(scroller.classList.contains('theia-mod-density-comfortable')).to.equal(true);

        button.click();

        expect(scroller.classList.contains('theia-mod-density-compact')).to.equal(true);
        expect(scroller.scrollTop).to.equal(120);
        expect(window.localStorage.getItem('qaap.transcript.density')).to.equal('compact');
        disposable.dispose();
    });
});

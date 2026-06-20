// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { attachTranscriptUserScrollPin } from './qaap-transcript-user-scroll-pin';

describe('attachTranscriptUserScrollPin', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    function createUserWrap(label: string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-agent-transcript-user-wrap theia-mod-sticky-stuck theia-mod-sticky-suppressed';
        const bubble = document.createElement('button');
        bubble.className = 'theia-mobile-agent-transcript-msg theia-mod-user theia-mod-scroll-pinned-jump';
        bubble.setAttribute('tabindex', '0');
        bubble.setAttribute('title', 'Jump to message');
        const content = document.createElement('span');
        content.className = 'theia-mobile-agent-transcript-content theia-mod-sticky-compact';
        content.textContent = label;
        bubble.append(content);
        wrap.append(bubble);
        return wrap;
    }

    it('strips legacy sticky classes when attached', () => {
        const scroller = document.createElement('div');
        const wrap = createUserWrap('Pinned prompt');
        scroller.append(wrap);
        document.body.append(scroller);

        const disposable = attachTranscriptUserScrollPin(scroller);

        expect(wrap.classList.contains('theia-mod-sticky-stuck')).to.equal(false);
        expect(wrap.classList.contains('theia-mod-sticky-suppressed')).to.equal(false);
        expect(wrap.querySelector('.theia-mobile-agent-transcript-msg')?.classList.contains('theia-mod-scroll-pinned-jump')).to.equal(false);
        expect(wrap.querySelector('.theia-mobile-agent-transcript-content')?.classList.contains('theia-mod-sticky-compact')).to.equal(false);
        disposable.dispose();
    });

    it('strips sticky classes added after mount', async () => {
        const scroller = document.createElement('div');
        scroller.append(createUserWrap('First prompt'));
        document.body.append(scroller);

        const disposable = attachTranscriptUserScrollPin(scroller);
        const wrap = scroller.querySelector<HTMLElement>('.theia-mobile-agent-transcript-user-wrap')!;
        wrap.classList.add('theia-mod-sticky-stuck');
        await new Promise(resolve => window.setTimeout(resolve, 0));

        expect(wrap.classList.contains('theia-mod-sticky-stuck')).to.equal(false);
        disposable.dispose();
    });

});

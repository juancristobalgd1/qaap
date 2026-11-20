// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    QAAP_SCROLL_FADE_BOTTOM_CLASS,
    QAAP_SCROLL_FADE_TOP_CLASS,
    QAAP_SCROLL_FADES_CLASS,
} from '@theia/qaap-mobile-shell/lib/browser/qaap-scroll-edge-fades';
import {
    attachStickyComposerInputEdgeFades,
    pruneDetachedStickyComposerInputEdgeFades,
} from './mobile-projects-sticky-composer-input-edge-fades';

describe('mobile-projects-sticky-composer-input-edge-fades', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        pruneDetachedStickyComposerInputEdgeFades();
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    /** Editor wrapper with the highlight mirror and a textarea, as the composer builds them. */
    function createComposerEditor(scrollTop: number, scrollHeight: number, clientHeight: number): {
        editor: HTMLElement;
        input: HTMLTextAreaElement;
    } {
        const editor = document.createElement('div');
        editor.className = 'theia-mobile-projects-sticky-composer-input-editor';
        const highlight = document.createElement('div');
        highlight.className = 'theia-mobile-projects-sticky-composer-input-highlight';
        const input = document.createElement('textarea');
        input.className = 'theia-mobile-projects-sticky-composer-input';
        editor.append(highlight, input);
        document.body.appendChild(editor);
        Object.defineProperty(input, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
        Object.defineProperty(input, 'scrollHeight', { value: scrollHeight, writable: true, configurable: true });
        Object.defineProperty(input, 'clientHeight', { value: clientHeight, writable: true, configurable: true });
        return { editor, input };
    }

    it('puts the fade classes on the editor wrapper, not on the textarea', () => {
        const { editor, input } = createComposerEditor(0, 300, 100);
        const fades = attachStickyComposerInputEdgeFades(input);
        expect(editor.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.true;
        expect(editor.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;
        expect(editor.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.false;
        expect(input.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.false;
        fades.dispose();
    });

    it('toggles the top fade on the wrapper when the textarea scrolls', () => {
        const { editor, input } = createComposerEditor(0, 300, 100);
        const fades = attachStickyComposerInputEdgeFades(input);
        Object.defineProperty(input, 'scrollTop', { value: 200, writable: true, configurable: true });
        input.dispatchEvent(new window.Event('scroll'));
        expect(editor.classList.contains(QAAP_SCROLL_FADE_TOP_CLASS)).to.be.true;
        expect(editor.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
        fades.dispose();
    });

    it('re-syncs on input and on update() after programmatic value changes', () => {
        const { editor, input } = createComposerEditor(0, 100, 100);
        const fades = attachStickyComposerInputEdgeFades(input);
        expect(editor.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
        Object.defineProperty(input, 'scrollHeight', { value: 400, configurable: true });
        input.dispatchEvent(new window.Event('input'));
        expect(editor.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.true;
        Object.defineProperty(input, 'scrollHeight', { value: 100, configurable: true });
        fades.update();
        expect(editor.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
        fades.dispose();
    });

    it('removes the wrapper classes on dispose', () => {
        const { editor, input } = createComposerEditor(0, 300, 100);
        const fades = attachStickyComposerInputEdgeFades(input);
        fades.dispose();
        expect(editor.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.false;
        expect(editor.classList.contains(QAAP_SCROLL_FADE_BOTTOM_CLASS)).to.be.false;
    });

    it('disposes trackers of textareas that left the document on the next attach', () => {
        const stale = createComposerEditor(0, 300, 100);
        attachStickyComposerInputEdgeFades(stale.input);
        expect(stale.editor.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.true;
        stale.editor.remove();
        const fresh = createComposerEditor(0, 300, 100);
        const fades = attachStickyComposerInputEdgeFades(fresh.input);
        expect(stale.editor.classList.contains(QAAP_SCROLL_FADES_CLASS)).to.be.false;
        fades.dispose();
    });
});

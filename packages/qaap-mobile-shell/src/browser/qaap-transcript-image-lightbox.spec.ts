// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { handleTranscriptImageClick, openQaapImageLightbox } from './qaap-transcript-image-lightbox';

describe('qaap-transcript-image-lightbox', () => {
    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    it('opens a full-page dialog with the image and closes via the close button', () => {
        const overlay = openQaapImageLightbox(document, 'https://example.test/evidence.png', 'QAAP preview evidence /');
        expect(document.querySelector('.qaap-transcript-image-lightbox')).to.equal(overlay);
        expect(overlay.getAttribute('role')).to.equal('dialog');
        expect(overlay.querySelector('img')?.src).to.equal('https://example.test/evidence.png');

        overlay.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.qaap-transcript-image-lightbox')).to.equal(null);
    });

    it('closes on Escape and on backdrop click, and replaces a previous lightbox', () => {
        openQaapImageLightbox(document, 'https://example.test/a.png', 'a');
        const second = openQaapImageLightbox(document, 'https://example.test/b.png', 'b');
        expect(document.querySelectorAll('.qaap-transcript-image-lightbox')).to.have.length(1);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('.qaap-transcript-image-lightbox')).to.equal(null);

        const third = openQaapImageLightbox(document, 'https://example.test/c.png', 'c');
        third.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.qaap-transcript-image-lightbox')).to.equal(null);
        expect(second.isConnected).to.equal(false);
    });

    it('delegates only clicks on images inside transcript content', () => {
        document.body.innerHTML = `
            <div class="theia-mobile-agent-transcript-content"><p><img src="https://example.test/x.png" alt="evidence"></p></div>
            <img id="outside" src="https://example.test/outside.png">`;
        const inside = document.querySelector<HTMLImageElement>('.theia-mobile-agent-transcript-content img')!;
        const outside = document.querySelector<HTMLImageElement>('#outside')!;

        const insideEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(insideEvent, 'target', { value: inside });
        expect(handleTranscriptImageClick(document, insideEvent)).to.equal(true);
        expect(document.querySelector('.qaap-transcript-image-lightbox')).to.not.equal(null);
        document.querySelector('.qaap-transcript-image-lightbox')!.remove();

        const outsideEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        Object.defineProperty(outsideEvent, 'target', { value: outside });
        expect(handleTranscriptImageClick(document, outsideEvent)).to.equal(false);
        expect(document.querySelector('.qaap-transcript-image-lightbox')).to.equal(null);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { createTranscriptReviewChrome } from './qaap-transcript-review-chrome';

describe('qaap-transcript-review-chrome', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    it('mounts the diff, checks, and history controls expected by external chrome mode', () => {
        const host = document.createElement('div');
        const chrome = createTranscriptReviewChrome(host, false);

        expect(host.children).to.have.lengthOf(4);
        expect(chrome.diffHost.parentElement).to.equal(host);
        expect(chrome.checksHost.closest('.theia-mobile-transcript-changes-dock')).not.to.be.null;
        expect(chrome.historyToggleHost.closest('.theia-mobile-transcript-changes-dock')).not.to.be.null;
        expect(chrome.historyPanel.hidden).to.be.true;
        expect(chrome.historyResizeHandle.hidden).to.be.true;
        expect(chrome.historyResizeHandle.getAttribute('role')).to.equal('separator');
        expect(chrome.historyResizeHandle.tabIndex).to.equal(0);
    });

    it('restores the open history height and accessible state', () => {
        const host = document.createElement('div');
        const chrome = createTranscriptReviewChrome(host, true, 260);

        expect(chrome.historyPanel.hidden).to.be.false;
        expect(chrome.historyPanel.style.getPropertyValue('--qaap-transcript-history-height')).to.equal('260px');
        expect(chrome.historyPanel.getAttribute('role')).to.equal('region');
        expect(chrome.historyResizeHandle.getAttribute('aria-valuenow')).to.equal('260');
    });
});

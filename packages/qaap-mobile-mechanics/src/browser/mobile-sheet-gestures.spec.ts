// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { resolvePullRefreshScroller } from './mobile-sheet-gestures';

describe('mobile-sheet-gestures', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        disableJSDOM?.();
        disableJSDOM = enableJSDOM();
        document.body.innerHTML = '';
    });

    it('resolvePullRefreshScroller returns the outer scroller for direct touches', () => {
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', { value: 400, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
        const row = document.createElement('div');
        scroller.append(row);
        document.body.append(scroller);

        expect(resolvePullRefreshScroller(row, scroller)).to.equal(scroller);
    });

    it('resolvePullRefreshScroller prefers a nested scrollable transcript list', () => {
        const scroller = document.createElement('div');
        scroller.className = 'theia-mobile-projects-scroll';
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', { value: 400, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });

        const transcript = document.createElement('div');
        transcript.className = 'theia-mobile-agent-transcript';
        transcript.style.overflowY = 'auto';
        Object.defineProperty(transcript, 'scrollHeight', { value: 1200, configurable: true });
        Object.defineProperty(transcript, 'clientHeight', { value: 300, configurable: true });

        const message = document.createElement('div');
        message.className = 'theia-mobile-agent-transcript-msg';
        transcript.append(message);
        scroller.append(transcript);
        document.body.append(scroller);

        expect(resolvePullRefreshScroller(message, scroller)).to.equal(transcript);
        expect(resolvePullRefreshScroller(message, scroller)).to.not.equal(scroller);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    resolveStoredTranscriptReadMessageIndex,
    restoreTranscriptReadPosition,
} from './qaap-transcript-read-position';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('qaap-transcript-read-position', () => {

    useSuiteJSDOM();

    beforeEach(() => {
        window.localStorage.clear();
    });

    it('restores scroll position from a stored message anchor', () => {
        const scroller = document.createElement('div');
        const row = document.createElement('div');
        row.setAttribute('data-transcript-message-id', 'm2');
        scroller.append(row);
        document.body.append(scroller);
        scroller.scrollTop = 100;
        scroller.getBoundingClientRect = () => ({ top: 10, bottom: 310, left: 0, right: 300, width: 300, height: 300, x: 0, y: 10, toJSON: () => undefined });
        row.getBoundingClientRect = () => ({ top: 70, bottom: 120, left: 0, right: 300, width: 300, height: 50, x: 0, y: 70, toJSON: () => undefined });
        window.localStorage.setItem('qaap.transcript.readPosition.conv', JSON.stringify({
            messageId: 'm2',
            offsetTop: 24,
            at: 1,
        }));

        expect(restoreTranscriptReadPosition(scroller, 'conv')).to.equal(true);

        expect(scroller.scrollTop).to.equal(136);
    });

    it('resolves stored message index for virtualized transcripts', () => {
        window.localStorage.setItem('qaap.transcript.readPosition.conv', JSON.stringify({
            messageId: 'm2',
            offsetTop: 0,
            at: 1,
        }));

        expect(resolveStoredTranscriptReadMessageIndex('conv', [{ id: 'm1' }, { id: 'm2' }])).to.equal(1);
    });
});

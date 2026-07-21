// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    clearTranscriptUserScrollIntent,
    markTranscriptUserScrollIntent,
    transcriptHasRecentUserScrollIntent,
} from './qaap-transcript-scroll-intent';
import { ensureTranscriptScrollController } from './qaap-transcript-scroll-controller';

describe('qaap-transcript-scroll-intent', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    it('records recent explicit user intent and detaches the controller', () => {
        const scroller = document.createElement('div');
        const controller = ensureTranscriptScrollController(scroller);
        expect(controller.phase).to.equal('idle');

        markTranscriptUserScrollIntent(scroller, 'wheel', 1_000);

        expect(transcriptHasRecentUserScrollIntent(scroller, 1_500)).to.equal(true);
        expect(controller.phase).to.equal('detached');
    });

    it('does not pause auto-follow for stale intent', () => {
        const scroller = document.createElement('div');
        markTranscriptUserScrollIntent(scroller, 'wheel', 1_000);

        expect(transcriptHasRecentUserScrollIntent(scroller, 3_000)).to.equal(false);
    });

    it('clears intent when the user explicitly jumps to latest', () => {
        const scroller = document.createElement('div');
        markTranscriptUserScrollIntent(scroller, 'selection');

        clearTranscriptUserScrollIntent(scroller);

        expect(transcriptHasRecentUserScrollIntent(scroller)).to.equal(false);
    });
});

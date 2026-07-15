// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createTranscriptLiveStatusElement,
    formatTranscriptLiveStatusText,
    syncTranscriptLiveStatusElement,
    TRANSCRIPT_LIVE_STATUS_CLASS,
} from './qaap-transcript-live-status';

describe('qaap-transcript-live-status', () => {
    it('formats Claude-style live status text', () => {
        expect(formatTranscriptLiveStatusText({
            elapsedMs: 13_000,
            streamChars: 256,
            activityTitle: 'Planning next moves',
        })).to.equal('13s · ~64 tokens · Planning next moves…');
    });

    it('createTranscriptLiveStatusElement renders logo + text slots', () => {
        const el = createTranscriptLiveStatusElement();
        expect(el.classList.contains(TRANSCRIPT_LIVE_STATUS_CLASS)).to.equal(true);
        expect(el.querySelector('.qaap-transcript-live-status-logo')).to.not.equal(null);
        expect(el.querySelector('.qaap-transcript-live-status-text')).to.not.equal(null);
    });

    it('syncTranscriptLiveStatusElement updates text and stall class', () => {
        const el = createTranscriptLiveStatusElement();
        syncTranscriptLiveStatusElement(el, {
            elapsedMs: 83_000,
            streamChars: 16_800,
            activityTitle: 'Reading files',
            stalled: true,
        });
        expect(el.querySelector('.qaap-transcript-live-status-text')?.textContent)
            .to.equal('1m 23s · ~4.2k tokens · Reading files…');
        expect(el.classList.contains('theia-mod-stalled')).to.equal(true);
    });
});

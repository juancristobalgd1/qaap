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
import { QAAP_BRAND_LOGO_INDICATOR_CLASS } from './qaap-agent-setup-phrases';

describe('qaap-transcript-live-status', () => {
    it('formats Claude-style live status text', () => {
        expect(formatTranscriptLiveStatusText({
            elapsedMs: 13_000,
            streamChars: 256,
            activityTitle: 'Planning next moves',
        })).to.equal('Planning next moves… · 13s · ~64 tokens');
    });

    it('createTranscriptLiveStatusElement renders logo, activity, then meta', () => {
        const el = createTranscriptLiveStatusElement();
        expect(el.classList.contains(TRANSCRIPT_LIVE_STATUS_CLASS)).to.equal(true);
        expect(el.querySelector(`.${QAAP_BRAND_LOGO_INDICATOR_CLASS}.qaap-transcript-live-status-logo`)).to.not.equal(null);
        expect(el.querySelector('.qaap-transcript-live-status-activity')).to.not.equal(null);
        expect(el.querySelector('.qaap-transcript-live-status-meta')).to.not.equal(null);
        const children = [...el.children].map(child => child.className);
        expect(children[0]).to.contain('qaap-transcript-live-status-logo');
        expect(children[1]).to.contain('qaap-transcript-live-status-activity');
        expect(children[2]).to.equal('qaap-transcript-live-status-meta');
    });

    it('syncTranscriptLiveStatusElement updates text and stall class', () => {
        const el = createTranscriptLiveStatusElement();
        syncTranscriptLiveStatusElement(el, {
            elapsedMs: 83_000,
            streamChars: 16_800,
            activityTitle: 'Reading files',
            stalled: true,
        });
        expect(el.querySelector('.qaap-transcript-live-status-meta')?.textContent)
            .to.equal('1m 23s · ~4.2k tokens');
        const activity = el.querySelector<HTMLElement>('.qaap-transcript-live-status-activity');
        expect(activity?.getAttribute('aria-label')).to.equal('Reading files…');
        expect(activity?.querySelectorAll('.qaap-agent-setup-letter').length).to.be.greaterThan(0);
        expect(el.classList.contains('theia-mod-stalled')).to.equal(true);
    });
});

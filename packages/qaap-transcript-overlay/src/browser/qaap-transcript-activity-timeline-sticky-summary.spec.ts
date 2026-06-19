// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS } from '../common/qaap-transcript-activity-timeline-sticky-summary';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR } from '../common/qaap-transcript-incremental-update';
import { attachTranscriptActivityTimelineStickySummary } from './qaap-transcript-activity-timeline-sticky-summary';

describe('attachTranscriptActivityTimelineStickySummary', () => {

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

    it('keeps timeline summaries non-sticky and removes stale stuck classes', () => {
        const scroller = document.createElement('div');
        const timeline = document.createElement('details');
        timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'turn-1');
        timeline.classList.add(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
        timeline.open = true;
        const summary = document.createElement('button');
        summary.className = 'theia-mobile-agent-activity-timeline-sticky-bar';
        timeline.append(summary);
        scroller.append(timeline);
        document.body.append(scroller);

        const disposable = attachTranscriptActivityTimelineStickySummary(scroller);

        expect(timeline.classList.contains(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS)).to.equal(false);
        timeline.classList.add(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS);
        disposable.dispose();
        expect(timeline.classList.contains(TRANSCRIPT_ACTIVITY_TIMELINE_STUCK_CLASS)).to.equal(false);
    });

});

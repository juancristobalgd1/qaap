// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { shouldStickTranscriptActivityTimelineSummary } from './qaap-transcript-activity-timeline-sticky-summary';

describe('shouldStickTranscriptActivityTimelineSummary', () => {

    it('returns false before the summary reaches the scrollport top', () => {
        const stuck = shouldStickTranscriptActivityTimelineSummary(
            { top: 120, bottom: 420, height: 300 } as DOMRectReadOnly,
            { top: 120, bottom: 148, height: 28 } as DOMRectReadOnly,
            { top: 0, bottom: 800, height: 800 } as DOMRectReadOnly,
        );
        expect(stuck).to.equal(false);
    });

    it('returns true while the summary is pinned and timeline content remains below', () => {
        const stuck = shouldStickTranscriptActivityTimelineSummary(
            { top: 40, bottom: 420, height: 380 } as DOMRectReadOnly,
            { top: 0, bottom: 28, height: 28 } as DOMRectReadOnly,
            { top: 0, bottom: 800, height: 800 } as DOMRectReadOnly,
        );
        expect(stuck).to.equal(true);
    });

    it('returns false once the timeline has scrolled fully past the scrollport top', () => {
        const stuck = shouldStickTranscriptActivityTimelineSummary(
            { top: -40, bottom: 20, height: 60 } as DOMRectReadOnly,
            { top: -40, bottom: -12, height: 28 } as DOMRectReadOnly,
            { top: 0, bottom: 800, height: 800 } as DOMRectReadOnly,
        );
        expect(stuck).to.equal(false);
    });
});

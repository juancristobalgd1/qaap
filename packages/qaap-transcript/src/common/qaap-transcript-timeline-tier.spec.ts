// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptTimelineItemTier,
    transcriptTimelineTierClassName,
    TRANSCRIPT_TIMELINE_RECENT_DISTANCE,
} from './qaap-transcript-timeline-tier';

describe('qaap-transcript-timeline-tier', () => {

    it('marks the live step as current', () => {
        expect(resolveTranscriptTimelineItemTier(2, 2, 6)).to.equal('current');
        expect(transcriptTimelineTierClassName('current')).to.equal('theia-mod-timeline-current');
    });

    it('keeps neighbours as recent and older steps as history', () => {
        const active = 5;
        for (let index = 0; index < 10; index += 1) {
            const distance = Math.abs(index - active);
            const tier = resolveTranscriptTimelineItemTier(index, active, 10);
            if (index === active) {
                expect(tier).to.equal('current');
            } else if (distance <= TRANSCRIPT_TIMELINE_RECENT_DISTANCE) {
                expect(tier).to.equal('recent');
            } else {
                expect(tier).to.equal('history');
            }
        }
    });

    it('treats the tail as recent when no live step exists', () => {
        expect(resolveTranscriptTimelineItemTier(8, -1, 10)).to.equal('recent');
        expect(resolveTranscriptTimelineItemTier(2, -1, 10)).to.equal('history');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptTimelineRenderWindow,
    TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD,
    TRANSCRIPT_TIMELINE_WINDOW_SIZE,
} from './qaap-transcript-timeline-window';

describe('qaap-transcript-timeline-window', () => {

    it('returns the full list below the virtualization threshold', () => {
        const window = resolveTranscriptTimelineRenderWindow(24, { enabled: true });
        expect(window.virtualized).to.equal(false);
        expect(window.end - window.start).to.equal(24);
    });

    it('windows long plan traces around the focused step', () => {
        const window = resolveTranscriptTimelineRenderWindow(120, {
            enabled: true,
            focusIndex: 100,
            threshold: TRANSCRIPT_TIMELINE_VIRTUALIZE_THRESHOLD,
            windowSize: TRANSCRIPT_TIMELINE_WINDOW_SIZE,
        });
        expect(window.virtualized).to.equal(true);
        expect(window.hiddenBefore).to.equal(84);
        expect(window.hiddenAfter).to.equal(4);
        expect(window.end - window.start).to.equal(TRANSCRIPT_TIMELINE_WINDOW_SIZE);
        expect(window.start).to.be.at.most(100);
        expect(window.end).to.be.above(100);
    });

    it('virtualizes long inline cursor traces the same way as plan traces', () => {
        const window = resolveTranscriptTimelineRenderWindow(64, { enabled: true, focusIndex: 60 });
        expect(window.virtualized).to.equal(true);
        expect(window.hiddenBefore).to.be.greaterThan(0);
    });
});

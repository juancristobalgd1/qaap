// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptActivityTimelineSummaryText,
} from './qaap-transcript-activity-timeline-summary';

describe('qaap-transcript-activity-timeline-summary', () => {

    it('shows "Processing for Xs" while streaming with a duration', () => {
        expect(resolveTranscriptActivityTimelineSummaryText(0, { streaming: true, durationMs: 12_000 }))
            .to.equal('Processing for 12s');
    });

    it('shows "Processing…" while streaming before any duration is known', () => {
        expect(resolveTranscriptActivityTimelineSummaryText(0, { streaming: true }))
            .to.equal('Processing…');
    });

    it('shows "Processed in Xs" after the turn settles', () => {
        expect(resolveTranscriptActivityTimelineSummaryText(0, { durationMs: 3_500 }))
            .to.equal('Processed in 3.5s');
    });

    it('shows "Processed" when no duration is available', () => {
        expect(resolveTranscriptActivityTimelineSummaryText(0))
            .to.equal('Processed');
    });

    it('appends the hidden-step count when collapsed', () => {
        expect(resolveTranscriptActivityTimelineSummaryText(3, { durationMs: 12_000 }))
            .to.equal('Processed in 12s · 3 earlier steps');
    });
});

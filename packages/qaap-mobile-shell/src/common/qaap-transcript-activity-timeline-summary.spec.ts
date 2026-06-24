// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import {
    resolveTranscriptActivityTimelineProgressText,
    resolveTranscriptActivityTimelineSummaryText,
} from './qaap-transcript-activity-timeline-summary';

describe('qaap-transcript-activity-timeline-summary', () => {

    it('prefers the live tool step over explored stats while streaming', () => {
        const items: TranscriptActivityNavigationItem[] = [
            { label: 'Read 3 files', state: 'success', verb: 'Read', detail: '3 files', toolKind: 'reading', grouped: true, groupCount: 3 },
            { label: 'Ran npm test', state: 'running', verb: 'Ran', detail: 'npm test', toolKind: 'terminal' },
        ];
        expect(resolveTranscriptActivityTimelineSummaryText([], items, 0, { streaming: true }))
            .to.equal('Ran npm test');
    });

    it('uses the last meaningful action after the turn settles', () => {
        const items: TranscriptActivityNavigationItem[] = [
            { label: 'Thinking', state: 'success', verb: 'Thinking', navigate: 'thought' },
            { label: 'Edited foo.ts', state: 'success', verb: 'Edited', detail: 'foo.ts', toolKind: 'editing' },
            { label: 'Preparing the response', state: 'success', verb: 'Preparing', detail: 'the response' },
        ];
        expect(resolveTranscriptActivityTimelineSummaryText([], items))
            .to.equal('Edited foo.ts');
    });

    it('shows active step with ellipsis in the progress line', () => {
        const items: TranscriptActivityNavigationItem[] = [
            { label: 'Read page.tsx', state: 'running', verb: 'Read', detail: 'page.tsx', toolKind: 'reading' },
        ];
        expect(resolveTranscriptActivityTimelineProgressText(items, { streaming: true }))
            .to.equal('Read page.tsx…');
    });

    it('falls back to Working only when no live step is known', () => {
        expect(resolveTranscriptActivityTimelineProgressText([], { streaming: true }))
            .to.equal('Working');
    });
});

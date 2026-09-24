// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { fingerprintTranscriptActivityItemContent, fingerprintTranscriptTimelineSync } from './qaap-transcript-timeline-sync-fingerprint';

describe('qaap-transcript-timeline-sync-fingerprint', () => {

    const expand = { revealAll: false, expandBefore: false, expandAfter: false };
    const window = { start: 0, end: 2, hiddenBefore: 0, hiddenAfter: 0, virtualized: false };

    it('changes when the active step state updates', () => {
        const items = [
            { label: 'Read a.ts', state: 'success' as const, segmentIndex: 0 },
            { label: 'Read b.ts', state: 'running' as const, segmentIndex: 1 },
        ];
        const before = fingerprintTranscriptTimelineSync(items, 1, window, expand);
        const after = fingerprintTranscriptTimelineSync([
            items[0],
            { ...items[1], state: 'success' },
        ], 1, window, expand);
        expect(before).to.not.equal(after);
    });

    it('stays stable when visible slots are unchanged', () => {
        const items = [
            { label: 'Read a.ts', state: 'success' as const, segmentIndex: 0 },
            { label: 'Read b.ts', state: 'running' as const, segmentIndex: 1 },
        ];
        const first = fingerprintTranscriptTimelineSync(items, 1, window, expand, { expanded: true });
        const second = fingerprintTranscriptTimelineSync(items, 1, window, expand, { expanded: true });
        expect(first).to.equal(second);
    });

    it('content fingerprint ignores active tier and shimmer chrome', () => {
        const item = { label: 'Read a.ts', state: 'running' as const, segmentIndex: 0, verb: 'Read', detail: 'a.ts' };
        const idle = fingerprintTranscriptActivityItemContent(item);
        expect(idle).to.equal(fingerprintTranscriptActivityItemContent({ ...item, label: 'Read a.ts' }));
    });
});

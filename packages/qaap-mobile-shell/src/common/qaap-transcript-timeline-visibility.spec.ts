// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTranscriptTimelineVisibilityPolicy } from './qaap-transcript-timeline-visibility';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';

function item(
    label: string,
    state: TranscriptActivityNavigationItem['state'],
): TranscriptActivityNavigationItem {
    return { label, state };
}

describe('qaap-transcript-timeline-visibility', () => {

    it('keeps the full trace below the collapse threshold', () => {
        const items = Array.from({ length: 12 }, (_, index) => item(`step-${index}`, 'success'));
        const policy = resolveTranscriptTimelineVisibilityPolicy(items);
        expect(policy.collapsed).to.equal(false);
        expect(policy.visibleItems).to.have.length(12);
    });

    it('collapses long traces while keeping active, error, and last completed steps', () => {
        const items = [
            ...Array.from({ length: 18 }, (_, index) => item(`read-${index}`, 'success')),
            item('npm test failed', 'error'),
            ...Array.from({ length: 4 }, (_, index) => item(`cleanup-${index}`, 'success')),
            item('Editing app.tsx', 'running'),
        ];
        const policy = resolveTranscriptTimelineVisibilityPolicy(items);
        expect(policy.collapsed).to.equal(true);
        expect(policy.hiddenCount).to.be.greaterThan(0);
        expect(policy.visibleItems.map(entry => entry.label)).to.include.members([
            'npm test failed',
            'cleanup-3',
            'Editing app.tsx',
        ]);
        expect(policy.visibleItems).to.have.length(3);
    });

    it('still honors an explicit maxVisibleItems cap for plan traces', () => {
        const items = Array.from({ length: 10 }, (_, index) => item(`step-${index}`, 'success'));
        const policy = resolveTranscriptTimelineVisibilityPolicy(items, { maxVisibleItems: 4 });
        expect(policy.visibleItems).to.have.length(4);
        expect(policy.visibleItems[0]?.label).to.equal('step-6');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveTranscriptTimelineRenderWindowWithExpand,
} from './qaap-transcript-timeline-gap-expand';

describe('resolveTranscriptTimelineRenderWindowWithExpand', () => {

    it('expands the leading gap when expandBefore is set', () => {
        const window = resolveTranscriptTimelineRenderWindowWithExpand(64, {
            enabled: true,
            focusIndex: 60,
            expand: { revealAll: false, expandBefore: true, expandAfter: false },
        });
        expect(window.start).to.equal(0);
        expect(window.hiddenBefore).to.equal(0);
        expect(window.end).to.equal(64);
    });

    it('expands the trailing gap when expandAfter is set', () => {
        const window = resolveTranscriptTimelineRenderWindowWithExpand(64, {
            enabled: true,
            focusIndex: 4,
            expand: { revealAll: false, expandBefore: false, expandAfter: true },
        });
        expect(window.end).to.equal(64);
        expect(window.hiddenAfter).to.equal(0);
    });

    it('shows the full list when revealAll is set', () => {
        const window = resolveTranscriptTimelineRenderWindowWithExpand(64, {
            enabled: true,
            focusIndex: 60,
            expand: { revealAll: true, expandBefore: true, expandAfter: true },
        });
        expect(window.virtualized).to.equal(false);
        expect(window.end - window.start).to.equal(64);
    });
});

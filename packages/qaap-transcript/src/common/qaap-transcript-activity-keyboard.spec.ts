// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveNextTranscriptActivityFocusIndex } from './qaap-transcript-activity-keyboard';

describe('resolveNextTranscriptActivityFocusIndex', () => {
    it('returns the next index when moving down', () => {
        expect(resolveNextTranscriptActivityFocusIndex(5, 2, 'next')).to.equal(3);
    });

    it('returns the previous index when moving up', () => {
        expect(resolveNextTranscriptActivityFocusIndex(5, 2, 'prev')).to.equal(1);
    });

    it('returns undefined at the first or last edge', () => {
        expect(resolveNextTranscriptActivityFocusIndex(3, 0, 'prev')).to.equal(undefined);
        expect(resolveNextTranscriptActivityFocusIndex(3, 2, 'next')).to.equal(undefined);
    });

    it('returns undefined for invalid indices', () => {
        expect(resolveNextTranscriptActivityFocusIndex(3, -1, 'next')).to.equal(undefined);
        expect(resolveNextTranscriptActivityFocusIndex(3, 3, 'prev')).to.equal(undefined);
    });
});

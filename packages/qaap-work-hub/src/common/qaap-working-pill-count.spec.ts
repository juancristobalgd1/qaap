// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveWorkingPillDisplayCount, type WorkingPillDisplayCountInput } from './qaap-working-pill-count';

const base: WorkingPillDisplayCountInput = {
    liveCount: 0,
    suppressedAfterStopAll: false,
    reading: false,
    suppressForEmptyComposer: false,
    surfaceMounted: true,
};

describe('resolveWorkingPillDisplayCount', () => {
    it('hides the pill when nothing in scope is working', () => {
        expect(resolveWorkingPillDisplayCount(base)).to.equal(0);
    });

    it('shows the scoped live count', () => {
        expect(resolveWorkingPillDisplayCount({ ...base, liveCount: 2 })).to.equal(2);
    });

    it('keeps a reading expand alive with at least one', () => {
        expect(resolveWorkingPillDisplayCount({ ...base, reading: true })).to.equal(1);
        expect(resolveWorkingPillDisplayCount({ ...base, reading: true, surfaceMounted: false })).to.equal(1);
    });

    it('hides after Stop All even while reading', () => {
        expect(resolveWorkingPillDisplayCount({ ...base, liveCount: 3, reading: true, suppressedAfterStopAll: true })).to.equal(0);
    });

    it('hides on empty composer surfaces and when no surface is mounted', () => {
        expect(resolveWorkingPillDisplayCount({ ...base, liveCount: 2, suppressForEmptyComposer: true })).to.equal(0);
        expect(resolveWorkingPillDisplayCount({ ...base, liveCount: 2, surfaceMounted: false })).to.equal(0);
    });
});

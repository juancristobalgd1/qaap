// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapLiveTaskDiff } from './qaap-live-task-diff';

describe('QaapLiveTaskDiff', () => {
    beforeEach(() => QaapLiveTaskDiff.clear());

    it('falls back to the total stored at turn settle when no live read was published', () => {
        expect(QaapLiveTaskDiff.resolve({ baselineCommit: 'b1', linesAdded: 188, linesRemoved: 4 }))
            .to.deep.equal({ added: 188, removed: 4 });
    });

    it('a published live total for the same baseline replaces the settled value', () => {
        QaapLiveTaskDiff.publish('b1', { added: 185, removed: 4 });
        expect(QaapLiveTaskDiff.resolve({ baselineCommit: 'b1', linesAdded: 188, linesRemoved: 4 }))
            .to.deep.equal({ added: 185, removed: 4 });
    });

    it('a live total never leaks into a task with another baseline', () => {
        QaapLiveTaskDiff.publish('b1', { added: 185, removed: 4 });
        expect(QaapLiveTaskDiff.resolve({ baselineCommit: 'b2', linesAdded: 7, linesRemoved: 0 }))
            .to.deep.equal({ added: 7, removed: 0 });
    });

    it('a live total of zero is shown as zero, not the stale settled value', () => {
        QaapLiveTaskDiff.publish('b1', { added: 0, removed: 0 });
        expect(QaapLiveTaskDiff.resolve({ baselineCommit: 'b1', linesAdded: 188, linesRemoved: 4 }))
            .to.deep.equal({ added: 0, removed: 0 });
    });

    it('resolves to zeros when there is no summary or no stored totals', () => {
        expect(QaapLiveTaskDiff.resolve(undefined)).to.deep.equal({ added: 0, removed: 0 });
        expect(QaapLiveTaskDiff.resolve({ baselineCommit: 'b1' })).to.deep.equal({ added: 0, removed: 0 });
    });

    it('sums the per-file counts the Changes panel shows, untracked files included', () => {
        expect(QaapLiveTaskDiff.sum([{ adds: 8, dels: 0 }, { adds: 84, dels: 2 }, { adds: 93, dels: 0 }]))
            .to.deep.equal({ added: 185, removed: 2 });
    });
});

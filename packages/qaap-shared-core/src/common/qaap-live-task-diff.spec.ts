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

    it('onDidChange fires when a published total differs, and not when it repeats', () => {
        const seen: Array<{ baselineCommit: string; added: number; removed: number }> = [];
        const subscription = QaapLiveTaskDiff.onDidChange(change => seen.push(change));
        QaapLiveTaskDiff.publish('b1', { added: 185, removed: 4 });
        QaapLiveTaskDiff.publish('b1', { added: 185, removed: 4 });
        QaapLiveTaskDiff.publish('b1', { added: 188, removed: 4 });
        subscription.dispose();
        QaapLiveTaskDiff.publish('b1', { added: 190, removed: 4 });
        expect(seen).to.deep.equal([
            { baselineCommit: 'b1', added: 185, removed: 4 },
            { baselineCommit: 'b1', added: 188, removed: 4 },
        ]);
    });

    it('bindTotals patches with the live total of its own baseline only', () => {
        const element = { isConnected: true };
        const rendered: Array<{ added: number; removed: number }> = [];
        const binding = QaapLiveTaskDiff.bindTotals(element, 'b1', totals => rendered.push(totals));
        QaapLiveTaskDiff.publish('b2', { added: 9, removed: 9 });
        QaapLiveTaskDiff.publish('b1', { added: 185, removed: 4 });
        expect(rendered).to.deep.equal([{ added: 185, removed: 4 }]);
        binding.dispose();
    });

    it('bindTotals releases itself once its element has left the DOM', () => {
        const element = { isConnected: true };
        const rendered: number[] = [];
        QaapLiveTaskDiff.bindTotals(element, 'b1', totals => rendered.push(totals.added));
        QaapLiveTaskDiff.publish('b1', { added: 1, removed: 0 });
        element.isConnected = false;
        QaapLiveTaskDiff.publish('b1', { added: 2, removed: 0 });
        QaapLiveTaskDiff.publish('b1', { added: 3, removed: 0 });
        expect(rendered).to.deep.equal([1]);
    });

    it('dispose releases a binding before its element is removed', () => {
        const element = { isConnected: true };
        const rendered: number[] = [];
        const binding = QaapLiveTaskDiff.bindTotals(element, 'b1', totals => rendered.push(totals.added));
        binding.dispose();
        QaapLiveTaskDiff.publish('b1', { added: 5, removed: 0 });
        expect(rendered).to.deep.equal([]);
    });
});

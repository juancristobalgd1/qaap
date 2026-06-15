// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    accumulateComposerSessionDisplayStats,
    summarizeComposerSessionDiffFiles,
} from './qaap-composer-session-diff-stats';

describe('qaap-composer-session-diff-stats', () => {
    it('summarizes git numstat totals from changed files', () => {
        expect(summarizeComposerSessionDiffFiles([
            { path: 'a.txt', added: 20, removed: 0 },
            { path: 'b.txt', added: 5, removed: 3 },
        ])).to.deep.equal({ added: 25, removed: 3 });
    });

    it('keeps +N from decreasing while −N catches up on removals', () => {
        let display = accumulateComposerSessionDisplayStats(undefined, undefined, { added: 850, removed: 0 });
        expect(display).to.deep.equal({ added: 850, removed: 0 });

        display = accumulateComposerSessionDisplayStats(display, { added: 850, removed: 0 }, { added: 820, removed: 118 });
        expect(display).to.deep.equal({ added: 850, removed: 118 });
    });

    it('turns insertion drops into −N when git never reports deletions (new file edits)', () => {
        let display = accumulateComposerSessionDisplayStats(undefined, undefined, { added: 28, removed: 0 });
        expect(display).to.deep.equal({ added: 28, removed: 0 });

        display = accumulateComposerSessionDisplayStats(display, { added: 28, removed: 0 }, { added: 15, removed: 0 });
        expect(display).to.deep.equal({ added: 28, removed: 13 });

        display = accumulateComposerSessionDisplayStats(display, { added: 15, removed: 0 }, { added: 0, removed: 0 });
        expect(display).to.deep.equal({ added: 28, removed: 28 });
    });
});

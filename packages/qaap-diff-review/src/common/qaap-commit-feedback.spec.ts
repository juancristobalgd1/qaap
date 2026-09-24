// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { formatCommitFeedback } from './qaap-commit-feedback';

describe('formatCommitFeedback', () => {
    const fallback = 'Changes committed';

    it('shows branch and counts when both are present', () => {
        expect(formatCommitFeedback(fallback, 'main', { files: 3, insertions: 42, deletions: 18 }))
            .to.equal('Committed to main (+42 −18)');
    });

    it('shows just the branch when there is no line delta (e.g. rename/mode only)', () => {
        expect(formatCommitFeedback(fallback, 'feature/x', { files: 1, insertions: 0, deletions: 0 }))
            .to.equal('Committed to feature/x');
    });

    it('shows just the branch when the stat is missing', () => {
        expect(formatCommitFeedback(fallback, 'main')).to.equal('Committed to main');
    });

    it('falls back when the branch is unknown', () => {
        expect(formatCommitFeedback(fallback, undefined, { files: 1, insertions: 5, deletions: 0 })).to.equal(fallback);
        expect(formatCommitFeedback(fallback, '   ')).to.equal(fallback);
    });

    it('includes counts when only one side changed', () => {
        expect(formatCommitFeedback(fallback, 'main', { files: 1, insertions: 10, deletions: 0 }))
            .to.equal('Committed to main (+10 −0)');
    });
});

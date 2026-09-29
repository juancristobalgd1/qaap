// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGitHunkLine } from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import { buildContextSegments, diffLineKey } from './qaap-diff-review-segments';

function ctx(n: number): QaapGitHunkLine {
    return { type: 'ctx', oldNumber: n, newNumber: n, text: `line ${n}` };
}

describe('qaap-diff-review-segments — buildContextSegments', () => {
    it('collapses long context runs and keeps short ones visible', () => {
        const lines: QaapGitHunkLine[] = [
            ctx(1), ctx(2), ctx(3), ctx(4),
            { type: 'del', oldNumber: 5, text: 'old' },
            { type: 'add', newNumber: 5, text: 'new' },
            ctx(6), ctx(7),
        ];
        const segments = buildContextSegments(lines);
        expect(segments.map(segment => [segment.kind, segment.lines.length])).to.deep.equal([
            ['collapsed', 4], ['lines', 1], ['lines', 1], ['lines', 2],
        ]);
    });

    it('returns the cached result for the same lines array', () => {
        const lines = [ctx(1)];
        expect(buildContextSegments(lines)).to.equal(buildContextSegments(lines));
        expect(buildContextSegments([ctx(1)])).to.not.equal(buildContextSegments(lines));
    });
});

describe('qaap-diff-review-segments — diffLineKey', () => {
    it('gives distinct stable keys to a removed and an added line at the same number', () => {
        const del = diffLineKey({ type: 'del', oldNumber: 5, text: 'a' }, 0);
        const add = diffLineKey({ type: 'add', newNumber: 5, text: 'b' }, 1);
        expect(del).to.not.equal(add);
        expect(diffLineKey({ type: 'add', newNumber: 5, text: 'changed' }, 7)).to.equal(add);
    });

    it('falls back to the index without line numbers', () => {
        expect(diffLineKey({ type: 'ctx', text: '' }, 3)).to.equal('i3');
    });
});

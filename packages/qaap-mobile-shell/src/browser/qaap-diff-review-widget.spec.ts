// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGitChangedFile } from '../common/qaap-git-review';
import { selectFileAfterRefresh } from './qaap-diff-review-select';

function file(path: string, adds = 1, dels = 0): QaapGitChangedFile {
    return { path, status: 'M', adds, dels, staged: false };
}

describe('qaap-diff-review-widget — selectFileAfterRefresh', () => {

    it('returns the selected file when it is still present (diff must reload)', () => {
        const files = [file('src/a.ts'), file('src/b.ts')];
        const next = selectFileAfterRefresh(files, 'src/a.ts');
        expect(next).to.equal('src/a.ts');
    });

    it('returns the selected file even when adds/dels changed (stale-diff regression)', () => {
        const files = [file('src/a.ts', 5, 2), file('src/b.ts')];
        const next = selectFileAfterRefresh(files, 'src/a.ts');
        expect(next).to.equal('src/a.ts');
    });

    it('falls back to the first file when the selected file disappeared', () => {
        const files = [file('src/b.ts'), file('src/c.ts')];
        const next = selectFileAfterRefresh(files, 'src/a.ts');
        expect(next).to.equal('src/b.ts');
    });

    it('returns undefined when the changes list is empty', () => {
        expect(selectFileAfterRefresh([], 'src/a.ts')).to.equal(undefined);
    });

    it('returns the first file when no file was previously selected', () => {
        const files = [file('src/a.ts'), file('src/b.ts')];
        const next = selectFileAfterRefresh(files, undefined);
        expect(next).to.equal('src/a.ts');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_GIT_REVIEW_API_PATH } from '@theia/qaap-shared-core/lib/common/qaap-git-review';
import { QaapDiffReviewScope } from './qaap-diff-review-scope';

const BASE = 'a'.repeat(40);

describe('QaapDiffReviewScope', () => {
    it('offers the task scope only with a baseline the server accepted', () => {
        expect(QaapDiffReviewScope.available(BASE, false)).to.deep.equal(['task', 'uncommitted']);
        expect(QaapDiffReviewScope.available(BASE, true)).to.deep.equal(['uncommitted']);
        expect(QaapDiffReviewScope.available(undefined, false)).to.deep.equal(['uncommitted']);
    });

    it('defaults to the task scope and falls back when it is not available', () => {
        expect(QaapDiffReviewScope.resolve(undefined, BASE, false)).to.equal('task');
        expect(QaapDiffReviewScope.resolve('uncommitted', BASE, false)).to.equal('uncommitted');
        expect(QaapDiffReviewScope.resolve('task', undefined, false)).to.equal('uncommitted');
        expect(QaapDiffReviewScope.resolve('task', BASE, true)).to.equal('uncommitted');
    });

    it('sends the baseline only for the task scope', () => {
        expect(QaapDiffReviewScope.baseCommit('task', BASE, false)).to.equal(BASE);
        expect(QaapDiffReviewScope.baseCommit('uncommitted', BASE, false)).to.equal(undefined);
        expect(QaapDiffReviewScope.baseCommit('task', BASE, true)).to.equal(undefined);
    });

    it('builds the changes and diff request URLs', () => {
        expect(QaapDiffReviewScope.changesUrl('/repo a', undefined)).to.equal(`${QAAP_GIT_REVIEW_API_PATH}/changes?root=%2Frepo%20a`);
        expect(QaapDiffReviewScope.changesUrl('/repo', BASE)).to.equal(`${QAAP_GIT_REVIEW_API_PATH}/changes?root=%2Frepo&baseCommit=${BASE}`);
        expect(QaapDiffReviewScope.diffUrl('/repo', 'src/a b.ts', undefined)).to.equal(`${QAAP_GIT_REVIEW_API_PATH}/diff?root=%2Frepo&file=src%2Fa%20b.ts`);
        expect(QaapDiffReviewScope.diffUrl('/repo', 'a.ts', BASE)).to.equal(`${QAAP_GIT_REVIEW_API_PATH}/diff?root=%2Frepo&file=a.ts&baseCommit=${BASE}`);
    });

    it('abbreviates commit ids', () => {
        expect(QaapDiffReviewScope.shortCommit(BASE)).to.equal('aaaaaaa');
    });
});

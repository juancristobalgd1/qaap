// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isQaapGitReviewMissingRootError,
    isQaapGitReviewNotRepoError,
    QAAP_GIT_REVIEW_MISSING_ROOT_ERROR,
    QAAP_GIT_REVIEW_NOT_REPO_ERROR,
    readQaapGitReviewErrorBody,
} from './qaap-git-review';

describe('qaap-git-review error helpers', () => {
    it('reads error from JSON bodies', () => {
        expect(readQaapGitReviewErrorBody(JSON.stringify({ error: QAAP_GIT_REVIEW_MISSING_ROOT_ERROR })))
            .to.equal(QAAP_GIT_REVIEW_MISSING_ROOT_ERROR);
    });

    it('returns trimmed plain text when not JSON', () => {
        expect(readQaapGitReviewErrorBody('  boom  ')).to.equal('boom');
    });

    it('detects missing-root and not-repo messages', () => {
        expect(isQaapGitReviewMissingRootError(QAAP_GIT_REVIEW_MISSING_ROOT_ERROR)).to.equal(true);
        expect(isQaapGitReviewNotRepoError(QAAP_GIT_REVIEW_NOT_REPO_ERROR)).to.equal(true);
        expect(isQaapGitReviewMissingRootError('other')).to.equal(false);
    });
});

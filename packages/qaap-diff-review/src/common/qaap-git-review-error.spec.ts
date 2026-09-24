// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { readQaapGitReviewErrorBody } from '@theia/qaap-shared-core/lib/common/qaap-git-review';

describe('qaap-git-review error helpers', () => {
    it('returns trimmed plain text when not JSON', () => {
        expect(readQaapGitReviewErrorBody('  boom  ')).to.equal('boom');
    });

});

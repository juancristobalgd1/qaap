// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import {
    filterHostedWorkspaceUris,
    isAllowedHostedRepositoryWorkspaceUri,
    isForbiddenHostedWorkspaceUri,
} from './qaap-workspace-isolation';

describe('qaap-workspace-isolation', () => {
    it('treats hosted workspace containers as forbidden roots', () => {
        expect(isForbiddenHostedWorkspaceUri(new URI('file:///workspace'))).to.be.true;
        expect(isForbiddenHostedWorkspaceUri(new URI('file:///workspace/repos/users/alice'))).to.be.true;
    });

    it('allows repository roots and local dev folders', () => {
        expect(isForbiddenHostedWorkspaceUri(new URI('file:///workspace/repos/users/alice/acme/demo'))).to.be.false;
        expect(isForbiddenHostedWorkspaceUri(new URI('file:///Users/jc/qaap'))).to.be.false;
        expect(isAllowedHostedRepositoryWorkspaceUri(new URI('file:///workspace/repos/users/alice/acme/demo'))).to.be.true;
        expect(isAllowedHostedRepositoryWorkspaceUri(new URI('file:///Users/jc/qaap'))).to.be.true;
    });

    it('filters container paths from recent workspace lists', () => {
        const filtered = filterHostedWorkspaceUris([
            'file:///workspace',
            'file:///workspace/repos/users/alice/acme/demo',
            'file:///Users/jc/qaap',
        ]);
        expect(filtered).to.deep.equal([
            'file:///workspace/repos/users/alice/acme/demo',
            'file:///Users/jc/qaap',
        ]);
    });
});

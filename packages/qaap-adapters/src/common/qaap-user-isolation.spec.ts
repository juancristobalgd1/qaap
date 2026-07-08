// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveTenantSegmentFromWorkspacePath } from './qaap-user-isolation';

describe('resolveTenantSegmentFromWorkspacePath', () => {
    const reposRoot = '/workspace/repos';

    it('extracts the tenant segment from a repo cwd', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/alice/acme/site'))
            .to.equal('alice');
    });

    it('returns the segment for the tenant root itself', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/alice')).to.equal('alice');
    });

    it('returns the reserved bucket segment verbatim', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/_anonymous/o/r'))
            .to.equal('_anonymous');
    });

    it('returns undefined for the users container itself (no tenant segment)', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users')).to.equal(undefined);
    });

    it('returns undefined for paths outside the per-user tree', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos')).to.equal(undefined);
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/tmp/somewhere')).to.equal(undefined);
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/other/users/alice')).to.equal(undefined);
    });

    it('does not escape the users root via traversal', () => {
        expect(resolveTenantSegmentFromWorkspacePath(reposRoot, '/workspace/repos/users/../secret')).to.equal(undefined);
    });
});

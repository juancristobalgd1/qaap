// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { parseUserRepositoryCloneFromWorkspacePath } from './qaap-user-repository-clone-path';

describe('parseUserRepositoryCloneFromWorkspacePath', () => {
    it('reads owner and repo of a per-user clone, keeping GitHub casing', () => {
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/users/jcristgd/leoMirandaa/shadcn-landing-page'))
            .to.deep.equal({ owner: 'leoMirandaa', name: 'shadcn-landing-page' });
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/users/jcristgd/jcristgd/claude-of-duty/'))
            .to.deep.equal({ owner: 'jcristgd', name: 'claude-of-duty' });
    });

    it('ignores container roots, nested folders, worktrees and legacy flat paths', () => {
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace')).to.equal(undefined);
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/users/jcristgd')).to.equal(undefined);
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/users/jcristgd/jcristgd')).to.equal(undefined);
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/users/jcristgd/jcristgd/OpenDots/src')).to.equal(undefined);
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/users/jcristgd/.qaap-worktrees/abc')).to.equal(undefined);
        expect(parseUserRepositoryCloneFromWorkspacePath('/workspace/repos/octocat/Hello-World')).to.equal(undefined);
    });
});

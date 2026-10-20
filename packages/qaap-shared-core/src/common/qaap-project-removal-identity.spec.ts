// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { qaapProjectRemovalIdentity } from './qaap-project-removal-identity';

describe('qaapProjectRemovalIdentity', () => {

    it('resolves path-keyed sessions under the user repos root on POSIX', () => {
        const root = '/opt/qaap-runtime/workspace/repos/users/juancristobalgd1';
        expect(qaapProjectRemovalIdentity('recent:file:///opt/qaap-runtime/workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq', root))
            .to.equal('github:juancristobalgd1/vyyq');
        expect(qaapProjectRemovalIdentity('ws:file:///workspace/repos/users/juancristobalgd1/juancristobalgd1/vyyq'))
            .to.equal('github:juancristobalgd1/vyyq');
    });

    it('resolves file URIs with a drive letter against a Windows user repos root', () => {
        const root = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\qaap-removed-repo-1K6Uav\\users\\alice';
        expect(qaapProjectRemovalIdentity('recent:file:///C:/Users/RUNNER~1/AppData/Local/Temp/qaap-removed-repo-1K6Uav/users/alice/acme/shop', root))
            .to.equal('github:acme/shop');
        expect(qaapProjectRemovalIdentity('ws:file:///c%3A/Users/RUNNER~1/AppData/Local/Temp/qaap-removed-repo-1K6Uav/users/alice/acme/shop', root))
            .to.equal('github:acme/shop');
        expect(qaapProjectRemovalIdentity('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\qaap-removed-repo-1K6Uav\\users\\alice\\acme\\shop\\src', root))
            .to.equal('github:acme/shop');
    });

    // Production (juancristobalgd1): the task worktree card vyyq_1 resolved to nothing, so its removal was never recorded.
    it('resolves a task worktree to its own removal key', () => {
        const identity = 'worktree:juancristobalgd1/733cf503';
        expect(qaapProjectRemovalIdentity('/tmp/qaap-worktrees/juancristobalgd1/733cf503')).to.equal(identity);
        expect(qaapProjectRemovalIdentity('ws:file:///tmp/qaap-worktrees/juancristobalgd1/733cf503')).to.equal(identity);
        expect(qaapProjectRemovalIdentity('/tmp/qaap-worktrees/juancristobalgd1/733cf503/web', '/workspace/repos/users/juancristobalgd1')).to.equal(identity);
        expect(qaapProjectRemovalIdentity('worktree:JuanCristobalGD1/733CF503')).to.equal(identity);
        expect(qaapProjectRemovalIdentity('/tmp/qaap-worktrees/juancristobalgd1')).to.equal(undefined);
    });

    it('resolves a repository named repos, below its root too, and a nested repos root', () => {
        for (const key of ['ws:file:///workspace/repos/users/me/foo/repos', '/workspace/repos/users/me/foo/repos/src', 'github:Foo/repos']) {
            expect(qaapProjectRemovalIdentity(key), key).to.equal('github:foo/repos');
        }
        expect(qaapProjectRemovalIdentity('ws:file:///home/u/repos/qaap-data/repos/users/me/acme/web')).to.equal('github:acme/web');
        expect(qaapProjectRemovalIdentity('ws:file:///tmp/scratch/web')).to.equal(undefined);
    });

    it('does not resolve paths outside the user repos root', () => {
        expect(qaapProjectRemovalIdentity('recent:file:///D:/other/acme/shop', 'C:\\repos\\users\\alice')).to.equal(undefined);
    });
});

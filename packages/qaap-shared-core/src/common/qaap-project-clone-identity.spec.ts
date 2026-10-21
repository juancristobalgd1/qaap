// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { qaapCloneRootIdentity, qaapProjectCloneIdentities } from './qaap-project-clone-identity';

describe('qaapCloneRootIdentity', () => {
    const CLONE = '/workspace/repos/users/jcristgd/juancristobalgd1/OpenDots';

    it('resolves the per-user clone, the legacy flat clone, a trailing slash and another casing to one identity', () => {
        for (const cwd of [CLONE, '/workspace/repos/juancristobalgd1/OpenDots', `${CLONE}/`, CLONE.toLowerCase()]) {
            expect(qaapCloneRootIdentity(cwd), cwd).to.equal('github:juancristobalgd1/opendots');
        }
    });

    it('anchors on the first repos segment when the repo or owner is itself named repos', () => {
        expect(qaapCloneRootIdentity('/workspace/repos/users/me/foo/repos')).to.equal('github:foo/repos');
        expect(qaapCloneRootIdentity('/workspace/repos/repos/foo')).to.equal('github:repos/foo');
    });

    it('resolves a repos root nested inside another repos folder', () => {
        expect(qaapCloneRootIdentity('/home/u/repos/qaap-data/repos/users/me/acme/web')).to.equal('github:acme/web');
        expect(qaapCloneRootIdentity('file:///home/u/repos/qaap-data/repos/acme/web')).to.equal('github:acme/web');
        expect(qaapCloneRootIdentity('/home/u/repos/qaap-data/repos/users/me/acme/web/src')).to.equal(undefined);
    });

    it('resolves a legacy flat clone whose owner is named users', () => {
        expect(qaapCloneRootIdentity('/workspace/repos/users/web')).to.equal('github:users/web');
    });

    it('does not resolve a folder below the clone root or a non-clone path', () => {
        expect(qaapCloneRootIdentity(`${CLONE}/packages/web`)).to.equal(undefined);
        // A subfolder named like the repository is not the clone root, in either layout.
        expect(qaapCloneRootIdentity('/workspace/repos/users/me/acme/web/apps/web')).to.equal(undefined);
        expect(qaapCloneRootIdentity('/workspace/repos/acme/web/apps/web')).to.equal(undefined);
        expect(qaapCloneRootIdentity('/workspace/repos/users/me/acme/web')).to.equal('github:acme/web');
        expect(qaapCloneRootIdentity('/tmp/scratch')).to.equal(undefined);
        expect(qaapCloneRootIdentity(undefined)).to.equal(undefined);
    });
});

describe('qaapProjectCloneIdentities', () => {
    const github = { owner: 'juancristobalgd1', name: 'OpenDots' };

    it('claims the repository of a github card with or without a clone URI', () => {
        expect(qaapProjectCloneIdentities({ id: 'github:juancristobalgd1/OpenDots', github })).to.deep.equal(['github:juancristobalgd1/opendots']);
    });

    it('never lets a synthetic ws: card claim, unless it is the workspace open right now', () => {
        const uri = FileUri.create('/workspace/repos/juancristobalgd1/OpenDots');
        const id = `ws:${uri.toString()}`;
        expect(qaapProjectCloneIdentities({ id, uri })).to.deep.equal([]);
        expect(qaapProjectCloneIdentities({ id, uri, isCurrent: true })).to.deep.equal(['github:juancristobalgd1/opendots']);
    });
});

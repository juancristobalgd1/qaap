// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { deduplicateMobileProjectEntries } from './mobile-projects-dedup';
import type { MobileProjectEntry } from './mobile-projects-types';

const ctx = {
    normalizeName: (name: string | undefined): string | undefined => {
        const normalized = name?.trim().toLowerCase();
        return normalized || undefined;
    },
    cwdFromUri: (uri: URI | undefined): string | undefined => uri?.path.toString(),
    projectActivityTime: () => 0,
};

function project(partial: Partial<MobileProjectEntry> & Pick<MobileProjectEntry, 'id' | 'name'>): MobileProjectEntry {
    return {
        color: '#000',
        branch: 'main',
        status: 'idle',
        task: '',
        progress: 0,
        agents: [],
        lastActive: '—',
        tokens: '—',
        cost: '—',
        pinned: false,
        isCurrent: false,
        ...partial,
    };
}

describe('mobile-projects-dedup', () => {

    it('keeps the workspace card when github also marks the same repo as current', () => {
        const uri = new URI('file:///workspace/landig-page');
        const workspace = project({
            id: 'ws:file:///workspace/landig-page',
            name: 'Landig-Page',
            uri,
            isCurrent: true,
        });
        const github = project({
            id: 'github:owner/Landig-Page',
            name: 'landig-page',
            uri,
            isCurrent: true,
            github: {
                owner: 'owner',
                name: 'Landig-Page',
                fullName: 'owner/Landig-Page',
                htmlUrl: 'https://github.com/owner/Landig-Page',
                private: false,
            },
        });

        const deduped = deduplicateMobileProjectEntries([github, workspace], ctx);

        expect(deduped).to.have.length(1);
        expect(deduped[0].id).to.equal(workspace.id);
        expect(deduped[0].isCurrent).to.equal(true);
    });

    it('drops a recent card that matches the current workspace by normalized name', () => {
        const uri = new URI('file:///workspace/landig-page');
        const workspace = project({
            id: 'ws:file:///workspace/landig-page',
            name: 'Landig-Page',
            uri,
            isCurrent: true,
        });
        const recent = project({
            id: 'recent:file:///workspace/landig-page',
            name: 'landig-page',
            uri,
        });

        const deduped = deduplicateMobileProjectEntries([recent, workspace], ctx);

        expect(deduped).to.have.length(1);
        expect(deduped[0].id).to.equal(workspace.id);
    });

    it('drops a github card for the current repo even when its URI differs (legacy vs per-user clone path)', () => {
        const workspace = project({
            id: 'ws:file:///workspace/repos/users/jcristgd/Vamello',
            name: 'Vamello',
            uri: new URI('file:///workspace/repos/users/jcristgd/Vamello'),
            isCurrent: true,
        });
        const github = project({
            id: 'github:jcristgd/Vamello',
            name: 'Vamello',
            uri: new URI('file:///workspace/repos/Vamello'),
            github: {
                owner: 'jcristgd',
                name: 'Vamello',
                fullName: 'jcristgd/Vamello',
                htmlUrl: 'https://github.com/jcristgd/Vamello',
                private: true,
            },
        });

        const deduped = deduplicateMobileProjectEntries([github, workspace], ctx);

        expect(deduped).to.have.length(1);
        expect(deduped[0].id).to.equal(workspace.id);
    });

    it('drops a custom card matching the current repo by name with no URI at all', () => {
        const workspace = project({
            id: 'ws:file:///workspace/repos/users/jcristgd/Vamello',
            name: 'Vamello',
            uri: new URI('file:///workspace/repos/users/jcristgd/Vamello'),
            isCurrent: true,
        });
        const custom = project({
            id: 'custom:1234567890',
            name: 'vamello',
        });

        const deduped = deduplicateMobileProjectEntries([custom, workspace], ctx);

        expect(deduped).to.have.length(1);
        expect(deduped[0].id).to.equal(workspace.id);
    });

    it('keeps a non-current project whose name differs from the current workspace', () => {
        const workspace = project({
            id: 'ws:file:///workspace/repos/users/jcristgd/Vamello',
            name: 'Vamello',
            uri: new URI('file:///workspace/repos/users/jcristgd/Vamello'),
            isCurrent: true,
        });
        const other = project({
            id: 'github:jcristgd/otra-cosa',
            name: 'otra-cosa',
            uri: new URI('file:///workspace/repos/users/jcristgd/otra-cosa'),
            github: {
                owner: 'jcristgd',
                name: 'otra-cosa',
                fullName: 'jcristgd/otra-cosa',
                htmlUrl: 'https://github.com/jcristgd/otra-cosa',
                private: false,
            },
        });

        const deduped = deduplicateMobileProjectEntries([other, workspace], ctx);

        expect(deduped).to.have.length(2);
    });

    it('keeps distinct projects that only share a basename in different folders', () => {
        const alpha = project({
            id: 'recent:file:///workspace/alpha/demo',
            name: 'demo',
            uri: new URI('file:///workspace/alpha/demo'),
        });
        const beta = project({
            id: 'recent:file:///workspace/beta/demo',
            name: 'demo',
            uri: new URI('file:///workspace/beta/demo'),
        });

        const deduped = deduplicateMobileProjectEntries([alpha, beta], ctx);

        expect(deduped).to.have.length(2);
    });

    it('keeps github repos with the same name under different owners', () => {
        const alpha = project({
            id: 'github:alpha/demo',
            name: 'demo',
            github: {
                owner: 'alpha',
                name: 'demo',
                fullName: 'alpha/demo',
                htmlUrl: 'https://github.com/alpha/demo',
                private: false,
            },
        });
        const beta = project({
            id: 'github:beta/demo',
            name: 'demo',
            github: {
                owner: 'beta',
                name: 'demo',
                fullName: 'beta/demo',
                htmlUrl: 'https://github.com/beta/demo',
                private: false,
            },
        });

        const deduped = deduplicateMobileProjectEntries([alpha, beta], ctx);

        expect(deduped.map(candidate => candidate.id)).to.deep.equal([alpha.id, beta.id]);
    });

});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGitHistoryCommit } from './qaap-git-review';
import {
    collectHistoryAuthors,
    collectHistoryBranches,
    cycleHistoryFilter,
    filterTranscriptHistoryCommits,
} from './qaap-transcript-history-filter';

function commit(partial: Partial<QaapGitHistoryCommit> & Pick<QaapGitHistoryCommit, 'subject' | 'authorName'>): QaapGitHistoryCommit {
    return {
        hash: partial.hash ?? 'abc',
        shortHash: partial.shortHash ?? 'abc',
        subject: partial.subject,
        authorName: partial.authorName,
        authoredAt: partial.authoredAt ?? '2026-01-01',
        refs: partial.refs ?? [],
    };
}

describe('qaap-transcript-history-filter', () => {

    const commits = [
        commit({ subject: 'Fix login', authorName: 'Ada', refs: ['HEAD -> main', 'origin/main'] }),
        commit({ subject: 'Add tests', authorName: 'Bob', refs: ['feature/verify'] }),
    ];

    it('filters by author, branch, and search query', () => {
        expect(filterTranscriptHistoryCommits(commits, { author: 'Ada' }).map(item => item.subject))
            .to.deep.equal(['Fix login']);
        expect(filterTranscriptHistoryCommits(commits, { branch: 'feature/verify' }).map(item => item.subject))
            .to.deep.equal(['Add tests']);
        expect(filterTranscriptHistoryCommits(commits, { query: 'login' }).map(item => item.subject))
            .to.deep.equal(['Fix login']);
    });

    it('collects unique authors and branches', () => {
        expect(collectHistoryAuthors(commits)).to.deep.equal(['Ada', 'Bob']);
        expect(collectHistoryBranches(commits, 'main')).to.deep.equal(['feature/verify', 'main']);
    });

    it('cycles filter values and returns to all', () => {
        expect(cycleHistoryFilter(undefined, ['Ada', 'Bob'])).to.equal('Ada');
        expect(cycleHistoryFilter('Ada', ['Ada', 'Bob'])).to.equal('Bob');
        expect(cycleHistoryFilter('Bob', ['Ada', 'Bob'])).to.equal(undefined);
    });
});

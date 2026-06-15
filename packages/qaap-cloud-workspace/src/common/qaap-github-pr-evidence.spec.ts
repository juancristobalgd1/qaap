// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildGithubTaskEvidenceComment,
    resolveGithubEvidenceTarget,
    wasGithubEvidencePostedForTask,
} from './qaap-github-pr-evidence';

describe('qaap-github-pr-evidence', () => {
    it('resolves evidence target from github anchor or linked PR', () => {
        expect(resolveGithubEvidenceTarget({
            githubEvidence: { owner: 'o', repo: 'r', issueNumber: 3 },
        })).to.deep.equal({ owner: 'o', repo: 'r', issueNumber: 3 });
        expect(resolveGithubEvidenceTarget({
            linkedPullRequest: { owner: 'o', repo: 'r', number: 9 },
        })).to.deep.equal({ owner: 'o', repo: 'r', issueNumber: 9 });
    });

    it('tracks posted task ids for idempotency', () => {
        expect(wasGithubEvidencePostedForTask(
            { owner: 'o', repo: 'r', issueNumber: 1, postedTaskIds: ['t1'] },
            undefined,
            't1',
        )).to.be.true;
        expect(wasGithubEvidencePostedForTask(undefined, ['t2'], 't2')).to.be.true;
    });

    it('builds a markdown evidence comment with summary and diff stats', () => {
        const body = buildGithubTaskEvidenceComment({
            ok: true,
            title: 'Fix flaky test',
            summary: 'Updated retry logic in CI helper.',
            linesAdded: 12,
            linesRemoved: 3,
            workHubUrl: 'https://qaap.example/?qaap_route=transcript',
        });
        expect(body).to.contain('**Qaap** ✅ completed');
        expect(body).to.contain('Updated retry logic');
        expect(body).to.contain('+12 −3');
        expect(body).to.contain('[Open in Qaap]');
    });
});

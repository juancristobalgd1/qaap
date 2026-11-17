// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapGithubPullRequestCheck, QaapGithubPullRequestTimelineEvent } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    pullRequestDisplayState,
    qaapWorkHubPullRequestTargetKey,
    recentPullRequestComments,
    resolveQaapWorkHubPullRequestTarget,
    summarizePullRequestChecks,
    summarizePullRequestReview,
} from './qaap-work-hub-aux-pull-request-model';

const project = { github: { owner: 'acme', name: 'app' }, branch: 'main' };

describe('qaap-work-hub-aux-pull-request-model', () => {

    describe('resolveQaapWorkHubPullRequestTarget', () => {
        it('follows the exact pull request recorded on the task', () => {
            const target = resolveQaapWorkHubPullRequestTarget(project, {
                id: 'c1',
                taskPullRequest: { owner: 'acme', repo: 'app', number: 42, branch: 'qaap/task/c1' },
            });
            expect(target).to.deep.equal({ owner: 'acme', repo: 'app', number: 42, branch: 'qaap/task/c1', scope: 'task:c1' });
        });

        it('prefers the task pull request over a linked one', () => {
            const target = resolveQaapWorkHubPullRequestTarget(project, {
                id: 'c1',
                taskPullRequest: { owner: 'acme', repo: 'app', number: 42, branch: 'qaap/task/c1' },
                linkedPullRequest: { owner: 'acme', repo: 'app', number: 7, branch: 'feature/x' },
            });
            expect(target?.number).to.equal(42);
        });

        it('uses a linked pull request when the task has none, and looks it up by its branch when the number is unknown', () => {
            const target = resolveQaapWorkHubPullRequestTarget(project, {
                id: 'c1',
                linkedPullRequest: { owner: 'acme', repo: 'app', branch: 'feature/x' },
            });
            expect(target).to.deep.equal({ owner: 'acme', repo: 'app', number: undefined, branch: 'feature/x', scope: 'task:c1' });
        });

        it('falls back to the task branch on the project repository when no pull request is recorded', () => {
            const target = resolveQaapWorkHubPullRequestTarget(project, { id: 'c1' });
            expect(target?.branch).to.equal('qaap/task/c1');
            expect(target?.number).to.equal(undefined);
            expect(target?.owner).to.equal('acme');
            expect(target?.repo).to.equal('app');
        });

        it('uses the project repository and current branch when no task is open', () => {
            expect(resolveQaapWorkHubPullRequestTarget(project)).to.deep.equal({
                owner: 'acme', repo: 'app', branch: 'main', scope: 'project:acme/app',
            });
        });

        it('has no target without a GitHub repository or without a branch to look up', () => {
            expect(resolveQaapWorkHubPullRequestTarget({ branch: 'main' })).to.equal(undefined);
            expect(resolveQaapWorkHubPullRequestTarget({ github: { owner: 'acme', name: 'app' }, branch: '  ' })).to.equal(undefined);
            expect(resolveQaapWorkHubPullRequestTarget({ branch: 'main' }, { id: 'c1' })).to.equal(undefined);
        });

        it('keys a target by what it follows, so switching tasks or branches refetches', () => {
            const a = resolveQaapWorkHubPullRequestTarget(project, { id: 'c1' })!;
            const b = resolveQaapWorkHubPullRequestTarget(project, { id: 'c2' })!;
            expect(qaapWorkHubPullRequestTargetKey(a)).to.not.equal(qaapWorkHubPullRequestTargetKey(b));
            expect(qaapWorkHubPullRequestTargetKey(a)).to.equal(qaapWorkHubPullRequestTargetKey({ ...a }));
        });
    });

    describe('summarizePullRequestChecks', () => {
        const check = (name: string, status: QaapGithubPullRequestCheck['status'], conclusion?: QaapGithubPullRequestCheck['conclusion']): QaapGithubPullRequestCheck =>
            ({ name, status, conclusion });

        it('reports nothing for a pull request without checks', () => {
            expect(summarizePullRequestChecks(undefined)).to.include({ total: 0, passed: 0, failed: 0, pending: 0 });
        });

        it('counts passed, failed and pending checks and lists the failed ones in order', () => {
            const summary = summarizePullRequestChecks([
                check('build', 'completed', 'success'),
                check('lint', 'completed', 'failure'),
                check('e2e', 'in_progress'),
                check('docs', 'queued'),
                check('perf', 'completed', 'timed_out'),
                check('deploy-preview', 'completed', 'skipped'),
            ]);
            expect(summary.total).to.equal(6);
            expect(summary.passed).to.equal(1);
            expect(summary.failed).to.equal(2);
            expect(summary.pending).to.equal(2);
            expect(summary.skipped).to.equal(1);
            expect(summary.failedChecks.map(item => item.name)).to.deep.equal(['lint', 'perf']);
        });

        it('never counts a neutral, stale or conclusion-less completed check as passed or failed', () => {
            const summary = summarizePullRequestChecks([
                check('a', 'completed', 'neutral'),
                check('b', 'completed', 'stale'),
                check('c', 'completed'),
            ]);
            expect(summary).to.include({ passed: 0, failed: 0, pending: 0, skipped: 3 });
        });
    });

    describe('pullRequestDisplayState', () => {
        it('reads merged and closed first, then draft, then open (a missing state reads as open)', () => {
            expect(pullRequestDisplayState({ state: 'merged', draft: false })).to.equal('merged');
            expect(pullRequestDisplayState({ state: 'closed', draft: true })).to.equal('closed');
            expect(pullRequestDisplayState({ state: 'open', draft: true })).to.equal('draft');
            expect(pullRequestDisplayState({ state: 'open' })).to.equal('open');
            expect(pullRequestDisplayState({})).to.equal('open');
        });
    });

    describe('summarizePullRequestReview', () => {
        it('lets requested changes win over approval, then requests and comments decide', () => {
            expect(summarizePullRequestReview({
                reviews: [{ login: 'a', state: 'approved' }, { login: 'b', state: 'changes_requested' }],
            })).to.equal('changes-requested');
            expect(summarizePullRequestReview({ reviews: [{ login: 'a', state: 'approved' }] })).to.equal('approved');
            expect(summarizePullRequestReview({ reviews: [], requestedReviewers: [{ login: 'c' }] })).to.equal('review-requested');
            expect(summarizePullRequestReview({ reviews: [{ login: 'a', state: 'commented' }] })).to.equal('commented');
            expect(summarizePullRequestReview({})).to.equal('none');
        });
    });

    describe('recentPullRequestComments', () => {
        const event = (kind: QaapGithubPullRequestTimelineEvent['kind'], text?: string): QaapGithubPullRequestTimelineEvent => ({ kind, text, actor: 'dev' });

        it('keeps the newest comments and review bodies, newest first, skipping empty and non-comment events', () => {
            const comments = recentPullRequestComments({
                timeline: [
                    event('committed', 'chore: bump'),
                    event('commented', 'first'),
                    event('labeled', 'bug'),
                    event('reviewed', 'second'),
                    event('commented', '   '),
                    event('commented', 'third'),
                    event('commented', 'fourth'),
                ],
            }, 3);
            expect(comments.map(item => item.text)).to.deep.equal(['fourth', 'third', 'second']);
        });

        it('is empty when the detail carries no timeline', () => {
            expect(recentPullRequestComments({})).to.deep.equal([]);
        });
    });
});

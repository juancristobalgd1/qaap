// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildPullRequestWatchWakeMessage,
    diffPullRequestWatch,
    mergePullRequestWatchPendingEvents,
    parseAgentWatchPullRequestSignal,
    parsePullRequestWatchTarget,
    pullRequestWatchUrl,
    QAAP_AGENT_WATCH_PR_MARKER,
    QAAP_PR_WATCH_MAX_COMMENT_IDS,
    QAAP_PR_WATCH_MAX_PENDING_EVENTS,
    QAAP_PR_WATCH_MAX_REVIEW_IDS,
    summarizePullRequestWatch,
    summarizePullRequestWatchChecks,
    type QaapPullRequestWatch,
    type QaapPullRequestWatchSnapshot,
} from './qaap-pull-request-watch';

function emptySnapshot(overrides: Partial<QaapPullRequestWatchSnapshot> = {}): QaapPullRequestWatchSnapshot {
    return {
        prState: 'open',
        headSha: 'sha-1',
        checks: [],
        reviews: [],
        comments: [],
        ...overrides,
    };
}

describe('qaap-pull-request-watch', () => {

    describe('parsePullRequestWatchTarget & parseAgentWatchPullRequestSignal', () => {

        it('parses bare numbers, #numbers and GitHub PR URLs', () => {
            expect(parsePullRequestWatchTarget('42')).to.deep.equal({ number: 42 });
            expect(parsePullRequestWatchTarget('#42')).to.deep.equal({ number: 42 });
            expect(parsePullRequestWatchTarget('`#108`')).to.deep.equal({ number: 108 });
            expect(parsePullRequestWatchTarget('https://github.com/acme/demo/pull/544')).to.deep.equal({
                owner: 'acme',
                repo: 'demo',
                number: 544,
            });
            expect(parsePullRequestWatchTarget('<https://www.github.com/acme/demo.git/pull/7/files#diff-1>')).to.deep.equal({
                owner: 'acme',
                repo: 'demo',
                number: 7,
            });
        });

        it('rejects garbage, zero, negative numbers and non-PR URLs', () => {
            expect(parsePullRequestWatchTarget(undefined)).to.equal(undefined);
            expect(parsePullRequestWatchTarget('')).to.equal(undefined);
            expect(parsePullRequestWatchTarget('0')).to.equal(undefined);
            expect(parsePullRequestWatchTarget('-3')).to.equal(undefined);
            expect(parsePullRequestWatchTarget('not-a-pr')).to.equal(undefined);
            expect(parsePullRequestWatchTarget('https://github.com/acme/demo/issues/42')).to.equal(undefined);
            expect(parsePullRequestWatchTarget('https://example.com/acme/demo/pull/42')).to.equal(undefined);
        });

        it('extracts the last valid marker outside fenced code blocks', () => {
            const text = [
                'I opened the pull request.',
                '```md',
                `${QAAP_AGENT_WATCH_PR_MARKER} 999`,
                '```',
                `${QAAP_AGENT_WATCH_PR_MARKER} 12`,
                `${QAAP_AGENT_WATCH_PR_MARKER} not-valid`,
                `${QAAP_AGENT_WATCH_PR_MARKER} https://github.com/acme/demo/pull/55`,
            ].join('\n');
            expect(parseAgentWatchPullRequestSignal(text)).to.deep.equal({
                owner: 'acme',
                repo: 'demo',
                number: 55,
            });
        });

        it('ignores markers inside fenced code blocks when none appear outside', () => {
            const text = [
                'Use this syntax:',
                '```',
                `${QAAP_AGENT_WATCH_PR_MARKER} 42`,
                '```',
            ].join('\n');
            expect(parseAgentWatchPullRequestSignal(text)).to.equal(undefined);
        });
    });

    describe('summarizePullRequestWatchChecks', () => {

        it('classifies none, pending, failed and passed', () => {
            expect(summarizePullRequestWatchChecks([])).to.equal('none');
            expect(summarizePullRequestWatchChecks([
                { name: 'build', status: 'completed', conclusion: 'success' },
                { name: 'lint', status: 'in_progress' },
            ])).to.equal('pending');
            expect(summarizePullRequestWatchChecks([
                { name: 'build', status: 'completed', conclusion: 'success' },
                { name: 'test', status: 'completed', conclusion: 'failure' },
            ])).to.equal('failed');
            expect(summarizePullRequestWatchChecks([
                { name: 'build', status: 'completed', conclusion: 'success' },
                { name: 'optional', status: 'completed', conclusion: 'skipped' },
            ])).to.equal('passed');
        });
    });

    describe('diffPullRequestWatch', () => {

        it('records baseline without waking for pre-existing reviews/comments or passed checks', () => {
            const diff = diffPullRequestWatch(
                { lastSeen: { reviewIds: [], commentIds: [] }, lastPolledAt: undefined },
                emptySnapshot({
                    checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
                    reviews: [{ id: 10, author: 'bob', state: 'APPROVED', body: 'LGTM' }],
                    comments: [{ id: 20, author: 'bob', body: 'Nice' }],
                }),
            );
            expect(diff.events).to.deep.equal([]);
            expect(diff.terminal).to.equal(undefined);
            expect(diff.lastSeen).to.deep.equal({
                headSha: 'sha-1',
                checks: 'passed',
                reviewIds: [10],
                commentIds: [20],
                prState: 'open',
            });
        });

        it('wakes on baseline when checks are already finished red, capped at 5 names', () => {
            const checks = Array.from({ length: 7 }, (_, i) => ({
                name: `job-${i + 1}`,
                status: 'completed' as const,
                conclusion: 'failure',
                url: i === 0 ? 'https://ci.example/1' : undefined,
            }));
            const diff = diffPullRequestWatch(
                { lastSeen: { reviewIds: [], commentIds: [] }, lastPolledAt: undefined },
                emptySnapshot({ checks, reviews: [{ id: 10, author: 'bob', state: 'COMMENTED', body: 'old' }] }),
            );
            expect(diff.events).to.deep.equal([
                'checks failed: job-1 (https://ci.example/1), job-2, job-3, job-4, job-5, and 2 more',
            ]);
            expect(diff.lastSeen.checks).to.equal('failed');
            expect(diff.lastSeen.reviewIds).to.deep.equal([10]);
        });

        it('emits events on pending -> failed and pending -> passed transitions without repeating unchanged state', () => {
            const pending = diffPullRequestWatch(
                { lastSeen: { headSha: 'sha-1', checks: 'pending', reviewIds: [], commentIds: [] }, lastPolledAt: 100 },
                emptySnapshot({ checks: [{ name: 'test', status: 'completed', conclusion: 'failure', url: 'https://ci/t' }] }),
            );
            expect(pending.events).to.deep.equal(['checks failed: test (https://ci/t)']);

            const unchanged = diffPullRequestWatch(
                { lastSeen: pending.lastSeen, lastPolledAt: 200 },
                emptySnapshot({ checks: [{ name: 'test', status: 'completed', conclusion: 'failure', url: 'https://ci/t' }] }),
            );
            expect(unchanged.events).to.deep.equal([]);

            const passed = diffPullRequestWatch(
                { lastSeen: { headSha: 'sha-2', checks: 'pending', reviewIds: [], commentIds: [] }, lastPolledAt: 300 },
                emptySnapshot({ headSha: 'sha-2', checks: [{ name: 'test', status: 'completed', conclusion: 'success' }] }),
            );
            expect(passed.events).to.deep.equal(['all checks passed']);
        });

        it('reports new reviews and comments, ignores self-authored items and empty comment-only review wrappers', () => {
            const longBody = 'x'.repeat(350);
            const diff = diffPullRequestWatch(
                { lastSeen: { headSha: 'sha-1', checks: 'passed', reviewIds: [1], commentIds: [10] }, lastPolledAt: 100 },
                emptySnapshot({
                    checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
                    reviews: [
                        { id: 1, author: 'bob', state: 'COMMENTED', body: 'already seen' },
                        { id: 2, author: 'alice', state: 'CHANGES_REQUESTED', body: 'self' },
                        { id: 3, author: 'bob', state: 'COMMENTED', body: '   ' },
                        { id: 4, author: 'bob', state: 'PENDING', body: 'draft' },
                        { id: 5, author: 'carol', state: 'CHANGES_REQUESTED', body: longBody },
                    ],
                    comments: [
                        { id: 10, author: 'bob', body: 'seen' },
                        { id: 11, author: 'ALICE', body: 'my own reply' },
                        { id: 12, author: 'bob', body: 'Please rename this', path: 'src/a.ts', line: 42 },
                        { id: 13, author: 'dave', body: 'Top-level comment' },
                    ],
                }),
                { ignoreAuthor: 'alice' },
            );
            expect(diff.events).to.have.length(3);
            expect(diff.events[0]).to.equal(`new review by carol: changes requested ${'x'.repeat(300)}…`);
            expect(diff.events[1]).to.equal('new comment by bob on src/a.ts:42: Please rename this');
            expect(diff.events[2]).to.equal('new comment by dave: Top-level comment');
            expect(diff.lastSeen.reviewIds).to.deep.equal([1, 2, 3, 4, 5]);
            expect(diff.lastSeen.commentIds).to.deep.equal([10, 11, 12, 13]);
        });

        it('caps remembered review/comment ids and does not re-report old ids that fell off the cap', () => {
            const seenReviews = Array.from({ length: QAAP_PR_WATCH_MAX_REVIEW_IDS }, (_, i) => i + 100);
            const seenComments = Array.from({ length: QAAP_PR_WATCH_MAX_COMMENT_IDS }, (_, i) => i + 1000);
            const diff = diffPullRequestWatch(
                { lastSeen: { headSha: 'sha-1', checks: 'none', reviewIds: seenReviews, commentIds: seenComments }, lastPolledAt: 100 },
                emptySnapshot({
                    reviews: [
                        { id: 50, author: 'bob', state: 'APPROVED', body: 'old review below floor' },
                        { id: 999, author: 'bob', state: 'APPROVED', body: 'brand new' },
                    ],
                    comments: [
                        { id: 500, author: 'bob', body: 'old comment below floor' },
                        { id: 5000, author: 'bob', body: 'brand new comment' },
                    ],
                }),
            );
            expect(diff.events).to.deep.equal([
                'new review by bob: approved brand new',
                'new comment by bob: brand new comment',
            ]);
            expect(diff.lastSeen.reviewIds).to.have.length(QAAP_PR_WATCH_MAX_REVIEW_IDS);
            expect(diff.lastSeen.reviewIds[diff.lastSeen.reviewIds.length - 1]).to.equal(999);
            expect(diff.lastSeen.commentIds).to.have.length(QAAP_PR_WATCH_MAX_COMMENT_IDS);
            expect(diff.lastSeen.commentIds[diff.lastSeen.commentIds.length - 1]).to.equal(5000);
        });

        it('returns terminal merged or closed with no wake events', () => {
            const merged = diffPullRequestWatch(
                { lastSeen: { reviewIds: [], commentIds: [] }, lastPolledAt: 100 },
                emptySnapshot({ prState: 'merged' }),
            );
            expect(merged.terminal).to.equal('merged');
            expect(merged.events).to.deep.equal([]);
            expect(merged.lastSeen.prState).to.equal('merged');

            const closed = diffPullRequestWatch(
                { lastSeen: { reviewIds: [], commentIds: [] }, lastPolledAt: 100 },
                emptySnapshot({ prState: 'closed' }),
            );
            expect(closed.terminal).to.equal('closed');
            expect(closed.events).to.deep.equal([]);
        });
    });

    describe('helpers', () => {

        it('dedupes and caps pending events', () => {
            const initial = Array.from({ length: QAAP_PR_WATCH_MAX_PENDING_EVENTS }, (_, i) => `ev-${i}`);
            const merged = mergePullRequestWatchPendingEvents(initial, ['ev-5', 'ev-new-1', 'ev-new-2']);
            expect(merged).to.have.length(QAAP_PR_WATCH_MAX_PENDING_EVENTS);
            expect(merged[0]).to.equal('ev-2');
            expect(merged.slice(-2)).to.deep.equal(['ev-new-1', 'ev-new-2']);
        });

        it('builds wake message, summary and URL', () => {
            const msg = buildPullRequestWatchWakeMessage(42, ['checks failed: lint', 'new comment by bob: fix it']);
            expect(msg).to.include('[Qaap · watching pull request #42]');
            expect(msg).to.include('- checks failed: lint');
            expect(msg).to.include('- new comment by bob: fix it');
            expect(msg).to.include('until it is merged or closed.');

            const watch: QaapPullRequestWatch = {
                owner: 'acme',
                repo: 'demo',
                number: 42,
                startedAt: 1,
                startedBy: 'agent',
                state: 'watching',
                lastSeen: { reviewIds: [], commentIds: [] },
            };
            expect(pullRequestWatchUrl(watch)).to.equal('https://github.com/acme/demo/pull/42');
            expect(summarizePullRequestWatch(watch)).to.deep.equal({
                owner: 'acme',
                repo: 'demo',
                number: 42,
                state: 'watching',
                startedBy: 'agent',
            });
        });
    });
});

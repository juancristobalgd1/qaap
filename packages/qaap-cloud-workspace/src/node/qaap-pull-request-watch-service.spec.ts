// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import { GithubApiError, type QaapGithubPullRequestRecord } from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import {
    QAAP_AGENT_WATCH_PR_MARKER,
    type QaapPullRequestWatch,
    type QaapPullRequestWatchCheck,
    type QaapPullRequestWatchComment,
    type QaapPullRequestWatchReview,
} from '@theia/qaap-shared-core/lib/common/qaap-pull-request-watch';
import { QAAP_NOTICE_TRACE_ID_PREFIX } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import {
    toConversationSummary,
    type QaapAgentConversation,
    type QaapAgentConversationEvent,
} from '../common/qaap-agent-conversation';
import { recordPullRequestWatchExtracted, type QaapPullRequestWatchRecordOptions } from './qaap-agent-conversation-store-pr-watch';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import {
    QaapPullRequestWatchService,
    resolvePullRequestWatchIntervalMs,
    QAAP_PR_WATCH_DEFAULT_INTERVAL_MS,
    QAAP_PR_WATCH_MIN_INTERVAL_MS,
    type QaapPullRequestWatchGithub,
} from './qaap-pull-request-watch-service';

interface PostedWake {
    readonly conversationId: string;
    readonly content: string;
}

interface TestHarness {
    readonly service: QaapPullRequestWatchService;
    readonly conversations: Map<string, QaapAgentConversation>;
    readonly posted: PostedWake[];
    readonly onDidChange: Emitter<QaapAgentConversationEvent>;
    token: string | undefined;
    activeTasks: Set<string>;
    pull: QaapGithubPullRequestRecord;
    checks: QaapPullRequestWatchCheck[];
    reviews: QaapPullRequestWatchReview[];
    comments: QaapPullRequestWatchComment[];
    getPullError: Error | undefined;
    clock: number;
}

function makeConversation(overrides: Partial<QaapAgentConversation> = {}): QaapAgentConversation {
    return {
        id: 'conv-1',
        cwd: '/repo',
        agentId: 'claude',
        ownerLogin: 'alice',
        title: 'Fix PR',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        linkedPullRequest: { owner: 'acme', repo: 'demo', number: 42 },
        messages: [
            { id: 'u1', role: 'user', content: 'fix it', createdAt: 10, turnAgentId: 'claude' },
            { id: 'a1', role: 'agent', content: 'done', createdAt: 20 },
        ],
        ...overrides,
    };
}

function createHarness(initial: QaapAgentConversation = makeConversation()): TestHarness {
    const conversations = new Map<string, QaapAgentConversation>([[initial.id, initial]]);
    const posted: PostedWake[] = [];
    const onDidChange = new Emitter<QaapAgentConversationEvent>();
    const activeTasks = new Set<string>();
    const state: {
        token: string | undefined;
        pull: QaapGithubPullRequestRecord;
        checks: QaapPullRequestWatchCheck[];
        reviews: QaapPullRequestWatchReview[];
        comments: QaapPullRequestWatchComment[];
        getPullError: Error | undefined;
        clock: number;
    } = {
        token: 'gho_test',
        pull: { number: 42, url: 'https://github.com/acme/demo/pull/42', body: '', draft: false, state: 'open', merged: false, headSha: 'sha-1' },
        checks: [],
        reviews: [],
        comments: [],
        getPullError: undefined,
        clock: 1_000_000,
    };

    const storeCtx = {
        conversations,
        fire: (event: QaapAgentConversationEvent) => onDidChange.fire(event),
        persist: async () => undefined,
        publishFinalizedAgentMessage: () => undefined,
    } as unknown as QaapAgentConversationStoreContext;

    const fakeStore = {
        conversations,
        onDidChange: onDidChange.event,
        whenReady: async () => undefined,
        get: (id: string) => conversations.get(id),
        getActiveTaskIdsForConversation: (id: string) => activeTasks.has(id) ? ['task-1'] : [],
        recordPullRequestWatch: (id: string, watch: QaapPullRequestWatch, options?: QaapPullRequestWatchRecordOptions) =>
            recordPullRequestWatchExtracted(storeCtx, id, watch, options),
        postUserMessage: (conversationId: string, content: string) => {
            posted.push({ conversationId, content });
            const conv = conversations.get(conversationId)!;
            const next: QaapAgentConversation = {
                ...conv,
                messages: [...conv.messages, { id: `u-${posted.length + 1}`, role: 'user', content, createdAt: state.clock }],
            };
            conversations.set(conversationId, next);
            return next;
        },
    };

    const fakeTaskPr = {
        resolveOwnerToken: () => state.token,
        isQuiescent: (conv: QaapAgentConversation) =>
            conv.status === 'idle'
            && (conv.pendingUserMessages?.length ?? 0) === 0
            && conv.interactionModeId !== 'plan'
            && conv.interactionModeId !== 'ask'
            && !activeTasks.has(conv.id),
        resolveRepository: async () => ({ owner: 'acme', repo: 'demo' }),
    };

    const fakeGithub: QaapPullRequestWatchGithub = {
        getPull: async () => {
            if (state.getPullError) {
                throw state.getPullError;
            }
            return state.pull;
        },
        getChecks: async () => state.checks,
        getReviews: async () => state.reviews,
        getComments: async () => state.comments,
    };

    const service = Object.create(QaapPullRequestWatchService.prototype) as QaapPullRequestWatchService;
    Object.assign(service, {
        store: fakeStore,
        taskPullRequests: fakeTaskPr,
        github: fakeGithub,
        inFlight: new Set<string>(),
        processedMarkerMessages: new Set<string>(),
        now: () => state.clock,
    });
    (service as unknown as { init(): void }).init();

    return {
        service,
        conversations,
        posted,
        onDidChange,
        activeTasks,
        get token(): string | undefined { return state.token; },
        set token(v: string | undefined) { state.token = v; },
        get pull(): QaapGithubPullRequestRecord { return state.pull; },
        set pull(v: QaapGithubPullRequestRecord) { state.pull = v; },
        get checks(): QaapPullRequestWatchCheck[] { return state.checks; },
        set checks(v: QaapPullRequestWatchCheck[]) { state.checks = v; },
        get reviews(): QaapPullRequestWatchReview[] { return state.reviews; },
        set reviews(v: QaapPullRequestWatchReview[]) { state.reviews = v; },
        get comments(): QaapPullRequestWatchComment[] { return state.comments; },
        set comments(v: QaapPullRequestWatchComment[]) { state.comments = v; },
        get getPullError(): Error | undefined { return state.getPullError; },
        set getPullError(v: Error | undefined) { state.getPullError = v; },
        get clock(): number { return state.clock; },
        set clock(v: number) { state.clock = v; },
    };
}

describe('QaapPullRequestWatchService', () => {

    it('resolves polling interval with 60s default and 15s floor', () => {
        expect(resolvePullRequestWatchIntervalMs({})).to.equal(QAAP_PR_WATCH_DEFAULT_INTERVAL_MS);
        expect(resolvePullRequestWatchIntervalMs({ QAAP_PR_WATCH_INTERVAL_MS: '5000' })).to.equal(QAAP_PR_WATCH_MIN_INTERVAL_MS);
        expect(resolvePullRequestWatchIntervalMs({ QAAP_PR_WATCH_INTERVAL_MS: '45000' })).to.equal(45_000);
    });

    it('wakes a quiescent conversation once when checks fail after baseline', async () => {
        const h = createHarness();
        await h.service.startWatch('conv-1');

        // Baseline poll while checks are pending: no wake.
        h.checks = [{ name: 'ci', status: 'in_progress' }];
        await h.service.sweep(h.clock);
        expect(h.posted).to.have.length(0);

        // Next poll: check fails -> wakes once.
        h.clock += 60_000;
        h.checks = [{ name: 'ci', status: 'completed', conclusion: 'failure', url: 'https://ci/1' }];
        await h.service.sweep(h.clock);
        expect(h.posted).to.have.length(1);
        expect(h.posted[0].content).to.include('[Qaap · watching pull request #42]');
        expect(h.posted[0].content).to.include('checks failed: ci (https://ci/1)');

        // Repeating the same state does not wake again.
        h.clock += 60_000;
        await h.service.sweep(h.clock);
        expect(h.posted).to.have.length(1);
    });

    it('queues events in pendingEvents while busy and delivers them on the next quiescent sweep', async () => {
        const h = createHarness();
        await h.service.startWatch('conv-1');
        h.checks = [{ name: 'ci', status: 'in_progress' }];
        await h.service.sweep(h.clock);

        // Conversation becomes busy (streaming).
        h.conversations.set('conv-1', { ...h.conversations.get('conv-1')!, status: 'streaming' });
        h.clock += 60_000;
        h.reviews = [{ id: 101, author: 'bob', state: 'CHANGES_REQUESTED', body: 'Add a test' }];
        await h.service.sweep(h.clock);

        expect(h.posted).to.have.length(0);
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.pendingEvents).to.deep.equal([
            'new review by bob: changes requested Add a test',
        ]);

        // Conversation becomes idle again -> delivers queued pending event.
        h.conversations.set('conv-1', { ...h.conversations.get('conv-1')!, status: 'idle' });
        h.clock += 60_000;
        await h.service.sweep(h.clock);

        expect(h.posted).to.have.length(1);
        expect(h.posted[0].content).to.include('new review by bob: changes requested Add a test');
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.pendingEvents).to.equal(undefined);
    });

    it('stops watching with a neutral transcript notice and no wake when the PR is merged', async () => {
        const h = createHarness();
        await h.service.startWatch('conv-1');
        await h.service.sweep(h.clock);

        h.clock += 60_000;
        h.pull = { ...h.pull, state: 'closed', merged: true };
        await h.service.sweep(h.clock);

        expect(h.posted).to.have.length(0);
        const conv = h.conversations.get('conv-1')!;
        expect(conv.pullRequestWatch?.state).to.equal('stopped');
        expect(conv.pullRequestWatch?.stopReason).to.equal('merged');
        const notice = conv.messages[1].traceEvents?.at(-1);
        expect(notice?.id?.startsWith(QAAP_NOTICE_TRACE_ID_PREFIX)).to.equal(true);
        expect((notice as { message?: string } | undefined)?.message).to.include('#42');
        expect((notice as { message?: string } | undefined)?.message).to.include('merged');
    });

    it('enforces the 6 wakes/hour rate limit and keeps pendingEvents with lastError wake budget', async () => {
        const h = createHarness();
        await h.service.startWatch('conv-1');
        await h.service.sweep(h.clock);

        for (let i = 1; i <= 7; i++) {
            h.clock += 60_000;
            h.comments = [...h.comments, { id: i, author: 'bob', body: `comment ${i}` }];
            await h.service.sweep(h.clock);
        }

        expect(h.posted).to.have.length(6);
        const watch = h.conversations.get('conv-1')?.pullRequestWatch;
        expect(watch?.state).to.equal('watching');
        expect(watch?.lastError).to.equal('wake budget');
        expect(watch?.pendingEvents).to.deep.equal(['new comment by bob: comment 7']);
    });

    it('skips rate-limited sweeps and stops with notice after 3 consecutive 401/403/404 failures', async () => {
        const h = createHarness();
        await h.service.startWatch('conv-1');

        // Rate limited: skipped without counting as failure.
        h.getPullError = new GithubApiError('rate limit', 403, true);
        await h.service.sweep(h.clock);
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.consecutiveFailures ?? 0).to.equal(0);
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.state).to.equal('watching');

        // Three consecutive 404s -> stops with stopReason 'error' and notice.
        h.getPullError = new GithubApiError('Not Found', 404, false);
        await h.service.sweep(h.clock + 60_000);
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.state).to.equal('watching');
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.consecutiveFailures).to.equal(1);

        await h.service.sweep(h.clock + 120_000);
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.state).to.equal('watching');
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.consecutiveFailures).to.equal(2);

        await h.service.sweep(h.clock + 180_000);
        const conv = h.conversations.get('conv-1')!;
        expect(conv.pullRequestWatch?.state).to.equal('stopped');
        expect(conv.pullRequestWatch?.stopReason).to.equal('error');
        expect(conv.pullRequestWatch?.lastError).to.equal('Not Found');
        const notice = conv.messages[1].traceEvents?.at(-1);
        expect(notice?.id?.startsWith(QAAP_NOTICE_TRACE_ID_PREFIX)).to.equal(true);
    });

    it('starts watching automatically when an agent final message carries @@QAAP:WATCH_PR@@ and does not replay after Stop', async () => {
        const conv = makeConversation({
            linkedPullRequest: undefined,
            messages: [
                { id: 'u1', role: 'user', content: 'watch it', createdAt: 10 },
                { id: 'a-watch', role: 'agent', content: `Watching.\n${QAAP_AGENT_WATCH_PR_MARKER} https://github.com/org/repo/pull/77`, createdAt: 20 },
            ],
        });
        const h = createHarness(conv);
        h.onDidChange.fire({ type: 'updated', conversation: toConversationSummary(conv) });
        await new Promise(resolve => setTimeout(resolve, 10));

        const started = h.conversations.get('conv-1')?.pullRequestWatch;
        expect(started?.state).to.equal('watching');
        expect(started?.startedBy).to.equal('agent');
        expect(started?.owner).to.equal('org');
        expect(started?.repo).to.equal('repo');
        expect(started?.number).to.equal(77);
        expect(started?.sourceMessageId).to.equal('a-watch');

        // User stops -> firing updated again must not restart from the same agent message.
        h.service.stopWatch('conv-1', 'user');
        h.onDidChange.fire({ type: 'updated', conversation: toConversationSummary(h.conversations.get('conv-1')!) });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(h.conversations.get('conv-1')?.pullRequestWatch?.state).to.equal('stopped');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import { nls } from '@theia/core/lib/common/nls';
import {
    buildPullRequestWatchWakeMessage,
    diffPullRequestWatch,
    mergePullRequestWatchPendingEvents,
    parseAgentWatchPullRequestSignal,
    parsePullRequestWatchTarget,
    pullRequestWatchUrl,
    type QaapPullRequestWatch,
    type QaapPullRequestWatchCheck,
    type QaapPullRequestWatchComment,
    type QaapPullRequestWatchRequest,
    type QaapPullRequestWatchReview,
    type QaapPullRequestWatchSnapshot,
    type QaapStartPullRequestWatchBody,
} from '@theia/qaap-shared-core/lib/common/qaap-pull-request-watch';
import {
    fetchGithubPullRequestChecks,
    fetchGithubPullRequestComments,
    fetchGithubPullRequestRecord,
    fetchGithubPullRequestReviewRecords,
    GithubApiError,
    type QaapGithubPullRequestRecord,
} from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import { QaapHostedProjectResolver } from '@theia/qaap-shared-core/lib/node/qaap-hosted-project-resolver';
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { isGoalLoopActive } from '../common/qaap-agent-goal-loop';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapTaskPullRequestService } from './qaap-task-pull-request-service';

/** Default polling interval for watched pull requests (60 s). */
export const QAAP_PR_WATCH_DEFAULT_INTERVAL_MS = 60_000;
/** Floor for `QAAP_PR_WATCH_INTERVAL_MS` so a misconfiguration cannot hammer GitHub. */
export const QAAP_PR_WATCH_MIN_INTERVAL_MS = 15_000;
/** Maximum agent wakes per conversation per rolling hour. */
export const QAAP_PR_WATCH_MAX_WAKES_PER_HOUR = 6;
const QAAP_PR_WATCH_WAKE_WINDOW_MS = 60 * 60 * 1000;
/** Stop watching after this many consecutive auth/not-found failures. */
export const QAAP_PR_WATCH_MAX_CONSECUTIVE_FAILURES = 3;

/** Route-level error carrying an HTTP status code for the endpoint. */
export class QaapPullRequestWatchError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'QaapPullRequestWatchError';
    }
}

/** GitHub REST calls made by {@link QaapPullRequestWatchService}; replaced wholesale in specs. */
export interface QaapPullRequestWatchGithub {
    getPull(token: string, owner: string, repo: string, pullNumber: number): Promise<QaapGithubPullRequestRecord>;
    getChecks(token: string, owner: string, repo: string, sha: string): Promise<readonly QaapPullRequestWatchCheck[]>;
    getReviews(token: string, owner: string, repo: string, pullNumber: number): Promise<readonly QaapPullRequestWatchReview[]>;
    getComments(token: string, owner: string, repo: string, pullNumber: number): Promise<readonly QaapPullRequestWatchComment[]>;
}

const DEFAULT_GITHUB: QaapPullRequestWatchGithub = {
    getPull: (token, owner, repo, pullNumber) => fetchGithubPullRequestRecord(token, owner, repo, pullNumber),
    getChecks: (token, owner, repo, sha) => fetchGithubPullRequestChecks(token, owner, repo, sha),
    getReviews: (token, owner, repo, pullNumber) => fetchGithubPullRequestReviewRecords(token, owner, repo, pullNumber),
    getComments: (token, owner, repo, pullNumber) => fetchGithubPullRequestComments(token, owner, repo, pullNumber),
};

/** Resolves `QAAP_PR_WATCH_INTERVAL_MS`, floored at {@link QAAP_PR_WATCH_MIN_INTERVAL_MS}. */
export function resolvePullRequestWatchIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
    const configured = Number.parseInt(env.QAAP_PR_WATCH_INTERVAL_MS?.trim() ?? '', 10);
    if (Number.isInteger(configured) && configured > 0) {
        return Math.max(QAAP_PR_WATCH_MIN_INTERVAL_MS, configured);
    }
    return QAAP_PR_WATCH_DEFAULT_INTERVAL_MS;
}

/** Extracts the `@@QAAP:WATCH_PR@@` target from an agent message (content or trailing text segment). */
export function extractAgentWatchPullRequestRequest(message: QaapAgentMessage | undefined): QaapPullRequestWatchRequest | undefined {
    if (!message || message.role !== 'agent') {
        return undefined;
    }
    if (message.content?.trim()) {
        const fromContent = parseAgentWatchPullRequestSignal(message.content);
        if (fromContent) {
            return fromContent;
        }
    }
    const segments = message.segments ?? [];
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i];
        if (segment.type === 'text' && segment.content?.trim()) {
            const fromSegment = parseAgentWatchPullRequestSignal(segment.content);
            if (fromSegment) {
                return fromSegment;
            }
        }
    }
    return undefined;
}

/**
 * Polls GitHub pull requests watched by conversations and wakes the conversation's agent when
 * checks finish or a review/comment arrives. State is persisted on `conv.pullRequestWatch` so
 * watches survive backend restarts.
 */
@injectable()
export class QaapPullRequestWatchService implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapTaskPullRequestService) @optional()
    protected readonly taskPullRequests: QaapTaskPullRequestService | undefined;

    @inject(QaapHostedProjectResolver) @optional()
    protected readonly projectResolver: QaapHostedProjectResolver | undefined;

    protected github: QaapPullRequestWatchGithub = DEFAULT_GITHUB;
    protected sweepTimer: ReturnType<typeof setInterval> | undefined;
    /** Conversations currently being polled — prevents overlapping sweeps on the same thread. */
    protected readonly inFlight = new Set<string>();
    /** Agent message ids already inspected for `@@QAAP:WATCH_PR@@` in this process. */
    protected readonly processedMarkerMessages = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.store.onDidChange(event => this.onConversationEvent(event));
    }

    onStart(): void {
        this.store.whenReady().then(() => {
            this.sweepTimer = setInterval(() => {
                void this.sweep();
            }, this.intervalMs());
            this.sweepTimer.unref?.();
        }).catch(error => {
            console.warn('[qaap-pr-watch] startup failed:', error);
        });
    }

    onStop(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = undefined;
        }
    }

    protected intervalMs(): number {
        return resolvePullRequestWatchIntervalMs();
    }

    protected now(): number {
        return Date.now();
    }

    protected onConversationEvent(event: QaapAgentConversationEvent): void {
        if (event.type !== 'updated' && event.type !== 'message') {
            return;
        }
        const conversationId = event.type === 'updated' ? event.conversation.id : event.conversationId;
        const conv = this.store.get(conversationId);
        if (!conv || conv.status === 'streaming') {
            return;
        }
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!lastAgent || lastAgent.runActive || this.processedMarkerMessages.has(lastAgent.id)) {
            return;
        }
        if (conv.pullRequestWatch?.sourceMessageId === lastAgent.id) {
            this.processedMarkerMessages.add(lastAgent.id);
            return;
        }
        const request = extractAgentWatchPullRequestRequest(lastAgent);
        if (!request) {
            return;
        }
        this.processedMarkerMessages.add(lastAgent.id);
        void this.startWatch(conversationId, {
            number: request.number,
            owner: request.owner,
            repo: request.repo,
            startedBy: 'agent',
            sourceMessageId: lastAgent.id,
        }).catch(error => {
            console.warn(`[qaap-pr-watch] failed to start watch from agent marker on ${conversationId}:`, error);
        });
    }

    /** Starts watching a pull request on `conversationId`. Throws {@link QaapPullRequestWatchError} on invalid input. */
    async startWatch(
        conversationId: string,
        options: QaapStartPullRequestWatchBody & { readonly startedBy?: 'agent' | 'user'; readonly sourceMessageId?: string } = {},
    ): Promise<QaapAgentConversation> {
        const conv = this.store.get(conversationId);
        if (!conv) {
            throw new QaapPullRequestWatchError(404, 'Conversation not found.');
        }
        const target = await this.resolveTarget(conv, options);
        const now = this.now();
        const watch: QaapPullRequestWatch = {
            owner: target.owner,
            repo: target.repo,
            number: target.number,
            url: pullRequestWatchUrl(target),
            startedAt: now,
            startedBy: options.startedBy ?? 'user',
            state: 'watching',
            lastSeen: { reviewIds: [], commentIds: [] },
            ...(options.sourceMessageId ? { sourceMessageId: options.sourceMessageId } : {}),
        };
        const updated = this.store.recordPullRequestWatch(conversationId, watch);
        if (!updated) {
            throw new QaapPullRequestWatchError(404, 'Conversation not found.');
        }
        // In production (poller running), capture the baseline right away instead of waiting a full minute.
        if (this.sweepTimer) {
            void this.pollConversation(conversationId);
        }
        return updated;
    }

    /** Stops watching the pull request on `conversationId`, clearing any pending events. */
    stopWatch(
        conversationId: string,
        reason: NonNullable<QaapPullRequestWatch['stopReason']> = 'user',
        notice?: string,
    ): QaapAgentConversation | undefined {
        const conv = this.store.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const current = conv.pullRequestWatch;
        if (!current) {
            return conv;
        }
        const stopped: QaapPullRequestWatch = {
            ...current,
            state: 'stopped',
            stopReason: reason,
            pendingEvents: undefined,
            ...(reason === 'user' ? { lastError: undefined } : {}),
        };
        return this.store.recordPullRequestWatch(
            conversationId,
            stopped,
            notice ? { traceNote: notice, traceNotice: true } : undefined,
        );
    }

    /** Polls every conversation currently watching a pull request. Never wakes more than once per conversation per sweep. */
    async sweep(now: number = this.now()): Promise<void> {
        const watchingIds: string[] = [];
        for (const conv of this.store.conversations.values()) {
            if (!conv.archived && conv.pullRequestWatch?.state === 'watching') {
                watchingIds.push(conv.id);
            }
        }
        for (const id of watchingIds) {
            await this.pollConversation(id, now);
        }
    }

    /** Polls one watched conversation. Serialized per conversation via {@link inFlight}. */
    async pollConversation(conversationId: string, now: number = this.now()): Promise<void> {
        if (this.inFlight.has(conversationId)) {
            return;
        }
        const conv = this.store.get(conversationId);
        const watch = conv?.pullRequestWatch;
        if (!conv || conv.archived || !watch || watch.state !== 'watching') {
            return;
        }
        this.inFlight.add(conversationId);
        try {
            const token = this.resolveToken(conv);
            if (!token) {
                this.recordPollFailure(conversationId, watch, 'no GitHub token');
                return;
            }
            const pull = await this.github.getPull(token, watch.owner, watch.repo, watch.number);
            const prState: QaapPullRequestWatchSnapshot['prState'] = pull.merged ? 'merged' : pull.state;
            const url = pull.url || watch.url || pullRequestWatchUrl(watch);

            if (prState !== 'open') {
                const terminalDiff = diffPullRequestWatch(watch, {
                    prState,
                    headSha: pull.headSha,
                    checks: [],
                    reviews: [],
                    comments: [],
                });
                const notice = prState === 'merged'
                    ? nls.localize('qaap/prWatch/noticeMerged', 'Pull request #{0} was merged — stopped watching.', String(watch.number))
                    : nls.localize('qaap/prWatch/noticeClosed', 'Pull request #{0} was closed — stopped watching.', String(watch.number));
                const stopped: QaapPullRequestWatch = {
                    ...watch,
                    url,
                    state: 'stopped',
                    stopReason: prState,
                    lastSeen: terminalDiff.lastSeen,
                    pendingEvents: undefined,
                    lastPolledAt: now,
                    lastError: undefined,
                    consecutiveFailures: 0,
                };
                this.store.recordPullRequestWatch(conversationId, stopped, { traceNote: notice, traceNotice: true });
                return;
            }

            const [checks, reviews, comments] = await Promise.all([
                pull.headSha ? this.github.getChecks(token, watch.owner, watch.repo, pull.headSha) : Promise.resolve([]),
                this.github.getReviews(token, watch.owner, watch.repo, watch.number),
                this.github.getComments(token, watch.owner, watch.repo, watch.number),
            ]);
            const diff = diffPullRequestWatch(
                watch,
                { prState: 'open', headSha: pull.headSha, checks, reviews, comments },
                { ignoreAuthor: conv.ownerLogin },
            );

            // Re-read after async GitHub calls in case the user stopped the watch mid-poll.
            const fresh = this.store.get(conversationId);
            if (!fresh || fresh.pullRequestWatch?.state !== 'watching') {
                return;
            }
            const currentWatch = fresh.pullRequestWatch;
            const allEvents = mergePullRequestWatchPendingEvents(currentWatch.pendingEvents, diff.events);
            const baseNext: QaapPullRequestWatch = {
                ...currentWatch,
                url,
                lastSeen: diff.lastSeen,
                lastPolledAt: now,
                lastError: undefined,
                consecutiveFailures: 0,
            };

            if (allEvents.length === 0) {
                this.store.recordPullRequestWatch(conversationId, { ...baseNext, pendingEvents: undefined });
                return;
            }

            if (!this.isQuiescent(fresh)) {
                this.store.recordPullRequestWatch(conversationId, { ...baseNext, pendingEvents: allEvents });
                return;
            }

            const recentWakes = (currentWatch.recentWakes ?? []).filter(at => now - at < QAAP_PR_WATCH_WAKE_WINDOW_MS);
            if (recentWakes.length >= QAAP_PR_WATCH_MAX_WAKES_PER_HOUR) {
                this.store.recordPullRequestWatch(conversationId, {
                    ...baseNext,
                    pendingEvents: allEvents,
                    recentWakes,
                    lastError: 'wake budget',
                });
                return;
            }

            // Persist the cleared pending queue and wake timestamp before posting so a synchronous
            // store event or restart cannot double-wake for the same events.
            this.store.recordPullRequestWatch(conversationId, {
                ...baseNext,
                pendingEvents: undefined,
                recentWakes: [...recentWakes, now],
            });
            const wakeMessage = buildPullRequestWatchWakeMessage(currentWatch.number, allEvents);
            const lastUser = [...fresh.messages].reverse().find(message => message.role === 'user');
            try {
                this.store.postUserMessage(
                    conversationId,
                    wakeMessage,
                    lastUser?.turnAgentId,
                    lastUser?.turnAgentModel,
                    fresh.autoApprove,
                    fresh.interactionModeId,
                    fresh.approvalPolicyId,
                    fresh.toolApprovalRules,
                );
            } catch (error) {
                console.warn(`[qaap-pr-watch] failed to wake conversation ${conversationId}:`, error);
            }
        } catch (error) {
            if (error instanceof GithubApiError && error.rateLimited) {
                // Respect GitHub rate limits: skip this sweep without counting against failure limit.
                return;
            }
            const latest = this.store.get(conversationId)?.pullRequestWatch;
            if (!latest || latest.state !== 'watching') {
                return;
            }
            if (error instanceof GithubApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
                this.recordPollFailure(conversationId, latest, error.message);
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.store.recordPullRequestWatch(conversationId, { ...latest, lastError: message });
        } finally {
            this.inFlight.delete(conversationId);
        }
    }

    protected recordPollFailure(conversationId: string, watch: QaapPullRequestWatch, reason: string): void {
        const failures = (watch.consecutiveFailures ?? 0) + 1;
        if (failures >= QAAP_PR_WATCH_MAX_CONSECUTIVE_FAILURES) {
            const notice = nls.localize(
                'qaap/prWatch/noticeError',
                'Stopped watching pull request #{0}: {1}',
                String(watch.number),
                reason,
            );
            this.store.recordPullRequestWatch(conversationId, {
                ...watch,
                state: 'stopped',
                stopReason: 'error',
                pendingEvents: undefined,
                lastError: reason,
                consecutiveFailures: failures,
            }, { traceNote: notice, traceNotice: true });
            return;
        }
        this.store.recordPullRequestWatch(conversationId, {
            ...watch,
            lastError: reason,
            consecutiveFailures: failures,
        });
    }

    protected isQuiescent(conv: QaapAgentConversation): boolean {
        if (this.taskPullRequests) {
            return this.taskPullRequests.isQuiescent(conv);
        }
        if (conv.status !== 'idle' || (conv.pendingUserMessages?.length ?? 0) > 0 || isGoalLoopActive(conv)) {
            return false;
        }
        if (conv.interactionModeId === 'plan' || conv.interactionModeId === 'ask') {
            return false;
        }
        return this.store.getActiveTaskIdsForConversation(conv.id).length === 0;
    }

    protected resolveToken(conv: QaapAgentConversation): string | undefined {
        return this.taskPullRequests?.resolveOwnerToken(conv.ownerLogin);
    }

    protected async resolveTarget(
        conv: QaapAgentConversation,
        input: QaapStartPullRequestWatchBody,
    ): Promise<{ readonly owner: string; readonly repo: string; readonly number: number }> {
        let owner = input.owner?.trim() || undefined;
        let repo = input.repo?.trim() || undefined;
        let number = typeof input.number === 'number' && Number.isInteger(input.number) && input.number > 0
            ? input.number
            : undefined;

        if (input.url?.trim()) {
            const parsed = parsePullRequestWatchTarget(input.url);
            if (!parsed || !parsed.owner || !parsed.repo) {
                throw new QaapPullRequestWatchError(400, 'Invalid GitHub pull request URL.');
            }
            owner = parsed.owner;
            repo = parsed.repo;
            number = parsed.number;
        }

        if (!number) {
            number = conv.linkedPullRequest?.number ?? conv.taskPullRequest?.number;
        }
        if (!number) {
            throw new QaapPullRequestWatchError(400, 'A pull request number is required when the conversation has no linked pull request.');
        }

        if (!owner || !repo) {
            if (conv.linkedPullRequest?.owner && conv.linkedPullRequest?.repo) {
                owner = conv.linkedPullRequest.owner;
                repo = conv.linkedPullRequest.repo;
            } else if (conv.taskPullRequest?.owner && conv.taskPullRequest?.repo) {
                owner = conv.taskPullRequest.owner;
                repo = conv.taskPullRequest.repo;
            } else {
                const resolved = await this.resolveRepository(conv);
                owner = resolved?.owner;
                repo = resolved?.repo;
            }
        }
        if (!owner || !repo) {
            throw new QaapPullRequestWatchError(400, 'Could not determine the GitHub repository for this conversation.');
        }
        return { owner, repo, number };
    }

    protected async resolveRepository(conv: QaapAgentConversation): Promise<{ readonly owner: string; readonly repo: string } | undefined> {
        if (this.taskPullRequests) {
            return this.taskPullRequests.resolveRepository(conv);
        }
        if (!this.projectResolver) {
            return undefined;
        }
        return this.projectResolver.resolve(conv.ownerLogin, conv.cwd, async (cwd, args) => {
            const result = await this.store.mutatingGit(cwd, args);
            if (result.status !== 0) {
                throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
            }
            return result.stdout;
        });
    }
}

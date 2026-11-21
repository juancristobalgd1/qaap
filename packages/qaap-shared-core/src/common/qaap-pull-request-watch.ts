// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/*
 * "Watch pull request": a conversation follows a GitHub pull request and its agent is woken when the
 * checks finish or a review or comment arrives (backend: `QaapPullRequestWatchService`). This module is
 * the DOM-free and IO-free part: the persisted state, the agent's control marker and the diff of two
 * polls into agent-facing events.
 */

/** Aggregate of the head commit's checks. */
export type QaapPullRequestWatchChecksState = 'pending' | 'passed' | 'failed' | 'none';

/** What the last poll saw; the next poll diffs against it. */
export interface QaapPullRequestWatchLastSeen {
    readonly headSha?: string;
    readonly checks?: QaapPullRequestWatchChecksState;
    /** Newest review ids already reported (capped at {@link QAAP_PR_WATCH_MAX_REVIEW_IDS}). */
    readonly reviewIds: readonly number[];
    /** Newest issue and review comment ids already reported (capped at {@link QAAP_PR_WATCH_MAX_COMMENT_IDS}). */
    readonly commentIds: readonly number[];
    readonly prState?: 'open' | 'closed' | 'merged';
}

/** A pull request a conversation watches; persisted on the conversation so it survives restarts. */
export interface QaapPullRequestWatch {
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
    readonly url?: string;
    readonly startedAt: number;
    readonly startedBy: 'agent' | 'user';
    readonly state: 'watching' | 'stopped';
    readonly stopReason?: 'merged' | 'closed' | 'user' | 'error';
    readonly lastSeen: QaapPullRequestWatchLastSeen;
    /** Events detected while the agent was busy (or out of wake budget), delivered on the next quiet sweep. */
    readonly pendingEvents?: readonly string[];
    /** Unset until the first poll, which only records the baseline. */
    readonly lastPolledAt?: number;
    readonly lastError?: string;
    /** Consecutive failed polls (auth / not found); the watch stops at three. */
    readonly consecutiveFailures?: number;
    /** Wake times of the last hour (rate limit). */
    readonly recentWakes?: readonly number[];
    /** The agent message whose marker started this watch (a restart never replays it). */
    readonly sourceMessageId?: string;
}

/** The part of a watch the conversation summary carries to the UI. */
export interface QaapPullRequestWatchSummary {
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
    readonly url?: string;
    readonly state: 'watching' | 'stopped';
    readonly startedBy: 'agent' | 'user';
    readonly stopReason?: QaapPullRequestWatch['stopReason'];
}

export function summarizePullRequestWatch(watch: QaapPullRequestWatch | undefined): QaapPullRequestWatchSummary | undefined {
    if (!watch) {
        return undefined;
    }
    return {
        owner: watch.owner,
        repo: watch.repo,
        number: watch.number,
        ...(watch.url ? { url: watch.url } : {}),
        state: watch.state,
        startedBy: watch.startedBy,
        ...(watch.stopReason ? { stopReason: watch.stopReason } : {}),
    };
}

/** The GitHub page of a watched pull request. */
export function pullRequestWatchUrl(watch: Pick<QaapPullRequestWatch, 'owner' | 'repo' | 'number' | 'url'>): string {
    return watch.url?.trim() || `https://github.com/${watch.owner}/${watch.repo}/pull/${watch.number}`;
}

export const QAAP_PR_WATCH_MAX_REVIEW_IDS = 50;
export const QAAP_PR_WATCH_MAX_COMMENT_IDS = 100;
/** Pending events kept while the agent is busy; the oldest are dropped first. */
export const QAAP_PR_WATCH_MAX_PENDING_EVENTS = 20;
const MAX_FAILED_CHECKS_LISTED = 5;
const EXCERPT_CHARS = 300;

/**
 * Control marker an agent puts on its own line in its final message to have Qaap watch a pull request:
 * `@@QAAP:WATCH_PR@@ 42` (the conversation's repository) or `@@QAAP:WATCH_PR@@ https://github.com/o/r/pull/42`.
 */
export const QAAP_AGENT_WATCH_PR_MARKER = '@@QAAP:WATCH_PR@@';

/** Request body for `POST /qaap/api/agent-conversations/:id/pull-request-watch`. */
export interface QaapStartPullRequestWatchBody {
    readonly number?: number;
    readonly owner?: string;
    readonly repo?: string;
    readonly url?: string;
}

/** What the marker asks for. Without `owner`/`repo` the number refers to the conversation's repository. */
export interface QaapPullRequestWatchRequest {
    readonly number: number;
    readonly owner?: string;
    readonly repo?: string;
}

const PR_URL = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?:[/?#].*)?$/i;
const PR_NUMBER = /^#?(\d{1,9})$/;

/** Parses the argument of the marker: a number (`42`, `#42`) or a GitHub pull request URL. */
export function parsePullRequestWatchTarget(value: string | undefined): QaapPullRequestWatchRequest | undefined {
    const text = value?.trim().replace(/^[<`]+|[>`.,;]+$/g, '') ?? '';
    if (!text) {
        return undefined;
    }
    const url = PR_URL.exec(text);
    if (url) {
        const number = Number.parseInt(url[3], 10);
        return number > 0 ? { owner: url[1], repo: url[2].replace(/\.git$/i, ''), number } : undefined;
    }
    const plain = PR_NUMBER.exec(text);
    if (plain) {
        const number = Number.parseInt(plain[1], 10);
        return number > 0 ? { number } : undefined;
    }
    return undefined;
}

/**
 * Finds the watch marker in an agent's final text: a line that starts with the marker, outside fenced
 * code blocks (an agent explaining the marker in a code sample does not trigger it). The last valid
 * marker line wins.
 */
export function parseAgentWatchPullRequestSignal(finalVisibleText: string | undefined): QaapPullRequestWatchRequest | undefined {
    if (!finalVisibleText || !finalVisibleText.includes(QAAP_AGENT_WATCH_PR_MARKER)) {
        return undefined;
    }
    let inFence = false;
    let found: QaapPullRequestWatchRequest | undefined;
    for (const raw of finalVisibleText.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('```') || line.startsWith('~~~')) {
            inFence = !inFence;
            continue;
        }
        if (inFence || !line.startsWith(QAAP_AGENT_WATCH_PR_MARKER)) {
            continue;
        }
        const parsed = parsePullRequestWatchTarget(line.slice(QAAP_AGENT_WATCH_PR_MARKER.length));
        if (parsed) {
            found = parsed;
        }
    }
    return found;
}

/** One check of the head commit as the poll saw it. */
export interface QaapPullRequestWatchCheck {
    readonly name: string;
    readonly status: 'queued' | 'in_progress' | 'completed';
    readonly conclusion?: string;
    readonly url?: string;
}

export interface QaapPullRequestWatchReview {
    readonly id: number;
    readonly author: string;
    /** GitHub review state (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, …), any case. */
    readonly state: string;
    readonly body?: string;
}

export interface QaapPullRequestWatchComment {
    readonly id: number;
    readonly author: string;
    readonly body?: string;
    /** Review (inline) comments: the file and line they are on. */
    readonly path?: string;
    readonly line?: number;
}

/** One poll of the pull request. */
export interface QaapPullRequestWatchSnapshot {
    readonly prState: 'open' | 'closed' | 'merged';
    readonly headSha?: string;
    readonly checks: readonly QaapPullRequestWatchCheck[];
    readonly reviews: readonly QaapPullRequestWatchReview[];
    readonly comments: readonly QaapPullRequestWatchComment[];
}

export interface QaapPullRequestWatchDiffOptions {
    /** Reviews and comments by this login are not reported (the token's own user: usually the agent itself). */
    readonly ignoreAuthor?: string;
}

export interface QaapPullRequestWatchDiff {
    readonly lastSeen: QaapPullRequestWatchLastSeen;
    /** Agent-facing lines, one per meaningful change. */
    readonly events: readonly string[];
    /** Set when the pull request was merged or closed: the watch ends. */
    readonly terminal?: 'merged' | 'closed';
}

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

/** `none` without checks, `pending` while any runs, `failed` when any finished red, else `passed`. */
export function summarizePullRequestWatchChecks(checks: readonly QaapPullRequestWatchCheck[]): QaapPullRequestWatchChecksState {
    if (checks.length === 0) {
        return 'none';
    }
    if (checks.some(check => check.status !== 'completed')) {
        return 'pending';
    }
    return checks.some(check => isFailedCheck(check)) ? 'failed' : 'passed';
}

function isFailedCheck(check: QaapPullRequestWatchCheck): boolean {
    return check.status === 'completed' && FAILED_CONCLUSIONS.has((check.conclusion ?? '').toLowerCase());
}

function excerpt(text: string | undefined): string {
    const flat = (text ?? '').replace(/\s+/g, ' ').trim();
    return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
}

/**
 * New ids are those not seen yet; once the capped list is full, only ids above its smallest one count
 * (GitHub ids grow over time), so an old item that fell off the cap is never reported twice.
 */
function isNewId(id: number, seen: readonly number[], cap: number): boolean {
    if (seen.includes(id)) {
        return false;
    }
    return seen.length < cap || id > Math.min(...seen);
}

function rememberIds(seen: readonly number[], ids: readonly number[], cap: number): number[] {
    const merged = [...new Set([...seen, ...ids])].sort((a, b) => a - b);
    return merged.slice(Math.max(0, merged.length - cap));
}

function sameLogin(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Diffs a poll against what the watch saw last. The first poll (`watch.lastPolledAt` unset) records the
 * baseline: reviews and comments that already exist are not reported, but checks that already finished red
 * are, so watching a pull request whose CI just failed wakes the agent at once.
 */
export function diffPullRequestWatch(
    watch: Pick<QaapPullRequestWatch, 'lastSeen' | 'lastPolledAt'>,
    snapshot: QaapPullRequestWatchSnapshot,
    options: QaapPullRequestWatchDiffOptions = {},
): QaapPullRequestWatchDiff {
    const baseline = watch.lastPolledAt === undefined;
    const previous = watch.lastSeen;
    const checks = summarizePullRequestWatchChecks(snapshot.checks);
    const reviewIds = rememberIds(previous.reviewIds, snapshot.reviews.map(review => review.id), QAAP_PR_WATCH_MAX_REVIEW_IDS);
    const commentIds = rememberIds(previous.commentIds, snapshot.comments.map(comment => comment.id), QAAP_PR_WATCH_MAX_COMMENT_IDS);
    const lastSeen: QaapPullRequestWatchLastSeen = {
        ...(snapshot.headSha ? { headSha: snapshot.headSha } : {}),
        checks,
        reviewIds,
        commentIds,
        prState: snapshot.prState,
    };
    if (snapshot.prState !== 'open') {
        return { lastSeen, events: [], terminal: snapshot.prState };
    }
    const events: string[] = [];
    const checksChanged = previous.checks !== checks || previous.headSha !== snapshot.headSha;
    if (checks === 'failed' && (baseline || checksChanged)) {
        const failed = snapshot.checks.filter(isFailedCheck);
        const listed = failed.slice(0, MAX_FAILED_CHECKS_LISTED)
            .map(check => check.url ? `${check.name} (${check.url})` : check.name);
        const more = failed.length > listed.length ? `, and ${failed.length - listed.length} more` : '';
        events.push(`checks failed: ${listed.join(', ')}${more}`);
    } else if (checks === 'passed' && !baseline && checksChanged) {
        events.push('all checks passed');
    }
    if (!baseline) {
        for (const review of [...snapshot.reviews].sort((a, b) => a.id - b.id)) {
            const state = review.state.toLowerCase();
            const body = excerpt(review.body);
            // A comment-only review with no body is the wrapper of inline comments, reported one by one below.
            if (!isNewId(review.id, previous.reviewIds, QAAP_PR_WATCH_MAX_REVIEW_IDS) || state === 'pending'
                || sameLogin(review.author, options.ignoreAuthor) || (state === 'commented' && !body)) {
                continue;
            }
            events.push(`new review by ${review.author || 'someone'}: ${state.replace(/_/g, ' ')}${body ? ` ${body}` : ''}`);
        }
        for (const comment of [...snapshot.comments].sort((a, b) => a.id - b.id)) {
            if (!isNewId(comment.id, previous.commentIds, QAAP_PR_WATCH_MAX_COMMENT_IDS) || sameLogin(comment.author, options.ignoreAuthor)) {
                continue;
            }
            const where = comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ''}` : '';
            events.push(`new comment by ${comment.author || 'someone'}${where}: ${excerpt(comment.body)}`);
        }
    }
    return { lastSeen, events };
}

/** The message that wakes the agent with what changed. */
export function buildPullRequestWatchWakeMessage(number: number, events: readonly string[]): string {
    return [
        `[Qaap · watching pull request #${number}]`,
        ...events.map(event => `- ${event}`),
        '',
        'Look into each item and act on it: fix what failed, answer the review, push to the same branch. '
        + 'Qaap keeps watching this pull request until it is merged or closed.',
    ].join('\n');
}

/** Appends events to the pending queue, dropping exact duplicates and the oldest beyond the cap. */
export function mergePullRequestWatchPendingEvents(pending: readonly string[] | undefined, events: readonly string[]): string[] {
    const merged = [...(pending ?? [])];
    for (const event of events) {
        if (!merged.includes(event)) {
            merged.push(event);
        }
    }
    return merged.slice(Math.max(0, merged.length - QAAP_PR_WATCH_MAX_PENDING_EVENTS));
}

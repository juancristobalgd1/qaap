// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * A 401 (the GitHub session is missing or expired) is not retried for this long: only a new sign-in can fix it, and
 * every project refresh asked again before this backoff existed.
 */
export const GITHUB_PULL_REQUESTS_SIGN_IN_BACKOFF_MS = 60_000;
/** The first wait after a 5xx; each further 5xx in a row doubles it. */
// Each request already goes through the transient-GET retries (several attempts per call), so the pause starts long.
export const GITHUB_PULL_REQUESTS_SERVER_BACKOFF_START_MS = 30_000;
/** The longest wait after repeated 5xx answers. */
export const GITHUB_PULL_REQUESTS_SERVER_BACKOFF_MAX_MS = 60_000;

/** Machine code describing why GitHub auth backoff was entered. */
export type GithubSignInBackoffCode = 'github_sign_in_required' | 'session_expired';

/** Why the pull-request request is paused, and the time (epoch ms) it may be sent again. */
export interface GithubPullRequestsBackoff {
    readonly reason: 'sign-in' | 'server';
    readonly retryAt: number;
    readonly code?: GithubSignInBackoffCode;
}

const SIGN_IN_BACKOFF_STORAGE_KEY = 'qaap.github.authBackoff.v1';

/** The shared state of one browser session; a successful request clears it. */
interface GithubPullRequestsBackoffState {
    signInRetryAt: number;
    signInCode: GithubSignInBackoffCode | undefined;
    serverFailures: number;
    serverRetryAt: number;
    /** Whether the current episode was already logged, so one episode logs once. */
    episodeLogged: boolean;
}

const state: GithubPullRequestsBackoffState = {
    signInRetryAt: 0,
    signInCode: undefined,
    serverFailures: 0,
    serverRetryAt: 0,
    episodeLogged: false,
};

function readPersistedSignInBackoff(now: number): { retryAt: number; code?: GithubSignInBackoffCode } | undefined {
    try {
        if (typeof sessionStorage === 'undefined') {
            return undefined;
        }
        const raw = sessionStorage.getItem(SIGN_IN_BACKOFF_STORAGE_KEY);
        if (!raw) {
            return undefined;
        }
        const parsed = JSON.parse(raw) as { retryAt?: unknown; code?: unknown };
        if (typeof parsed.retryAt !== 'number' || parsed.retryAt <= now || parsed.retryAt - now > GITHUB_PULL_REQUESTS_SIGN_IN_BACKOFF_MS) {
            sessionStorage.removeItem(SIGN_IN_BACKOFF_STORAGE_KEY);
            return undefined;
        }
        const code = parsed.code === 'github_sign_in_required' || parsed.code === 'session_expired'
            ? parsed.code
            : undefined;
        return { retryAt: parsed.retryAt, code };
    } catch {
        return undefined;
    }
}

function writePersistedSignInBackoff(retryAt: number, code: GithubSignInBackoffCode | undefined): void {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(SIGN_IN_BACKOFF_STORAGE_KEY, JSON.stringify({ retryAt, code }));
        }
    } catch {
        // Private browsing or non-browser test environments ignore sessionStorage writes.
    }
}

function clearPersistedSignInBackoff(): void {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(SIGN_IN_BACKOFF_STORAGE_KEY);
        }
    } catch {
        // Ignore storage restrictions.
    }
}

/**
 * The pause in force at `now`, or `undefined` when a pull-request request may be sent. A sign-in pause wins over a
 * server pause: while the session is gone, a 5xx answer is not the news.
 */
export function activeGithubPullRequestsBackoff(now: number = Date.now()): GithubPullRequestsBackoff | undefined {
    if (now < state.signInRetryAt) {
        return { reason: 'sign-in', retryAt: state.signInRetryAt, code: state.signInCode };
    }
    const persisted = state.signInRetryAt === 0 ? readPersistedSignInBackoff(now) : undefined;
    if (persisted) {
        state.signInRetryAt = persisted.retryAt;
        state.signInCode = persisted.code;
        return { reason: 'sign-in', retryAt: persisted.retryAt, code: persisted.code };
    }
    if (now < state.serverRetryAt) {
        return { reason: 'server', retryAt: state.serverRetryAt };
    }
    return undefined;
}

/** Records a 401 / signedIn:false answer: no GitHub list/PR requests until the sign-in backoff elapses. */
export function recordGithubPullRequestsSignInRequired(now: number = Date.now(), code?: GithubSignInBackoffCode): void {
    state.signInRetryAt = now + GITHUB_PULL_REQUESTS_SIGN_IN_BACKOFF_MS;
    state.signInCode = code ?? state.signInCode;
    writePersistedSignInBackoff(state.signInRetryAt, state.signInCode);
    logEpisodeOnce('[qaap] GitHub pull requests need a GitHub sign-in; not retrying until the session changes or a minute passes.');
}

/**
 * Records a 5xx answer: the next request waits 30 s, then doubles up to one minute.
 */
export function recordGithubPullRequestsServerError(now: number = Date.now()): void {
    const wait = Math.min(
        GITHUB_PULL_REQUESTS_SERVER_BACKOFF_START_MS * 2 ** state.serverFailures,
        GITHUB_PULL_REQUESTS_SERVER_BACKOFF_MAX_MS
    );
    state.serverFailures++;
    state.serverRetryAt = now + wait;
    logEpisodeOnce('[qaap] GitHub pull requests are failing on the server; backing off before the next request.');
}

/** A successful answer (or a clean 2xx) ends the episode: the next failure starts a new one. */
export function resetGithubPullRequestsBackoff(): void {
    state.signInRetryAt = 0;
    state.signInCode = undefined;
    state.serverFailures = 0;
    state.serverRetryAt = 0;
    state.episodeLogged = false;
    clearPersistedSignInBackoff();
}

function logEpisodeOnce(message: string): void {
    if (state.episodeLogged) {
        return;
    }
    state.episodeLogged = true;
    console.info(message);
}

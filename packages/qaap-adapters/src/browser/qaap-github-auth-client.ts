// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    QAAP_AUTH_API_PATH,
    QAAP_BILLING_API_PATH,
    QAAP_BILLING_CHECKOUT_API_PATH,
    QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH,
    QAAP_BILLING_DEV_ACTIVATE_API_PATH,
    QAAP_GITHUB_API_PATH,
    QAAP_GITHUB_OAUTH_START_PATH,
    QAAP_USER_SETTINGS_API_PATH,
    type QaapAuthConfigResponse,
    type QaapAuthSessionResponse,
    type QaapGithubCreateRepositoryRequest,
    type QaapGithubMergePullRequestRequest,
    type QaapGithubMergePullRequestResponse,
    type QaapGithubOpenRepositoryResponse,
    type QaapGithubOpenRepositoryRequest,
    type QaapGithubPullRequestsResponse,
    type QaapGithubRepositoriesResponse,
    type QaapProjectSessionsResponse,
    type QaapProjectSessionUpsertRequest,
    type QaapProjectSessionSummary,
} from '../common/qaap-github-api-types';
import { rememberQaapHostedRuntime } from '../common/qaap-hosted-runtime';
import { nls } from '@theia/core/lib/common/nls';
import {
    clearQaapAuthSession,
    readQaapSignedIn,
    writeQaapAuthSession,
    type QaapAuthProvider,
} from './qaap-auth-session';

/**
 * Open / clone / create prepare a repository workspace on the server: they may first cold-start the
 * tenant backend and then run GitHub API calls (30 s each) plus git fetch/clone (120 s). The tenant
 * proxy answers with a 504 once ensure + response wait exceed `QAAP_TENANT_PROXY_IDLE_TIMEOUT_MS`
 * (180 s by default), so this client budget stays above the server's worst case: the user sees the
 * server's error instead of racing it with a client abort.
 */
const QAAP_GITHUB_WORKSPACE_TIMEOUT_MS = 210_000;
const QAAP_GITHUB_LIST_TIMEOUT_MS = 30_000;
/** Pull request listing fans out over several repositories and merging waits for GitHub. */
const QAAP_GITHUB_PULL_REQUESTS_TIMEOUT_MS = 60_000;
/** Removing a clone deletes a whole working tree on the server. */
const QAAP_GITHUB_DELETE_TIMEOUT_MS = 60_000;
/** Small JSON reads/writes against the Qaap backend (project sessions, settings, billing). */
const QAAP_API_REQUEST_TIMEOUT_MS = 15_000;
/** Checkout creation round-trips to Stripe. */
const QAAP_BILLING_CHECKOUT_TIMEOUT_MS = 30_000;
const QAAP_AUTH_REQUEST_TIMEOUT_MS = 6000;

/** Statuses whose `Response` must be constructed without a body. */
const QAAP_NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * One deadline covers the headers AND the body: the body is buffered before the timer is cleared,
 * so callers' `response.json()` cannot hang on a connection that stalls mid-body.
 */
async function fetchQaapWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const body = QAAP_NULL_BODY_STATUSES.has(response.status) ? undefined : await response.arrayBuffer();
        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    } finally {
        clearTimeout(timeout);
    }
}

function isQaapAbortError(err: unknown): boolean {
    // Body-read aborts surface as a DOMException, which is not always `instanceof Error`.
    return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/** {@link fetchQaapWithTimeout}, mapping an abort to a user-facing timeout error. */
async function fetchQaapOrTimeoutError(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
    timeoutMessage: () => string,
): Promise<Response> {
    try {
        return await fetchQaapWithTimeout(input, init, timeoutMs);
    } catch (err) {
        if (isQaapAbortError(err)) {
            throw new Error(timeoutMessage());
        }
        throw err;
    }
}

const projectSessionsTimedOut = (): string => nls.localize(
    'qaap/projectSessions/timedOut',
    'Loading project sessions took too long. Please try again.'
);
const userSettingsTimedOut = (): string => nls.localize(
    'qaap/userSettings/timedOut',
    'The settings request took too long. Please try again.'
);
const billingTimedOut = (): string => nls.localize(
    'qaap/billing/timedOut',
    'The billing request took too long. Please try again.'
);

/**
 * Send the HttpOnly session cookie — the ONLY session credential. The id itself is
 * never available to JavaScript, so an XSS cannot exfiltrate the session.
 */
export function qaapAuthenticatedFetchInit(extra?: RequestInit): RequestInit {
    return {
        credentials: 'include',
        ...extra,
    };
}

export const QAAP_REQUIRE_LOGIN_EVENT = 'qaap-require-login';

export async function fetchQaapAuthConfig(): Promise<QaapAuthConfigResponse> {
    const response = await fetchQaapWithTimeout(
        `${QAAP_AUTH_API_PATH}/config`,
        qaapAuthenticatedFetchInit(),
        QAAP_AUTH_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
        return { githubOAuth: false };
    }
    const config = await response.json() as QaapAuthConfigResponse;
    if (typeof config.productionRuntime === 'boolean') {
        rememberQaapHostedRuntime(config.productionRuntime);
    }
    return config;
}

export async function fetchQaapAuthSession(): Promise<QaapAuthSessionResponse> {
    const response = await fetchQaapWithTimeout(
        `${QAAP_AUTH_API_PATH}/session`,
        qaapAuthenticatedFetchInit(),
        QAAP_AUTH_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
        return { signedIn: false };
    }
    return response.json() as Promise<QaapAuthSessionResponse>;
}

export async function fetchQaapProjectSessions(): Promise<QaapProjectSessionsResponse> {
    const response = await fetchQaapOrTimeoutError(
        `${QAAP_GITHUB_API_PATH}/project-sessions`,
        qaapAuthenticatedFetchInit(),
        QAAP_API_REQUEST_TIMEOUT_MS,
        projectSessionsTimedOut,
    );
    if (response.status === 401) {
        // Cookie session gone on the server — reconcile the local signed-in flag so the
        // login gate returns instead of a signed-in-but-broken UI.
        if (readQaapSignedIn()) {
            await syncQaapAuthSessionFromServer();
        }
        return { sessions: [] };
    }
    if (!response.ok) {
        return { sessions: [] };
    }
    const body = await response.json() as Partial<QaapProjectSessionsResponse>;
    return { sessions: Array.isArray(body.sessions) ? body.sessions : [] };
}

export async function upsertQaapProjectSession(patch: QaapProjectSessionUpsertRequest): Promise<QaapProjectSessionSummary | undefined> {
    const response = await fetchQaapOrTimeoutError(`${QAAP_GITHUB_API_PATH}/project-sessions`, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    }), QAAP_API_REQUEST_TIMEOUT_MS, projectSessionsTimedOut);
    if (!response.ok) {
        return undefined;
    }
    const body = await response.json() as { session?: QaapProjectSessionSummary };
    return body.session;
}

export async function fetchQaapGithubRepositories(): Promise<QaapGithubRepositoriesResponse> {
    const response = await fetchQaapOrTimeoutError(
        `${QAAP_GITHUB_API_PATH}/repositories`,
        qaapAuthenticatedFetchInit(),
        QAAP_GITHUB_LIST_TIMEOUT_MS,
        () => nls.localize(
            'qaap/githubRepositories/timedOut',
            'Loading GitHub repositories took too long. Please try again.'
        ),
    );
    if (response.status === 401) {
        // Stored GitHub token expired/revoked — drop the stale session so the login gate returns and
        // the user re-authorizes, instead of staying stuck on a signed-in-but-broken UI. (ONB-5)
        clearQaapAuthSession();
        throw new Error('GitHub session expired — please sign in again.');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Failed to load GitHub repositories (${response.status})`);
    }
    return response.json() as Promise<QaapGithubRepositoriesResponse>;
}

export async function fetchQaapGithubPullRequests(
    repositories?: readonly string[],
): Promise<QaapGithubPullRequestsResponse> {
    const reposQuery = repositories?.length
        ? `?repos=${encodeURIComponent(repositories.join(','))}`
        : '';
    const response = await fetchQaapOrTimeoutError(
        `${QAAP_GITHUB_API_PATH}/pull-requests${reposQuery}`,
        qaapAuthenticatedFetchInit(),
        QAAP_GITHUB_PULL_REQUESTS_TIMEOUT_MS,
        () => nls.localize(
            'qaap/githubPullRequests/timedOut',
            'Loading GitHub pull requests took too long. Please try again.'
        ),
    );
    if (response.status === 401) {
        return { pullRequests: [], signedIn: false };
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Failed to load GitHub pull requests (${response.status})`);
    }
    const body = await response.json() as Partial<QaapGithubPullRequestsResponse>;
    return {
        pullRequests: Array.isArray(body.pullRequests) ? body.pullRequests : [],
        currentRepository: body.currentRepository,
        signedIn: body.signedIn !== false,
    };
}

export async function mergeQaapGithubPullRequest(request: QaapGithubMergePullRequestRequest): Promise<QaapGithubMergePullRequestResponse> {
    // A timeout does not mean the merge failed: GitHub may still complete it.
    const response = await fetchQaapOrTimeoutError(`${QAAP_GITHUB_API_PATH}/pull-requests/merge`, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    }), QAAP_GITHUB_PULL_REQUESTS_TIMEOUT_MS, () => nls.localize(
        'qaap/githubMerge/timedOut',
        'Merging the pull request took too long. Refresh to check whether it was merged.'
    ));
    const body = await response.json().catch(() => ({})) as Partial<QaapGithubMergePullRequestResponse> & { error?: string };
    if (!response.ok) {
        throw new Error(body.error || `Failed to merge pull request (${response.status})`);
    }
    return body as QaapGithubMergePullRequestResponse;
}

export async function openQaapGithubRepository(owner: string, name: string): Promise<QaapGithubOpenRepositoryResponse> {
    const url = `${QAAP_GITHUB_API_PATH}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/open`;
    // POST, not GET: this endpoint clones/pulls to disk, and SameSite=Lax only protects
    // non-GET requests from cross-site initiation.
    const openTimedOut = (): string => nls.localize(
        'qaap/githubOpen/timedOut',
        'Opening the GitHub repository took too long. Please try again.'
    );
    const response = await fetchQaapOrTimeoutError(
        url,
        qaapAuthenticatedFetchInit({ method: 'POST' }),
        QAAP_GITHUB_WORKSPACE_TIMEOUT_MS,
        openTimedOut,
    );
    if (response.status === 504) {
        throw new Error(openTimedOut());
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message || body.error || `Failed to open GitHub repository (${response.status})`);
    }
    return response.json() as Promise<QaapGithubOpenRepositoryResponse>;
}

/** Delete this user's on-disk clone of `owner/name` from the VPS. Does not delete the GitHub remote. */
export async function deleteQaapGithubRepository(owner: string, name: string): Promise<void> {
    const url = `${QAAP_GITHUB_API_PATH}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const response = await fetchQaapOrTimeoutError(
        url,
        qaapAuthenticatedFetchInit({ method: 'DELETE' }),
        QAAP_GITHUB_DELETE_TIMEOUT_MS,
        () => nls.localize(
            'qaap/githubDelete/timedOut',
            'Removing the repository took too long. Please try again.'
        ),
    );
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Failed to remove repository (${response.status})`);
    }
}

export async function createQaapGithubRepository(request: QaapGithubCreateRepositoryRequest): Promise<QaapGithubOpenRepositoryResponse> {
    // Creating also clones the new repository into the workspace, so it gets the workspace budget.
    const createTimedOut = (): string => nls.localize(
        'qaap/githubCreate/timedOut',
        'Creating the GitHub repository took too long. It may still have been created; refresh and try opening it.'
    );
    const response = await fetchQaapOrTimeoutError(`${QAAP_GITHUB_API_PATH}/repositories`, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    }), QAAP_GITHUB_WORKSPACE_TIMEOUT_MS, createTimedOut);
    if (response.status === 504) {
        throw new Error(createTimedOut());
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message || body.error || `Failed to create GitHub repository (${response.status})`);
    }
    return response.json() as Promise<QaapGithubOpenRepositoryResponse>;
}

export async function cloneQaapGithubRepository(repository: string): Promise<QaapGithubOpenRepositoryResponse> {
    const request: QaapGithubOpenRepositoryRequest = { repository };
    const cloneTimedOut = (): string => nls.localize(
        'qaap/githubClone/timedOut',
        'Cloning the GitHub repository took too long. Check the URL and try again.'
    );
    const response = await fetchQaapOrTimeoutError(
        `${QAAP_GITHUB_API_PATH}/repositories/open`,
        qaapAuthenticatedFetchInit({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        }),
        QAAP_GITHUB_WORKSPACE_TIMEOUT_MS,
        cloneTimedOut,
    );
    if (response.status === 504) {
        throw new Error(cloneTimedOut());
    }
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message || body.error || `Failed to clone GitHub repository (${response.status})`);
    }
    return response.json() as Promise<QaapGithubOpenRepositoryResponse>;
}

export async function fetchQaapUserAiSettings(): Promise<Record<string, unknown>> {
    const response = await fetchQaapOrTimeoutError(
        QAAP_USER_SETTINGS_API_PATH,
        qaapAuthenticatedFetchInit(),
        QAAP_API_REQUEST_TIMEOUT_MS,
        userSettingsTimedOut,
    );
    if (!response.ok) {
        return {};
    }
    const body = await response.json() as { settings?: Record<string, unknown> };
    return body.settings && typeof body.settings === 'object' ? body.settings : {};
}

/** Signed-in billing snapshot (plan, runtime/credits, catalog). */
export interface QaapBillingApiResponse {
    readonly account: {
        readonly login: string;
        readonly planId: string;
        readonly includedRuntimeMinutesRemaining: number;
        readonly purchasedRuntimeMinutes: number;
        readonly includedCreditsRemaining: number;
        readonly purchasedCredits: number;
        readonly periodStart: string;
        readonly updatedAt: string;
    };
    readonly entitlements: {
        readonly planId: string;
        readonly storageGb: number;
        readonly maxActiveRepos: number;
        readonly maxConcurrentAgents: number;
        readonly hostedModels: boolean;
        readonly runtimeFairUse: boolean;
        readonly includedRuntimeHoursPerMonth: number;
        readonly runtimeHoursRemaining: number;
        readonly runtimeUsageRatio: number;
        readonly runtimeWarning: boolean;
        readonly canStartAgent: boolean;
        readonly includedCreditsPerMonth: number;
        readonly creditsRemaining: number;
    };
    readonly catalog: {
        readonly plans: ReadonlyArray<{
            readonly id: string;
            readonly monthlyPriceEur: number;
            readonly storageGb: number;
            readonly maxActiveRepos: number;
            readonly maxConcurrentAgents: number;
            readonly includedRuntimeHoursPerMonth: number;
            readonly runtimeFairUse: boolean;
            readonly hostedModels: boolean;
            readonly includedCreditsPerMonth: number;
        }>;
        readonly runtimePacks: ReadonlyArray<{
            readonly monthlyPriceEur: number;
            readonly qcu: number;
            readonly bonusQcu?: number;
        }>;
        readonly hostedModels: ReadonlyArray<{
            readonly modelId: string;
            readonly label: string;
            readonly role: string;
            readonly creditsPerMillionInput: number;
            readonly creditsPerMillionOutput: number;
        }>;
    };
    readonly checkout?: {
        readonly stripeEnabled: boolean;
        readonly devActivateEnabled: boolean;
        readonly payablePlanIds: ReadonlyArray<string>;
    };
}

export async function fetchQaapBilling(): Promise<QaapBillingApiResponse | undefined> {
    const response = await fetchQaapOrTimeoutError(
        QAAP_BILLING_API_PATH,
        qaapAuthenticatedFetchInit(),
        QAAP_API_REQUEST_TIMEOUT_MS,
        billingTimedOut,
    );
    if (!response.ok) {
        return undefined;
    }
    return response.json() as Promise<QaapBillingApiResponse>;
}

export async function createQaapBillingCheckout(planId: 'pro' | 'team'): Promise<{ url: string }> {
    const response = await fetchQaapOrTimeoutError(QAAP_BILLING_CHECKOUT_API_PATH, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
    }), QAAP_BILLING_CHECKOUT_TIMEOUT_MS, billingTimedOut);
    const body = await response.json().catch(() => ({})) as {
        url?: string;
        error?: string;
        message?: string;
        devActivateEnabled?: boolean;
    };
    if (!response.ok || !body.url) {
        const error = new Error(body.message || body.error || `Checkout failed (${response.status})`) as Error & {
            code?: string;
            devActivateEnabled?: boolean;
        };
        error.code = body.error;
        error.devActivateEnabled = body.devActivateEnabled;
        throw error;
    }
    return { url: body.url };
}

/** Apply a paid Stripe Checkout session to the signed-in account (idempotent with the webhook). */
export async function confirmQaapBillingCheckout(sessionId: string): Promise<QaapBillingApiResponse | undefined> {
    const response = await fetchQaapOrTimeoutError(QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
    }), QAAP_BILLING_CHECKOUT_TIMEOUT_MS, billingTimedOut);
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.message || body.error || `Confirm checkout failed (${response.status})`);
    }
    return response.json() as Promise<QaapBillingApiResponse>;
}

export async function activateQaapBillingPlanDev(
    planId: 'starter' | 'pro' | 'team',
): Promise<QaapBillingApiResponse | undefined> {
    const response = await fetchQaapOrTimeoutError(QAAP_BILLING_DEV_ACTIVATE_API_PATH, qaapAuthenticatedFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
    }), QAAP_API_REQUEST_TIMEOUT_MS, billingTimedOut);
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Dev activate failed (${response.status})`);
    }
    return fetchQaapBilling();
}

export async function putQaapUserAiSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetchQaapOrTimeoutError(QAAP_USER_SETTINGS_API_PATH, qaapAuthenticatedFetchInit({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
    }), QAAP_API_REQUEST_TIMEOUT_MS, userSettingsTimedOut);
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Failed to save AI settings (${response.status})`);
    }
    const body = await response.json() as { settings?: Record<string, unknown> };
    return body.settings && typeof body.settings === 'object' ? body.settings : settings;
}

export function startGithubOAuth(): void {
    window.location.assign(QAAP_GITHUB_OAUTH_START_PATH);
}

export async function signOutQaapAuth(): Promise<void> {
    try {
        await fetchQaapWithTimeout(`${QAAP_AUTH_API_PATH}/signout`, qaapAuthenticatedFetchInit({ method: 'POST' }), QAAP_AUTH_REQUEST_TIMEOUT_MS);
    } catch {
        /* still clear local session */
    }
    clearQaapAuthSession();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('qaap-mobile-projects-cache-clear'));
    }
}

/** Apply server session to local storage; returns true when signed in. */
export async function syncQaapAuthSessionFromServer(config?: QaapAuthConfigResponse): Promise<boolean> {
    const resolvedConfig = config ?? await fetchQaapAuthConfig().catch(() => ({ skipAuth: false, githubOAuth: false }));
    const session = await fetchQaapAuthSession();
    if (!session.signedIn || !session.user) {
        if (!resolvedConfig.skipAuth) {
            clearQaapAuthSession();
        }
        return false;
    }
    writeQaapAuthSession(session.user.provider as QaapAuthProvider, session.user);
    return true;
}

/** True while the URL still carries OAuth return params (before {@link consumeQaapOAuthReturnFromUrl}). */
export function peekQaapOAuthReturnFromUrl(): 'github' | 'error' | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has('qaap_oauth_error')) {
        return 'error';
    }
    if (params.get('qaap_oauth') === 'github') {
        return 'github';
    }
    return undefined;
}

/** Remove login gate DOM/CSS so the workbench is visible again. */
export function revealQaapWorkbenchAfterAuth(): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.body.classList.remove('qaap-login-active');
    document.getElementById('qaap-login-host')?.remove();
}

/**
 * Clean OAuth query params from the URL. When `clearHash` is true (fresh GitHub sign-in),
 * drop the hash so Theia does not boot into a stale workspace route before the shell is ready.
 */
export function stripQaapOAuthParamsFromUrl(clearHash = false, forceEmptyWindow = false): void {
    if (typeof window === 'undefined') {
        return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('qaap_oauth');
    url.searchParams.delete('qaap_oauth_error');
    if (forceEmptyWindow) {
        url.hash = '!empty';
    } else if (clearHash) {
        url.hash = '';
    }
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

/** Sync session after GitHub redirect; reveal IDE and normalize the URL when successful. */
export async function completeQaapGithubOAuthReturn(): Promise<boolean> {
    if (peekQaapOAuthReturnFromUrl() !== 'github') {
        return false;
    }
    const ok = await syncQaapAuthSessionFromServer();
    consumeQaapOAuthReturnFromUrl();
    if (ok) {
        revealQaapWorkbenchAfterAuth();
        // Keep #!empty from the OAuth redirect; only strip query params so workspace restore stays stable.
        stripQaapOAuthParamsFromUrl(false);
    }
    return ok;
}

/** Backend-provided machine-readable reason for the last failed OAuth callback. */
export function peekQaapOAuthErrorReasonFromUrl(): string | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const reason = new URLSearchParams(window.location.search).get('qaap_oauth_reason');
    return reason && reason.length > 0 ? reason : undefined;
}

export function consumeQaapOAuthReturnFromUrl(): 'github' | 'error' | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has('qaap_oauth_error')) {
        const next = new URL(window.location.href);
        next.searchParams.delete('qaap_oauth_error');
        next.searchParams.delete('qaap_oauth_reason');
        window.history.replaceState({}, '', next.pathname + next.search + next.hash);
        return 'error';
    }
    const provider = params.get('qaap_oauth');
    if (provider === 'github') {
        const next = new URL(window.location.href);
        next.searchParams.delete('qaap_oauth');
        window.history.replaceState({}, '', next.pathname + next.search + next.hash);
        return 'github';
    }
    return undefined;
}

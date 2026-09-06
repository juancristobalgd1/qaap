// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_AUTH_API_PATH = '/qaap/api/auth';
export const QAAP_GITHUB_API_PATH = '/qaap/api/github';
/** Per-user AI/BYOK settings (`~/.qaap/users/{login}/settings.json`). */
export const QAAP_USER_SETTINGS_API_PATH = '/qaap/api/user-settings';
/** Signed-in billing entitlements + Codex hosted credit wallet. */
export const QAAP_BILLING_API_PATH = '/qaap/api/billing';
/** Create a Stripe Checkout session for Pro / Team monthly subscription. */
export const QAAP_BILLING_CHECKOUT_API_PATH = '/qaap/api/billing/checkout';
/** Confirm a completed Checkout session after Stripe redirects back (idempotent with webhook). */
export const QAAP_BILLING_CONFIRM_CHECKOUT_API_PATH = '/qaap/api/billing/confirm-checkout';
/** Dev-only plan activate when Stripe keys are not configured. */
export const QAAP_BILLING_DEV_ACTIVATE_API_PATH = '/qaap/api/billing/dev-activate';
/** Unauthenticated liveness/readiness probe for monitors and VPS deploy gates. */
export const QAAP_HEALTH_API_PATH = '/qaap/api/health';
export const QAAP_GITHUB_OAUTH_START_PATH = '/qaap/oauth/github/start';
/** Must match GitHub OAuth App «Authorization callback URL». */
export const QAAP_GITHUB_OAUTH_CALLBACK_PATH = '/qaap/oauth/github/callback';

/**
 * The HttpOnly session cookie is the ONLY session credential. The id must never reach
 * JavaScript-accessible surfaces (JSON responses, localStorage, headers): any XSS could
 * otherwise exfiltrate a 30-day session. The legacy `x-qaap-session-id` header fallback
 * and the `qaap.auth.sessionId` localStorage key were removed in July 2026 — the session
 * store persists to the /workspace volume, so the post-restart desync it papered over is gone.
 */
export const QAAP_AUTH_SESSION_COOKIE = 'qaap_sid';

export interface QaapAuthConfigResponse {
    githubOAuth: boolean;
    /** Local dev: skip login gate and use a placeholder session (`QAAP_SKIP_AUTH=true`). */
    skipAuth?: boolean;
    /**
     * Short git SHA of the DEPLOYED build (`QAAP_BUILD_SHA`, baked at image build time).
     * Surfaced in the Work Hub so users and operators can tell at a glance which build is
     * actually serving — a redeploy is only "live" once this matches the pushed commit.
     * Absent in local dev.
     */
    build?: string;
    /**
     * True when the backend is a hosted/production runtime (`NODE_ENV=production` or
     * `QAAP_CLOUD_MODE` other than `local`). Work Hub uses this to hide localhost-OAuth
     * agent logins such as Cursor Agent.
     */
    productionRuntime?: boolean;
}

/** Public process liveness. Secrets never belong here — keep in sync with `/auth/config`. */
export interface QaapLaunchHealthResponse {
    ok: true;
    ready: boolean;
    productionRuntime: boolean;
    skipAuth: boolean;
    oauthConfigured: boolean;
    agentUidPerUser: boolean;
    build?: string;
}

export interface QaapAuthSessionUser {
    provider: 'github' | 'gitlab';
    login: string;
    name: string;
    avatarUrl?: string;
}

export interface QaapAuthSessionResponse {
    signedIn: boolean;
    user?: QaapAuthSessionUser;
}

export interface QaapGithubRepositorySummary {
    id: number;
    fullName: string;
    owner: string;
    name: string;
    cloneUrl: string;
    htmlUrl: string;
    defaultBranch: string;
    private: boolean;
    description?: string;
    updatedAt: string;
}

export interface QaapGithubRepositoriesResponse {
    repositories: QaapGithubRepositorySummary[];
}

export interface QaapGithubOpenRepositoryResponse {
    repository: QaapGithubRepositorySummary;
    workspaceUri: string;
}

export interface QaapGithubCreateRepositoryRequest {
    name: string;
    private?: boolean;
    description?: string;
}

export interface QaapGithubOpenRepositoryRequest {
    repository: string;
}

export type QaapGithubPullRequestLineType = 'add' | 'del' | 'ctx';

export interface QaapGithubPullRequestLine {
    t: QaapGithubPullRequestLineType;
    n: number;
    s: string;
}

export interface QaapGithubPullRequestFile {
    f: string;
    ext: string;
    adds: number;
    dels: number;
    preview: QaapGithubPullRequestLine[];
}

export interface QaapGithubPullRequestSummary {
    owner: string;
    repo: string;
    number: number;
    title: string;
    branch: string;
    base: string;
    author: string;
    files: number;
    adds: number;
    dels: number;
    tests: 'passing' | 'failing' | 'pending' | 'unknown';
    /** GitHub lifecycle state. Inbox polling currently returns open PRs; webhooks may also report closed/merged. */
    state?: 'open' | 'closed' | 'merged';
    /** Open PR is still a draft and is not ready for review. */
    draft?: boolean;
    htmlUrl: string;
    mergeable?: boolean;
    filesPreview: QaapGithubPullRequestFile[];
    /** ISO-8601 — used for inbox ordering (GitHub `updated_at`). */
    updatedAt: string;
}

export interface QaapGithubPullRequestsResponse {
    pullRequests: QaapGithubPullRequestSummary[];
    /** Repo derived from the currently-open workspace (when detectable). */
    currentRepository?: QaapGithubRepositorySummary;
    /** False when the request was rejected because the session is missing/expired. */
    signedIn: boolean;
}

export interface QaapGithubMergePullRequestRequest {
    owner: string;
    repo: string;
    number: number;
}

export interface QaapGithubMergePullRequestResponse {
    merged: boolean;
    message: string;
    sha?: string;
}

/** GitHub pull request linked to an agent conversation thread. */
export interface QaapLinkedPullRequest {
    readonly owner: string;
    readonly repo: string;
    /** Set when known (webhook or manual link); omitted for branch-only auto-link. */
    readonly number?: number;
    readonly branch?: string;
    readonly title?: string;
    /** Omitted for legacy/branch-only links whose current GitHub state has not been resolved. */
    readonly state?: 'open' | 'closed' | 'merged';
    readonly draft?: boolean;
    readonly tests?: 'passing' | 'failing' | 'pending' | 'unknown';
    readonly mergeable?: boolean;
}

/** SSE payload when GitHub notifies the IDE about pull-request activity. */
export type QaapGithubInboxEvent =
    | {
        readonly type: 'pull_request';
        readonly action: string;
        readonly pullRequest: QaapGithubPullRequestSummary;
        readonly linkedConversationCount: number;
    }
    | { readonly type: 'inbox_refresh' };

/** Per-repository agent/dev session snapshot (hub + KPI). */
export interface QaapProjectSessionSummary {
    /** Stable key, e.g. `github:owner/repo` or `ws:file:///path`. */
    readonly repoKey: string;
    /**
     * `file:` URI of the session owner's on-disk clone, derived server-side at read time and
     * present only when the repository is actually cloned. This is the AUTHORITATIVE project
     * path for hub entries: without it the client could only guess from the open workspace,
     * which on hosted deployments is the multi-repo container — never a usable cwd.
     */
    readonly workspaceUri?: string;
    readonly branch: string;
    readonly tokens?: string;
    readonly cost?: string;
    readonly agentState?: 'idle' | 'working' | 'review';
    readonly lastTask?: string;
    readonly lastActiveAt?: string;
    readonly previewUrl?: string;
    readonly bootstrapPhase?: string;
}

export interface QaapProjectSessionsResponse {
    readonly sessions: QaapProjectSessionSummary[];
}

export interface QaapProjectSessionUpsertRequest {
    readonly repoKey: string;
    readonly branch?: string;
    readonly tokens?: string;
    readonly cost?: string;
    readonly agentState?: QaapProjectSessionSummary['agentState'];
    readonly lastTask?: string;
    readonly previewUrl?: string;
    readonly bootstrapPhase?: string;
}

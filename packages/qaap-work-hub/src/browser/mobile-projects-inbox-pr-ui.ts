// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    fetchQaapAuthConfig,
    fetchQaapAuthSession,
    fetchQaapGithubPullRequests,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { clearQaapAuthSession, readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { githubRepoKeysForProjects, pullRequestKey } from './mobile-work-hub-inbox';
import type { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import type { MobileProjectEntry, MobileProjectsHubView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

export const MOBILE_PROJECTS_INBOX_PR_FETCH_TIMEOUT_MS = 20_000;

/** Panel surface for GitHub pull-request polling used by Review / Home hubs. */
export interface MobileProjectsInboxPrHost {
    visible: boolean;
    hubView: MobileProjectsHubView;
    transcriptSheet: HTMLElement | undefined;
    inboxLoadGeneration: number;
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoading: boolean;
    inboxPullRequestsLoaded: boolean;
    inboxGithubSignedIn: boolean | undefined;
    inboxGithubLogin?: string;
    inboxPullRequestsAbort: AbortController | undefined;
    inboxStream: MobileWorkHubInboxStream | undefined;

    hubQueryUi: import('@theia/qaap-shared-core/lib/browser/mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    renderList(): void;
    sessionsSidebar?: import('./mobile-work-hub-sessions-sidebar').MobileWorkHubSessionsSidebar;
    refreshPullRequestsSidebar?(): void;
}

/** Fetches and merges inbox pull requests for the Work Hub review surface. */
export class MobileProjectsInboxPrUi {

    constructor(protected readonly host: MobileProjectsInboxPrHost) { }

    resetInboxPullRequestState(): void {
        this.host.inboxPullRequestsAbort?.abort();
        this.host.inboxPullRequestsAbort = undefined;
        this.host.inboxPullRequests = [];
        this.host.inboxPullRequestsLoaded = false;
        this.host.inboxPullRequestsLoading = false;
        this.host.inboxGithubSignedIn = undefined;
        this.host.inboxGithubLogin = undefined;
    }

    finishInboxPullRequestLoad(generation: number): void {
        if (generation !== this.host.inboxLoadGeneration) {
            // A stale (usually aborted) request must not clear the loading flag owned by a
            // newer in-flight request; that request finishes its own load.
            if (!this.host.inboxPullRequestsAbort) {
                this.host.inboxPullRequestsLoading = false;
            }
            return;
        }
        this.host.inboxPullRequestsLoaded = true;
        this.host.inboxPullRequestsLoading = false;
        if (this.host.visible && this.host.hubView === 'review') {
            this.host.renderList();
        }
        this.host.refreshPullRequestsSidebar?.();
    }

    mergeInboxPullRequests(polled: QaapGithubPullRequestSummary[]): QaapGithubPullRequestSummary[] {
        const live = this.host.inboxStream?.getLivePullRequests() ?? [];
        const merged = new Map<string, QaapGithubPullRequestSummary>();
        for (const pullRequest of polled) {
            merged.set(pullRequestKey(pullRequest), pullRequest);
        }
        for (const pullRequest of live) {
            merged.set(pullRequestKey(pullRequest), pullRequest);
        }
        return [...merged.values()].sort(
            (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        );
    }

    async refreshInboxPullRequests(
        projects: MobileProjectEntry[] = this.host.hubQueryUi.projectsForCurrentHubList(),
        force = false,
    ): Promise<void> {
        if (this.host.inboxPullRequestsLoading && !force) {
            return;
        }
        const generation = this.host.inboxLoadGeneration;
        this.host.inboxPullRequestsAbort?.abort();
        const abort = new AbortController();
        this.host.inboxPullRequestsAbort = abort;
        const timeout = window.setTimeout(() => abort.abort(), MOBILE_PROJECTS_INBOX_PR_FETCH_TIMEOUT_MS);
        this.host.inboxPullRequestsLoading = true;
        const repoKeys = githubRepoKeysForProjects(projects);
        try {
            const config = await fetchQaapAuthConfig().catch(() => ({ skipAuth: false, githubOAuth: false }));
            // Skip-auth has no GitHub session, except on the desktop app with the user's own credential (gh,
            // GH_TOKEN): the backend then serves the same pull requests as the sidebar's search.
            const skipAuthSession = config.skipAuth ? await fetchQaapAuthSession().catch(() => undefined) : undefined;
            const desktopGithubLogin = skipAuthSession?.signedIn ? skipAuthSession.githubCredential?.user?.login : undefined;
            if (config.skipAuth && !desktopGithubLogin) {
                this.host.inboxPullRequests = [];
                this.host.inboxGithubSignedIn = undefined;
                this.host.inboxGithubLogin = undefined;
                return;
            }
            if (repoKeys.length === 0) {
                this.host.inboxPullRequests = [];
                // No project repositories says nothing about GitHub: keep a refusal the pull-request search already
                // recorded (`false`), or the Pull requests tab shows "No pull requests yet" for an expired session.
                if (this.host.inboxGithubSignedIn !== false) {
                    this.host.inboxGithubSignedIn = undefined;
                }
                this.host.inboxGithubLogin = undefined;
                return;
            }
            const auth = skipAuthSession ?? await fetchQaapAuthSession();
            if (generation !== this.host.inboxLoadGeneration || abort.signal.aborted) {
                return;
            }
            if (!auth.signedIn) {
                if (readQaapSignedIn()) {
                    clearQaapAuthSession();
                }
                this.host.inboxGithubSignedIn = false;
                this.host.inboxGithubLogin = undefined;
                this.host.inboxPullRequests = [];
                return;
            }
            // A Qaap session is not a working GitHub token: only the GitHub answer below may clear a recorded refusal.
            if (this.host.inboxGithubSignedIn !== false) {
                this.host.inboxGithubSignedIn = true;
            }
            this.host.inboxGithubLogin = desktopGithubLogin ?? auth.user?.login;
            const response = await fetchQaapGithubPullRequests(repoKeys);
            if (generation !== this.host.inboxLoadGeneration || abort.signal.aborted) {
                return;
            }
            if (response.signedIn === false) {
                // GitHub refused the stored token (expired, revoked, unreadable): the inbox offers to reconnect GitHub,
                // but the Qaap session stays. /auth/session (checked above) still says signed in, so clearing it here
                // made the next project sync write it back, and every write and clear fired qaap-auth-session-changed,
                // which refreshed projects and this inbox again: a full re-render loop several times a second (staging,
                // 24 Nov 2026).
                this.host.inboxGithubSignedIn = false;
                this.host.inboxGithubLogin = undefined;
                this.host.inboxPullRequests = [];
                return;
            }
            this.host.inboxGithubSignedIn = true;
            this.host.inboxPullRequests = this.mergeInboxPullRequests(response.pullRequests);
        } catch {
            if (generation !== this.host.inboxLoadGeneration || abort.signal.aborted) {
                return;
            }
            this.host.inboxPullRequests = [];
        } finally {
            window.clearTimeout(timeout);
            const superseded = this.host.inboxPullRequestsAbort !== abort;
            if (!superseded) {
                this.host.inboxPullRequestsAbort = undefined;
                this.finishInboxPullRequestLoad(generation);
            }
        }
    }
}

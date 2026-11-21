// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { lookupQaapGithubPullRequest, startGithubOAuth, type QaapGithubPullRequestLookup } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { HubEmptyStateDom } from './mobile-projects-hub-empty-state-dom';
import {
    pullRequestDisplayState,
    isQaapWorkHubPinnedPullRequestTarget,
    qaapWorkHubPullRequestTargetKey,
    recentPullRequestComments,
    summarizePullRequestChecks,
    summarizePullRequestReview,
    type QaapWorkHubPullRequestDisplayState,
    type QaapWorkHubPullRequestReviewStatus,
    type QaapWorkHubPullRequestTarget,
} from './qaap-work-hub-aux-pull-request-model';

/** How often an open or draft pull request is re-read while the view and the document are visible. */
export const QAAP_WORK_HUB_AUX_PULL_REQUEST_REFRESH_MS = 60_000;

/** Least time between automatic fetches of the same target (opening, visibility, polling). Try again is not automatic. */
export const QAAP_WORK_HUB_AUX_PULL_REQUEST_MIN_AUTO_GAP_MS = 15_000;

const COMMENT_TEXT_LIMIT = 240;

export interface QaapWorkHubAuxPullRequestViewOptions {
    readonly lookup?: (target: QaapWorkHubPullRequestTarget) => Promise<QaapGithubPullRequestLookup>;
    /** Opens a GitHub page. Defaults to a new browser tab, which is the external browser on desktop. */
    readonly openExternal?: (url: string) => void;
    readonly startSignIn?: () => void;
    readonly refreshMs?: number;
    readonly minAutoGapMs?: number;
}

/**
 * The "Pull request" view of the desktop Work Hub right panel: the pull request of the task or project
 * the panel follows, with its checks, review state and recent comments.
 *
 * It fetches when it opens on a target, when the target really changes (owner, repo, number, branch and scope)
 * and on "Try again". It polls every `refreshMs` only while the pull request is open or draft and both the panel
 * and the document are visible. Without a session, without a pull request, or for merged, closed or failed
 * answers there is no timer. A fetch in flight for the same target is never duplicated, and automatic fetches of
 * the same target are at least `minAutoGapMs` apart. It never listens to the replica or transcript buses.
 * The last answer stays on screen during a refresh.
 */
export class QaapWorkHubAuxPullRequestView implements Disposable {
    readonly element: HTMLElement;

    protected readonly scroll: HTMLElement;
    protected readonly lookup: (target: QaapWorkHubPullRequestTarget) => Promise<QaapGithubPullRequestLookup>;
    protected readonly openExternal: (url: string) => void;
    protected readonly startSignIn: () => void;
    protected readonly refreshMs: number;
    protected readonly minAutoGapMs: number;

    protected target: QaapWorkHubPullRequestTarget | undefined;
    /** The open project's name, for the empty state of a project that has no pull request target. */
    protected projectName: string | undefined;
    /** Leaves a specific pull request for the branch's one. Set only while that is possible. */
    protected onBackToBranch: (() => void) | undefined;
    protected key: string | undefined;
    protected result: QaapGithubPullRequestLookup | undefined;
    protected loading = false;
    /** The target key of the lookup in flight: the same target is never looked up twice at once. */
    protected inFlightKey: string | undefined;
    /** Bumped on every target change and every load, so a superseded answer is dropped. */
    protected sequence = 0;
    /** The target key and time of the last attempt, which spaces out automatic fetches. */
    protected lastAttemptKey: string | undefined;
    protected lastAttemptAt = 0;
    /** Whether the panel shows this view. The poll runs only while it is true. */
    protected visible = false;
    protected timer: number | undefined;
    protected readonly onVisibilityChange = (): void => {
        if (this.element.ownerDocument.hidden) {
            this.clearTimer();
            return;
        }
        if (this.visible && this.target && this.isPollable()) {
            this.requestLoad(false);
        }
        this.updatePolling();
    };

    constructor(options: QaapWorkHubAuxPullRequestViewOptions = {}) {
        this.lookup = options.lookup ?? (target => lookupQaapGithubPullRequest({
            owner: target.owner,
            repo: target.repo,
            number: target.number,
            branch: target.branch,
        }));
        this.openExternal = options.openExternal ?? (url => {
            window.open(url, '_blank', 'noopener,noreferrer');
        });
        this.startSignIn = options.startSignIn ?? startGithubOAuth;
        this.refreshMs = options.refreshMs ?? QAAP_WORK_HUB_AUX_PULL_REQUEST_REFRESH_MS;
        this.minAutoGapMs = options.minAutoGapMs ?? QAAP_WORK_HUB_AUX_PULL_REQUEST_MIN_AUTO_GAP_MS;

        this.element = document.createElement('section');
        this.element.className = 'qaap-work-hub-aux-pr';
        this.element.setAttribute('aria-label', nls.localize('qaap/workHubAuxPanel/pullRequest', 'Pull request'));
        this.element.hidden = true;
        this.scroll = document.createElement('div');
        this.scroll.className = 'qaap-work-hub-aux-pr-scroll';
        this.element.append(this.scroll);
        this.element.ownerDocument.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    /**
     * Follows `target` while the view is `visible`. A changed target clears the last answer and loads the new
     * one; a visible view starts its refresh timer; a hidden one stops it.
     */
    /** The open project's name; with no target it says the project has no pull request instead of "No project open". */
    setProjectName(name: string | undefined): void {
        this.projectName = name?.trim() || undefined;
    }

    sync(target: QaapWorkHubPullRequestTarget | undefined, visible: boolean, onBackToBranch?: () => void): void {
        this.onBackToBranch = onBackToBranch;
        const key = target ? qaapWorkHubPullRequestTargetKey(target) : undefined;
        this.target = target;
        if (key !== this.key) {
            // The key compares identity, so a new target object for the same pull request is not a change.
            this.key = key;
            this.result = undefined;
            this.loading = false;
            this.inFlightKey = undefined;
            this.sequence++;
        }
        this.visible = visible && !!target;
        if (this.visible && !this.result) {
            this.requestLoad(false);
        }
        this.updatePolling();
        this.render();
    }

    /** Stops following the target and its timer. The last answer stays until the target changes. */
    stop(): void {
        this.visible = false;
        this.clearTimer();
    }

    protected clearTimer(): void {
        if (this.timer !== undefined) {
            this.view().clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /** Polls only an open or draft pull request, and only while the panel and the document are visible. */
    protected updatePolling(): void {
        if (this.visible && this.target && !this.element.ownerDocument.hidden && this.isPollable()) {
            this.startRefresh();
        } else {
            this.clearTimer();
        }
    }

    protected isPollable(): boolean {
        if (this.result?.kind !== 'found') {
            return false;
        }
        const state = pullRequestDisplayState(this.result.pullRequest);
        return state === 'open' || state === 'draft';
    }

    dispose(): void {
        this.stop();
        this.element.ownerDocument.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.element.remove();
    }

    protected view(): Window {
        return this.element.ownerDocument.defaultView ?? window;
    }

    protected startRefresh(): void {
        if (this.timer !== undefined) {
            return;
        }
        this.timer = this.view().setInterval(() => {
            if (!this.visible || this.element.ownerDocument.hidden || !this.isPollable()) {
                this.updatePolling();
                return;
            }
            this.requestLoad(false);
        }, this.refreshMs);
    }

    /**
     * Starts a lookup for the current target. A lookup already in flight for the same target is never duplicated,
     * and an automatic lookup waits `minAutoGapMs` after the previous attempt for that target. Try again is manual.
     */
    protected requestLoad(manual: boolean): void {
        if (!this.target || this.key === undefined) {
            return;
        }
        if (this.loading && this.inFlightKey === this.key) {
            return;
        }
        if (!manual && this.lastAttemptKey === this.key && Date.now() - this.lastAttemptAt < this.minAutoGapMs) {
            return;
        }
        void this.load();
    }

    protected async load(): Promise<void> {
        const target = this.target;
        const key = this.key;
        if (!target || key === undefined) {
            return;
        }
        const sequence = ++this.sequence;
        this.loading = true;
        this.inFlightKey = key;
        this.lastAttemptKey = key;
        this.lastAttemptAt = Date.now();
        this.render();
        let result: QaapGithubPullRequestLookup;
        try {
            result = await this.lookup(target);
        } catch {
            result = { kind: 'error', message: nls.localize('qaap/workHubAuxPanel/prLoadFailed', 'Could not load the pull request.') };
        }
        if (sequence !== this.sequence) {
            return;
        }
        this.loading = false;
        this.inFlightKey = undefined;
        this.result = result;
        this.updatePolling();
        this.render();
    }

    protected render(): void {
        const banner = this.createPinnedBanner();
        this.scroll.replaceChildren(...(banner ? [banner, this.buildContent()] : [this.buildContent()]));
    }

    /** The "specific pull request" mode: says which one is shown and offers the way back to the branch's. */
    protected createPinnedBanner(): HTMLElement | undefined {
        const target = this.target;
        if (!target || !isQaapWorkHubPinnedPullRequestTarget(target)) {
            return undefined;
        }
        const banner = document.createElement('div');
        banner.className = 'qaap-work-hub-aux-pr-pinned';
        const label = document.createElement('span');
        label.className = 'qaap-work-hub-aux-pr-pinned-label';
        label.textContent = nls.localize('qaap/workHubAuxPanel/prPinned', 'Showing {0}/{1}#{2}', target.owner, target.repo, target.number ?? '');
        banner.append(label);
        const back = this.onBackToBranch;
        if (back) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'qaap-work-hub-aux-pr-back';
            button.textContent = nls.localize('qaap/workHubAuxPanel/prBackToBranch', 'Back to the branch pull request');
            button.addEventListener('click', () => back());
            banner.append(button);
        }
        return banner;
    }

    protected buildContent(): HTMLElement {
        const target = this.target;
        if (!target && this.projectName) {
            return HubEmptyStateDom.createEmptyState({
                icon: 'codicon-git-pull-request',
                title: nls.localize('qaap/workHubAuxPanel/prNoRepo', 'No pull request for {0}', this.projectName),
                hint: nls.localize('qaap/workHubAuxPanel/prNoRepoHint', 'This project is not linked to a GitHub repository, so it has no pull request yet.'),
            });
        }
        if (!target) {
            return HubEmptyStateDom.createEmptyState({
                icon: 'codicon-git-pull-request',
                title: nls.localize('qaap/workHubAuxPanel/prNoProject', 'No project open'),
                hint: nls.localize('qaap/workHubAuxPanel/prNoProjectHint', 'Open a project to see its pull request.'),
            });
        }
        if (!this.result) {
            return this.createSkeleton();
        }
        const result = this.result;
        switch (result.kind) {
            case 'found':
                return this.createDetail(result.pullRequest);
            case 'none':
                if (isQaapWorkHubPinnedPullRequestTarget(target)) {
                    return HubEmptyStateDom.createEmptyState({
                        icon: 'codicon-git-pull-request',
                        title: nls.localize('qaap/workHubAuxPanel/prNotFound', 'Pull request not found'),
                        hint: nls.localize('qaap/workHubAuxPanel/prNotFoundHint', '{0}/{1}#{2} does not exist or is not visible to you.', target.owner, target.repo, target.number ?? ''),
                    });
                }
                return HubEmptyStateDom.createEmptyState({
                    icon: 'codicon-git-pull-request',
                    title: nls.localize('qaap/workHubAuxPanel/prNone', 'No pull request for this branch'),
                    hint: target.branch
                        ? nls.localize('qaap/workHubAuxPanel/prNoneHint', 'Branch {0} has no pull request yet.', target.branch)
                        : nls.localize('qaap/workHubAuxPanel/prNoneHintPlain', 'This branch has no pull request yet.'),
                });
            case 'signed-out':
                return HubEmptyStateDom.createEmptyState({
                    icon: 'codicon-github',
                    title: nls.localize('qaap/workHubAuxPanel/prConnect', 'Connect GitHub'),
                    hint: nls.localize('qaap/workHubAuxPanel/prConnectHint', 'Sign in with GitHub to see the pull request for this branch.'),
                    action: { label: nls.localize('qaap/workHubAuxPanel/prConnectAction', 'Connect GitHub'), onClick: () => this.startSignIn() },
                });
            case 'error':
            default:
                return HubEmptyStateDom.createEmptyState({
                    icon: 'codicon-error',
                    title: nls.localize('qaap/workHubAuxPanel/prErrorTitle', 'Could not load the pull request'),
                    hint: result.kind === 'error' ? result.message : '',
                    action: { label: nls.localize('qaap/workHubAuxPanel/prRetry', 'Try again'), onClick: () => this.requestLoad(true) },
                });
        }
    }

    protected createSkeleton(): HTMLElement {
        const box = document.createElement('div');
        box.className = 'qaap-work-hub-aux-pr-skeleton';
        box.setAttribute('aria-busy', 'true');
        box.setAttribute('aria-label', nls.localize('qaap/workHubAuxPanel/prLoading', 'Loading the pull request…'));
        for (const width of ['60%', '90%', '40%', '75%']) {
            const line = document.createElement('div');
            line.className = 'q-skeleton q-skeleton-text qaap-work-hub-aux-pr-skeleton-line';
            line.style.width = width;
            box.append(line);
        }
        return box;
    }

    protected createDetail(pr: QaapGithubPullRequestSummary): HTMLElement {
        const root = document.createElement('div');
        root.className = 'qaap-work-hub-aux-pr-detail';
        root.append(this.createHeader(pr), this.createChecks(pr), this.createReview(pr), this.createComments(pr), this.createFooter(pr));
        return root;
    }

    protected createHeader(pr: QaapGithubPullRequestSummary): HTMLElement {
        const header = document.createElement('header');
        header.className = 'qaap-work-hub-aux-pr-head';
        const meta = document.createElement('div');
        meta.className = 'qaap-work-hub-aux-pr-meta';
        const state = pullRequestDisplayState(pr);
        const chip = document.createElement('span');
        chip.className = `qaap-work-hub-aux-pr-state qaap-work-hub-aux-pr-state-${state}`;
        chip.textContent = this.stateLabel(state);
        const number = document.createElement('span');
        number.className = 'qaap-work-hub-aux-pr-number';
        number.textContent = `#${pr.number}`;
        meta.append(chip, number);
        const title = document.createElement('h2');
        title.className = 'qaap-work-hub-aux-pr-title';
        title.textContent = pr.title;
        const branches = document.createElement('p');
        branches.className = 'qaap-work-hub-aux-pr-branches';
        branches.textContent = `${pr.base} ← ${pr.branch}`;
        const stats = document.createElement('p');
        stats.className = 'qaap-work-hub-aux-pr-stats';
        stats.textContent = nls.localize('qaap/workHubAuxPanel/prDiffStats', '+{0} −{1} in {2} files', pr.adds, pr.dels, pr.files);
        header.append(meta, title, branches, stats);
        return header;
    }

    protected createChecks(pr: QaapGithubPullRequestSummary): HTMLElement {
        const section = this.section(nls.localizeByDefault('Checks'));
        const summary = summarizePullRequestChecks(pr.checks);
        if (summary.total === 0) {
            section.append(this.paragraph(nls.localize('qaap/workHubAuxPanel/prNoChecks', 'No checks reported.')));
            return section;
        }
        section.append(this.paragraph(nls.localize(
            'qaap/workHubAuxPanel/prChecksSummary', '{0} passed, {1} failed, {2} pending', summary.passed, summary.failed, summary.pending,
        ), 'qaap-work-hub-aux-pr-checks-summary'));
        if (summary.failedChecks.length) {
            const list = document.createElement('ul');
            list.className = 'qaap-work-hub-aux-pr-list';
            for (const check of summary.failedChecks) {
                const item = document.createElement('li');
                item.className = 'qaap-work-hub-aux-pr-check-failed';
                if (check.url) {
                    // A button, not an anchor: the host opens it in the system browser on desktop.
                    const link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'qaap-work-hub-aux-pr-check-link';
                    link.textContent = check.name;
                    const url = check.url;
                    link.addEventListener('click', () => this.openExternal(url));
                    item.append(link);
                } else {
                    item.textContent = check.name;
                }
                list.append(item);
            }
            section.append(list);
        }
        return section;
    }

    protected createReview(pr: QaapGithubPullRequestSummary): HTMLElement {
        const section = this.section(nls.localizeByDefault('Review'));
        const status = summarizePullRequestReview(pr);
        section.append(this.paragraph(this.reviewLabel(status), `qaap-work-hub-aux-pr-review qaap-work-hub-aux-pr-review-${status}`));
        const requested = (pr.requestedReviewers ?? []).map(reviewer => reviewer.login);
        if (requested.length) {
            section.append(this.paragraph(nls.localize('qaap/workHubAuxPanel/prReviewers', 'Requested: {0}', requested.join(', '))));
        }
        return section;
    }

    protected createComments(pr: QaapGithubPullRequestSummary): HTMLElement {
        const section = this.section(nls.localize('qaap/workHubAuxPanel/prComments', 'Recent comments'));
        const comments = recentPullRequestComments(pr);
        if (!comments.length) {
            section.append(this.paragraph(nls.localize('qaap/workHubAuxPanel/prNoComments', 'No comments yet.')));
            return section;
        }
        const list = document.createElement('ul');
        list.className = 'qaap-work-hub-aux-pr-list qaap-work-hub-aux-pr-comments';
        for (const comment of comments) {
            const item = document.createElement('li');
            const who = document.createElement('strong');
            who.textContent = comment.actor ?? nls.localizeByDefault('Unknown');
            item.append(who);
            if (comment.createdAt) {
                const when = document.createElement('time');
                when.dateTime = comment.createdAt;
                when.textContent = new Date(comment.createdAt).toLocaleString();
                item.append(' ', when);
            }
            const text = document.createElement('p');
            const body = comment.text?.trim() ?? '';
            text.textContent = body.length > COMMENT_TEXT_LIMIT ? `${body.slice(0, COMMENT_TEXT_LIMIT)}…` : body;
            item.append(text);
            list.append(item);
        }
        section.append(list);
        return section;
    }

    protected createFooter(pr: QaapGithubPullRequestSummary): HTMLElement {
        const footer = document.createElement('footer');
        footer.className = 'qaap-work-hub-aux-pr-footer';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'qaap-work-hub-aux-pr-open';
        open.textContent = nls.localizeByDefault('Open on GitHub');
        open.addEventListener('click', () => this.openExternal(pr.htmlUrl));
        footer.append(open);
        return footer;
    }

    protected section(heading: string): HTMLElement {
        const section = document.createElement('section');
        section.className = 'qaap-work-hub-aux-pr-section';
        const title = document.createElement('h3');
        title.className = 'qaap-work-hub-aux-pr-section-title';
        title.textContent = heading;
        section.append(title);
        return section;
    }

    protected paragraph(text: string, className?: string): HTMLParagraphElement {
        const element = document.createElement('p');
        if (className) {
            element.className = className;
        }
        element.textContent = text;
        return element;
    }

    protected stateLabel(state: QaapWorkHubPullRequestDisplayState): string {
        switch (state) {
            case 'merged':
                return nls.localize('qaap/workHubAuxPanel/prStateMerged', 'Merged');
            case 'closed':
                return nls.localizeByDefault('Closed');
            case 'draft':
                return nls.localize('qaap/workHubAuxPanel/prStateDraft', 'Draft');
            default:
                return nls.localizeByDefault('Open');
        }
    }

    protected reviewLabel(status: QaapWorkHubPullRequestReviewStatus): string {
        switch (status) {
            case 'changes-requested':
                return nls.localize('qaap/workHubAuxPanel/prReviewChanges', 'Changes requested');
            case 'approved':
                return nls.localize('qaap/workHubAuxPanel/prReviewApproved', 'Approved');
            case 'review-requested':
                return nls.localize('qaap/workHubAuxPanel/prReviewRequested', 'Review requested');
            case 'commented':
                return nls.localize('qaap/workHubAuxPanel/prReviewCommented', 'Commented');
            default:
                return nls.localize('qaap/workHubAuxPanel/prReviewNone', 'No reviews yet');
        }
    }
}

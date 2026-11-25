// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    mergeQaapGithubPullRequest,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubPullRequestCheck,
    QaapGithubPullRequestFile,
    QaapGithubPullRequestSummary,
    QaapGithubPullRequestTimelineEvent,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { nls } from '@theia/core/lib/common/nls';
import * as markdownit from '@theia/core/shared/markdown-it';

export interface MobileProjectsPullRequestDetailHost {
    pullRequestDetail: QaapGithubPullRequestSummary | undefined;
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoading: boolean;
    inboxPullRequestsLoaded: boolean;
    inboxGithubSignedIn: boolean | undefined;
    scroll: HTMLElement;

    closePullRequestDetail(): void;
    refreshInboxPullRequests(projects?: import('@theia/qaap-shared-core/lib/browser/mobile-projects-types').MobileProjectEntry[], force?: boolean): Promise<void>;
    /** Lets the all-pull-requests navigator flip the merged PR's state without a full reload. */
    onPullRequestMerged?(pullRequest: QaapGithubPullRequestSummary): void;
}

export type MobileProjectsPullRequestDetailTab = 'summary' | 'timeline' | 'code';
type PullRequestDetailTab = MobileProjectsPullRequestDetailTab;
export type PullRequestCommentDialogMode = 'comment' | 'review';
export type PullRequestReviewVerdict = 'approve' | 'comment' | 'request_changes';

/** Main-content pull-request detail surface opened from the sidebar navigator. */
export class MobileProjectsPullRequestDetailUi {

    protected readonly descriptionMarkdown = markdownit({ linkify: true });
    protected activeTab: PullRequestDetailTab = 'summary';
    protected readonly expandedFiles = new Set<string>();
    protected descriptionEditing = false;
    protected descriptionExpanded = true;
    protected checksExpanded = true;
    protected activityExpanded = true;
    protected mergeConfirming = false;
    protected merging = false;
    protected merged = false;
    protected reviewerRequested = false;
    protected notice = '';
    protected description = '';
    protected commentDraft = '';
    protected comments: string[] = [];
    protected localTimelineEntries: QaapGithubPullRequestTimelineEvent[] = [];
    protected commentDialogOpen = false;
    protected commentDialogMode: PullRequestCommentDialogMode = 'comment';
    protected reviewVerdict: PullRequestReviewVerdict = 'comment';
    protected pendingCommentFocus = false;
    protected popoverListenersCleanup: (() => void) | undefined;
    protected renderedPullRequestKey = '';

    constructor(protected readonly host: MobileProjectsPullRequestDetailHost) { }

    getActiveTab(): MobileProjectsPullRequestDetailTab {
        return this.activeTab;
    }

    setActiveTab(tab: MobileProjectsPullRequestDetailTab): void {
        this.activeTab = tab;
    }

    openChat(): void {
        if (!this.host.pullRequestDetail) {
            return;
        }
        this.commentDialogOpen = true;
        this.commentDialogMode = 'comment';
        this.pendingCommentFocus = true;
        this.render();
    }

    toggleMergeConfirmation(): void {
        const pullRequest = this.host.pullRequestDetail;
        if (!pullRequest || this.merged || this.merging || !this.canMerge(pullRequest)) {
            return;
        }
        this.mergeConfirming = !this.mergeConfirming;
        this.render();
    }

    renderEmpty(): void {
        this.disposePopoverListeners();
        this.commentDialogOpen = false;
        const root = document.createElement('div');
        root.className = 'theia-mobile-work-hub-pull-request-empty-detail';

        const icon = document.createElement('span');
        icon.className = 'codicon codicon-git-pull-request';
        icon.setAttribute('aria-hidden', 'true');

        const title = document.createElement('h2');
        const body = document.createElement('p');
        if (!this.host.inboxPullRequestsLoaded && this.host.inboxPullRequestsLoading) {
            title.textContent = nls.localize('qaap/pullRequests/loadingDetail', 'Loading pull requests…');
            body.textContent = nls.localize('qaap/pullRequests/loadingDetailBody', 'Fetching pull requests from GitHub.');
        } else if (this.host.inboxGithubSignedIn === false) {
            title.textContent = nls.localize('qaap/pullRequests/connectDetail', 'Connect GitHub');
            body.textContent = nls.localize('qaap/pullRequests/connectDetailBody', 'Sign in with GitHub to see your pull requests.');
        } else if (this.host.inboxPullRequests.length > 0) {
            title.textContent = nls.localize('qaap/pullRequests/selectDetail', 'Select a pull request');
            body.textContent = nls.localize('qaap/pullRequests/selectDetailBody', 'Choose a pull request from the sidebar to view its details.');
        } else {
            title.textContent = nls.localize('qaap/pullRequests/noDetailTitle', 'Ready when you open a pull request');
            body.textContent = nls.localize(
                'qaap/pullRequests/noDetailDescription',
                'Ask an agent to open a pull request or create one on GitHub — checks, diffs, and review threads will show up here.',
            );
        }

        root.append(icon, title, body);
        this.host.scroll.replaceChildren(root);
    }

    render(): void {
        this.disposePopoverListeners();
        const pullRequest = this.host.pullRequestDetail;
        if (!pullRequest) {
            this.commentDialogOpen = false;
            this.host.scroll.replaceChildren();
            return;
        }
        const key = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;
        if (key !== this.renderedPullRequestKey) {
            this.renderedPullRequestKey = key;
            this.activeTab = 'summary';
            this.expandedFiles.clear();
            this.descriptionEditing = false;
            this.description = pullRequest.description?.trim() || this.defaultDescription(pullRequest);
            this.commentDraft = '';
            this.comments = [];
            this.localTimelineEntries = [];
            this.commentDialogOpen = false;
            this.commentDialogMode = 'comment';
            this.reviewVerdict = 'comment';
            this.pendingCommentFocus = false;
            this.merged = pullRequest.state === 'merged';
            this.mergeConfirming = false;
            this.notice = '';
        }

        const root = document.createElement('div');
        root.className = 'theia-mobile-work-hub-pull-request-detail qaap-pr';
        root.append(this.createHeader(pullRequest));
        if (this.notice) {
            const notice = document.createElement('div');
            notice.className = 'theia-mobile-work-hub-pull-request-notice';
            notice.textContent = this.notice;
            root.append(notice);
        }
        if (this.mergeConfirming) {
            root.append(this.createMergeConfirmation(pullRequest));
        }
        root.append(this.createTabBar(pullRequest));
        if (this.activeTab === 'code') {
            root.append(this.createCodeView(pullRequest));
        } else if (this.activeTab === 'timeline') {
            root.append(this.createTimelineView(pullRequest));
        } else {
            root.append(this.createSummaryView(pullRequest));
        }
        const floatingDock = this.createFloatingCommentDock();
        this.host.scroll.replaceChildren(root, floatingDock);
        if (this.commentDialogOpen && this.pendingCommentFocus) {
            this.pendingCommentFocus = false;
            const textarea = floatingDock.querySelector<HTMLTextAreaElement>('.qaap-pr-popover-textarea');
            textarea?.focus();
        }
    }

    /**
     * Header: back · owner/repo #N ↗ · merge / more; the title; author avatar, "updated …" and a copyable
     * `gh pr checkout N`; then base ← head with the file count and the line stats.
     */
    protected createHeader(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const header = document.createElement('header');
        header.className = 'qaap-pr-header';

        const top = document.createElement('div');
        top.className = 'qaap-pr-topbar';
        const back = this.createIconButton(nls.localize('qaap/pullRequests/back', 'Back to pull requests'), 'qaap-pr-icon-button', 'codicon-arrow-left');
        back.addEventListener('click', () => this.host.closePullRequestDetail());
        const crumb = document.createElement('a');
        crumb.className = 'qaap-pr-crumb';
        crumb.href = pullRequest.htmlUrl;
        crumb.target = '_blank';
        crumb.rel = 'noreferrer';
        crumb.title = nls.localize('qaap/pullRequests/openOnGithub', 'Open on GitHub');
        const repoName = document.createElement('span');
        repoName.className = 'qaap-pr-crumb-repo';
        repoName.textContent = `${pullRequest.owner}/${pullRequest.repo}`;
        const number = document.createElement('span');
        number.className = 'qaap-pr-crumb-number';
        number.textContent = `#${pullRequest.number}`;
        const externalIcon = document.createElement('span');
        externalIcon.className = 'codicon codicon-link-external qaap-pr-crumb-external';
        externalIcon.setAttribute('aria-hidden', 'true');
        crumb.append(repoName, number, externalIcon);
        const spacer = document.createElement('span');
        spacer.className = 'qaap-pr-spacer';
        const merge = this.createIconButton(
            this.merged ? nls.localize('qaap/pullRequests/merged', 'Merged') : nls.localize('qaap/pullRequests/merge', 'Merge'),
            'qaap-pr-icon-button qaap-pr-primary-action',
            this.merged ? 'codicon-git-merge' : 'codicon-git-pull-request',
        );
        merge.classList.toggle('theia-mod-merged', this.merged);
        merge.disabled = this.merged || this.merging || !this.canMerge(pullRequest);
        merge.addEventListener('click', () => {
            if (!this.merged) {
                this.mergeConfirming = !this.mergeConfirming;
                this.render();
            }
        });
        const chat = this.createIconButton(nls.localize('qaap/pullRequests/openChat', 'Open chat'), 'qaap-pr-icon-button', 'codicon-comment-discussion');
        chat.addEventListener('click', () => this.openChat());
        top.append(back, crumb, spacer, merge, chat);

        const title = document.createElement('h1');
        title.className = 'qaap-pr-title';
        title.textContent = pullRequest.title;
        title.title = pullRequest.title;

        const byline = document.createElement('div');
        byline.className = 'qaap-pr-byline';
        const person = document.createElement('span');
        person.className = 'qaap-pr-person';
        person.append(this.createAvatar(pullRequest.author, pullRequest.authorAvatarUrl));
        const author = document.createElement('span');
        author.className = 'qaap-pr-author';
        author.textContent = pullRequest.author;
        const updated = document.createElement('span');
        updated.className = 'qaap-pr-muted';
        updated.textContent = `· ${nls.localize('qaap/pullRequests/updated', 'updated {0}', this.formatCompactRelativeTime(pullRequest.updatedAt))}`;
        updated.title = new Date(pullRequest.updatedAt).toLocaleString();
        person.append(author, updated);
        const checkout = document.createElement('button');
        checkout.type = 'button';
        checkout.className = 'qaap-pr-checkout';
        const checkoutCommand = `gh pr checkout ${pullRequest.number}`;
        checkout.textContent = checkoutCommand;
        checkout.title = nls.localize('qaap/pullRequests/copyCheckout', 'Copy the checkout command');
        checkout.addEventListener('click', () => {
            void navigator.clipboard?.writeText(checkoutCommand).then(() => {
                this.notice = nls.localize('qaap/pullRequests/checkoutCopied', 'Copied: {0}', checkoutCommand);
                this.render();
            }, () => undefined);
        });
        byline.append(person, checkout);

        const branches = document.createElement('div');
        branches.className = 'qaap-pr-branches';
        const refs = document.createElement('span');
        refs.className = 'qaap-pr-refs';
        refs.textContent = `${pullRequest.base}  ←  ${pullRequest.branch}`;
        refs.title = `${pullRequest.branch} → ${pullRequest.base}`;
        const stats = document.createElement('span');
        stats.className = 'qaap-pr-diffstat';
        const fileIcon = document.createElement('span');
        fileIcon.className = 'codicon codicon-diff';
        fileIcon.setAttribute('aria-hidden', 'true');
        const files = document.createElement('span');
        files.textContent = nls.localize('qaap/pullRequests/fileCount', '{0} files', String(pullRequest.files));
        const adds = document.createElement('span');
        adds.className = 'qaap-pr-adds';
        adds.textContent = `+${pullRequest.adds}`;
        const dels = document.createElement('span');
        dels.className = 'qaap-pr-dels';
        dels.textContent = `−${pullRequest.dels}`;
        stats.append(fileIcon, files, adds, dels);
        branches.append(refs, stats);

        header.append(top, title, byline, branches);
        return header;
    }

    /** "just now", "14m ago", "3h ago", "2d ago", then the date: short enough for the header byline. */
    protected formatCompactRelativeTime(iso: string): string {
        const then = Date.parse(iso);
        if (!Number.isFinite(then)) {
            return '';
        }
        const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
        if (minutes < 1) {
            return nls.localize('qaap/pullRequests/justNow', 'just now');
        }
        if (minutes < 60) {
            return nls.localize('qaap/pullRequests/minutesAgo', '{0}m ago', String(minutes));
        }
        const hours = Math.round(minutes / 60);
        if (hours < 24) {
            return nls.localize('qaap/pullRequests/hoursAgo', '{0}h ago', String(hours));
        }
        const days = Math.round(hours / 24);
        if (days < 30) {
            return nls.localize('qaap/pullRequests/daysAgo', '{0}d ago', String(days));
        }
        return new Date(then).toLocaleDateString();
    }

    /** Avatar image with an initials fallback (also used when the image fails to load). */
    protected createAvatar(login: string | undefined, url: string | undefined): HTMLElement {
        const avatar = document.createElement('span');
        avatar.className = 'qaap-pr-avatar';
        avatar.textContent = (login ?? '?').slice(0, 1).toUpperCase();
        if (url) {
            const image = document.createElement('img');
            image.alt = '';
            image.loading = 'lazy';
            image.src = url;
            image.addEventListener('error', () => image.remove(), { once: true });
            avatar.append(image);
        }
        return avatar;
    }

    /** Segmented Summary / Timeline / Code, with the checks roll-up on the right. */
    protected createTabBar(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'qaap-pr-tabbar';
        const tabs = document.createElement('div');
        tabs.className = 'qaap-pr-tabs';
        tabs.setAttribute('role', 'tablist');
        for (const [id, label] of [
            ['summary', nls.localize('qaap/pullRequests/summary', 'Summary')],
            ['timeline', nls.localize('qaap/pullRequests/timeline', 'Timeline')],
            ['code', nls.localize('qaap/pullRequests/code', 'Code')],
        ] as const) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'qaap-pr-tab';
            tab.textContent = label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(this.activeTab === id));
            tab.classList.toggle('theia-mod-active', this.activeTab === id);
            tab.addEventListener('click', () => {
                this.activeTab = id;
                this.render();
            });
            tabs.append(tab);
        }
        bar.append(tabs, this.createChecksRollup(pullRequest));
        return bar;
    }

    protected createChecksRollup(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const rollup = document.createElement('span');
        rollup.className = 'qaap-pr-checks-rollup';
        const checks = pullRequest.checks ?? [];
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        if (checks.length === 0) {
            icon.className = `codicon ${this.checkIconClass(pullRequest.tests)}`;
            rollup.classList.add(`theia-mod-${pullRequest.tests}`);
            label.textContent = this.checkLabel(pullRequest);
        } else {
            const running = checks.filter(check => check.status !== 'completed').length;
            const failing = checks.filter(check => check.status === 'completed' && this.checkFailed(check)).length;
            if (running > 0) {
                icon.className = 'codicon codicon-circle-large-outline';
                rollup.classList.add('theia-mod-pending');
                label.textContent = nls.localize('qaap/pullRequests/checksRunning', '{0} of {1} running', String(running), String(checks.length));
            } else if (failing > 0) {
                icon.className = 'codicon codicon-error';
                rollup.classList.add('theia-mod-failing');
                label.textContent = nls.localize('qaap/pullRequests/checksFailing', '{0} of {1} failing', String(failing), String(checks.length));
            } else {
                icon.className = 'codicon codicon-pass';
                rollup.classList.add('theia-mod-passing');
                label.textContent = nls.localize('qaap/pullRequests/checksPassed', 'All {0} checks passed', String(checks.length));
            }
        }
        rollup.append(icon, label);
        return rollup;
    }

    protected checkFailed(check: QaapGithubPullRequestCheck): boolean {
        return check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'cancelled' || check.conclusion === 'action_required';
    }

    protected checkIconClass(tests: QaapGithubPullRequestSummary['tests']): string {
        return tests === 'passing' ? 'codicon-pass' : tests === 'failing' ? 'codicon-error' : 'codicon-circle-large-outline';
    }

    protected createSummaryView(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const content = document.createElement('div');
        content.className = 'theia-mobile-work-hub-pull-request-detail-content qaap-pr-summary';
        content.append(this.createPeopleRows(pullRequest));
        const edit = this.createIconButton(
            this.descriptionEditing ? nls.localize('qaap/pullRequests/saveDescription', 'Save') : nls.localize('qaap/pullRequests/editDescription', 'Edit'),
            'qaap-pr-icon-button qaap-pr-section-action',
            this.descriptionEditing ? 'codicon-check' : 'codicon-edit',
        );
        edit.addEventListener('click', event => {
            event.stopPropagation();
            this.descriptionEditing = !this.descriptionEditing;
            this.descriptionExpanded = true;
            this.notice = this.descriptionEditing ? '' : nls.localize('qaap/pullRequests/descriptionSaved', 'Description updated.');
            this.render();
        });
        content.append(this.createCollapsibleSection(
            nls.localize('qaap/pullRequests/description', 'Description'),
            this.descriptionExpanded,
            expanded => {
                this.descriptionExpanded = expanded;
                this.render();
            },
            this.createDescriptionContent(),
            edit,
        ));
        content.append(this.createCollapsibleSection(
            nls.localize('qaap/pullRequests/checks', 'Checks'),
            this.checksExpanded,
            expanded => {
                this.checksExpanded = expanded;
                this.render();
            },
            this.createChecksContent(pullRequest),
        ));
        return content;
    }

    /** Reviewers and Labels rows: people / chips, or "None", with a quiet trailing action icon. */
    protected createPeopleRows(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const rows = document.createElement('div');
        rows.className = 'qaap-pr-rows';

        const reviewers = document.createElement('div');
        reviewers.className = 'qaap-pr-row';
        reviewers.append(this.createRowLabel('codicon-person', nls.localize('qaap/pullRequests/reviewers', 'Reviewers')));
        const reviewerValue = document.createElement('div');
        reviewerValue.className = 'qaap-pr-row-value';
        const people = new Map<string, { login: string; avatarUrl?: string; state?: string }>();
        for (const review of pullRequest.reviews ?? []) {
            people.set(review.login, review);
        }
        for (const requested of pullRequest.requestedReviewers ?? []) {
            if (!people.has(requested.login)) {
                people.set(requested.login, requested);
            }
        }
        if (people.size === 0) {
            reviewerValue.append(this.createMuted(this.reviewerRequested
                ? nls.localize('qaap/pullRequests/reviewerRequested', 'Requested')
                : nls.localize('qaap/pullRequests/none', 'None')));
        }
        for (const person of people.values()) {
            const chip = document.createElement('span');
            chip.className = 'qaap-pr-person-chip';
            if (person.state) {
                chip.classList.add(`theia-mod-${person.state}`);
                chip.title = person.state.replace('_', ' ');
            }
            chip.append(this.createAvatar(person.login, person.avatarUrl), document.createTextNode(person.login));
            reviewerValue.append(chip);
        }
        const requestReviewer = this.createIconButton(nls.localize('qaap/pullRequests/requestReviewer', 'Request a reviewer'), 'qaap-pr-icon-button qaap-pr-row-action', 'codicon-person-add');
        requestReviewer.addEventListener('click', () => {
            window.open(`${pullRequest.htmlUrl}`, '_blank', 'noopener,noreferrer');
        });
        reviewerValue.append(requestReviewer);
        reviewers.append(reviewerValue);

        const labels = document.createElement('div');
        labels.className = 'qaap-pr-row';
        labels.append(this.createRowLabel('codicon-tag', nls.localize('qaap/pullRequests/labels', 'Labels')));
        const labelValue = document.createElement('div');
        labelValue.className = 'qaap-pr-row-value';
        const labelList = pullRequest.labels ?? [];
        if (labelList.length === 0) {
            labelValue.append(this.createMuted(nls.localize('qaap/pullRequests/none', 'None')));
        }
        for (const label of labelList) {
            const chip = document.createElement('span');
            chip.className = 'qaap-pr-label';
            chip.textContent = label.name;
            if (label.color && /^[0-9a-f]{6}$/i.test(label.color)) {
                chip.style.setProperty('--qaap-pr-label-color', `#${label.color}`);
            }
            labelValue.append(chip);
        }
        const addLabel = this.createIconButton(nls.localize('qaap/pullRequests/editLabels', 'Edit labels'), 'qaap-pr-icon-button qaap-pr-row-action', 'codicon-tag');
        addLabel.addEventListener('click', () => window.open(pullRequest.htmlUrl, '_blank', 'noopener,noreferrer'));
        labelValue.append(addLabel);
        labels.append(labelValue);

        rows.append(reviewers, labels);
        return rows;
    }

    protected createRowLabel(iconClass: string, text: string): HTMLElement {
        const label = document.createElement('span');
        label.className = 'qaap-pr-row-label';
        const icon = document.createElement('span');
        icon.className = `codicon ${iconClass}`;
        icon.setAttribute('aria-hidden', 'true');
        label.append(icon, document.createTextNode(text));
        return label;
    }

    protected createMuted(text: string): HTMLElement {
        const muted = document.createElement('span');
        muted.className = 'qaap-pr-muted';
        muted.textContent = text;
        return muted;
    }

    /** Timeline tab: GitHub's issue timeline (commits, comments, reviews, labels, merges), oldest first. */
    protected createTimelineView(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const list = document.createElement('ol');
        list.className = 'qaap-pr-timeline';
        const events: QaapGithubPullRequestTimelineEvent[] = [
            { kind: 'other', actor: pullRequest.author, actorAvatarUrl: pullRequest.authorAvatarUrl, text: undefined },
            ...(pullRequest.timeline ?? []),
            ...this.localTimelineEntries,
        ];
        for (const event of events) {
            const item = document.createElement('li');
            item.className = `qaap-pr-timeline-item theia-mod-${event.kind}`;
            const marker = document.createElement('span');
            marker.className = `qaap-pr-timeline-marker codicon ${this.timelineIcon(event)}`;
            marker.setAttribute('aria-hidden', 'true');
            const body = document.createElement('div');
            body.className = 'qaap-pr-timeline-body';
            const line = document.createElement('div');
            line.className = 'qaap-pr-timeline-line';
            if (event.actor) {
                const actor = document.createElement('strong');
                actor.textContent = event.actor;
                line.append(actor, document.createTextNode(' '));
            }
            line.append(document.createTextNode(this.timelineVerb(event)));
            if (event.createdAt) {
                const when = document.createElement('span');
                when.className = 'qaap-pr-muted';
                when.textContent = ` · ${this.formatRelativeTime(event.createdAt)}`;
                line.append(when);
            }
            body.append(line);
            if (event.text && (event.kind === 'commented' || event.kind === 'reviewed')) {
                const bubble = document.createElement('div');
                bubble.className = 'qaap-pr-timeline-bubble theia-mobile-work-hub-pull-request-description-text';
                bubble.innerHTML = this.descriptionMarkdown.render(event.text);
                body.append(bubble);
            }
            item.append(marker, body);
            list.append(item);
        }
        return list;
    }

    protected timelineIcon(event: QaapGithubPullRequestTimelineEvent): string {
        switch (event.kind) {
            case 'committed': case 'head_ref_force_pushed': return 'codicon-git-commit';
            case 'commented': return 'codicon-comment';
            case 'reviewed': return event.reviewState === 'approved' ? 'codicon-pass' : event.reviewState === 'changes_requested' ? 'codicon-request-changes' : 'codicon-eye';
            case 'labeled': case 'unlabeled': return 'codicon-tag';
            case 'merged': return 'codicon-git-merge';
            case 'closed': return 'codicon-circle-slash';
            case 'reopened': case 'ready_for_review': return 'codicon-git-pull-request';
            case 'review_requested': return 'codicon-person-add';
            case 'renamed': return 'codicon-edit';
            default: return 'codicon-git-pull-request';
        }
    }

    protected timelineVerb(event: QaapGithubPullRequestTimelineEvent): string {
        switch (event.kind) {
            case 'committed': return nls.localize('qaap/pullRequests/tlCommitted', 'committed {0}', event.text ?? '');
            case 'commented': return nls.localize('qaap/pullRequests/tlCommented', 'commented');
            case 'reviewed': return event.reviewState === 'approved' ? nls.localize('qaap/pullRequests/tlApproved', 'approved these changes')
                : event.reviewState === 'changes_requested' ? nls.localize('qaap/pullRequests/tlChanges', 'requested changes')
                    : nls.localize('qaap/pullRequests/tlReviewed', 'reviewed');
            case 'labeled': return nls.localize('qaap/pullRequests/tlLabeled', 'added the {0} label', event.text ?? '');
            case 'unlabeled': return nls.localize('qaap/pullRequests/tlUnlabeled', 'removed the {0} label', event.text ?? '');
            case 'merged': return nls.localize('qaap/pullRequests/tlMerged', 'merged this pull request');
            case 'closed': return nls.localize('qaap/pullRequests/tlClosed', 'closed this pull request');
            case 'reopened': return nls.localize('qaap/pullRequests/tlReopened', 'reopened this pull request');
            case 'review_requested': return nls.localize('qaap/pullRequests/tlReviewRequested', 'requested a review');
            case 'ready_for_review': return nls.localize('qaap/pullRequests/tlReady', 'marked this ready for review');
            case 'convert_to_draft': return nls.localize('qaap/pullRequests/tlDraft', 'converted this to a draft');
            case 'head_ref_force_pushed': return nls.localize('qaap/pullRequests/tlForcePushed', 'force-pushed the branch');
            case 'renamed': return nls.localize('qaap/pullRequests/tlRenamed', 'changed the title to {0}', event.text ?? '');
            default: return nls.localize('qaap/pullRequests/tlOpened', 'opened this pull request');
        }
    }

    protected createMetadata(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const metadata = document.createElement('div');
        metadata.className = 'theia-mobile-work-hub-pull-request-metadata';
        metadata.append(
            this.createMetadataRow('codicon-git-branch', nls.localize('qaap/pullRequests/branch', 'Branch'), `${pullRequest.branch}  ›  ${pullRequest.base}`),
            this.createReviewerRow(),
            this.createMetadataRow('codicon-comment-discussion', nls.localize('qaap/pullRequests/comments', 'Comments'), nls.localize('qaap/pullRequests/commentCount', '{0} comments', String(this.comments.length))),
            this.createMetadataRow('codicon-check', nls.localize('qaap/pullRequests/ci', 'Checks'), this.checkLabel(pullRequest)),
            this.createMetadataRow('codicon-git-pull-request', nls.localize('qaap/pullRequests/status', 'Status'), this.statusLabel(pullRequest)),
        );
        return metadata;
    }

    protected createMetadataRow(iconClass: string, labelText: string, valueText: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-work-hub-pull-request-metadata-row';
        const icon = document.createElement('span');
        icon.className = `codicon ${iconClass}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-work-hub-pull-request-metadata-label';
        label.textContent = labelText;
        const value = document.createElement('span');
        value.className = 'theia-mobile-work-hub-pull-request-metadata-value';
        value.textContent = valueText;
        row.append(icon, label, value);
        return row;
    }

    protected createReviewerRow(): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-work-hub-pull-request-metadata-row';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-account';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-work-hub-pull-request-metadata-label';
        label.textContent = nls.localize('qaap/pullRequests/reviewers', 'Reviewers');
        const request = this.createButton(
            this.reviewerRequested
                ? nls.localize('qaap/pullRequests/reviewerRequested', 'Requested')
                : nls.localize('qaap/pullRequests/requestReviewer', '+ Request'),
            'theia-mobile-work-hub-pull-request-request-reviewer',
        );
        request.addEventListener('click', () => {
            this.reviewerRequested = true;
            this.notice = nls.localize('qaap/pullRequests/reviewerNotice', 'Reviewer request added.');
            this.render();
        });
        row.append(icon, label, request);
        return row;
    }

    protected createDescriptionContent(): HTMLElement {
        const body = document.createElement('div');
        body.className = 'theia-mobile-work-hub-pull-request-description';
        // Edit / Save lives in the section header (pencil); this only renders the text or the editor.
        if (this.descriptionEditing) {
            const textarea = document.createElement('textarea');
            textarea.className = 'theia-mobile-work-hub-pull-request-description-editor';
            textarea.value = this.description;
            textarea.rows = 5;
            textarea.setAttribute('aria-label', nls.localize('qaap/pullRequests/descriptionEditor', 'Pull request description'));
            textarea.addEventListener('input', () => {
                this.description = textarea.value;
            });
            body.append(textarea);
        } else {
            const text = document.createElement('div');
            text.className = 'theia-mobile-work-hub-pull-request-description-text';
            text.innerHTML = this.descriptionMarkdown.render(this.description);
            body.append(text);
        }
        return body;
    }

    /** One row per check run / status: state icon, name (links to its details) and Passed / Failed / Running. */
    protected createChecksContent(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-pull-request-checks qaap-pr-checks';
        const checks = pullRequest.checks ?? [];
        if (checks.length === 0) {
            const row = document.createElement('div');
            row.className = 'qaap-pr-check';
            const icon = document.createElement('span');
            icon.className = `qaap-pr-check-icon codicon ${this.checkIconClass(pullRequest.tests)} theia-mod-${pullRequest.tests}`;
            icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'qaap-pr-check-name';
            name.textContent = this.checkLabel(pullRequest);
            row.append(icon, name);
            list.append(row);
            return list;
        }
        const order = (check: QaapGithubPullRequestCheck): number => check.status !== 'completed' ? 0 : this.checkFailed(check) ? 1 : 2;
        for (const check of [...checks].sort((left, right) => order(left) - order(right) || left.name.localeCompare(right.name))) {
            const row = document.createElement(check.url ? 'a' : 'div');
            row.className = 'qaap-pr-check';
            if (check.url && row instanceof HTMLAnchorElement) {
                row.href = check.url;
                row.target = '_blank';
                row.rel = 'noreferrer';
            }
            const running = check.status !== 'completed';
            const failed = !running && this.checkFailed(check);
            const skipped = !running && (check.conclusion === 'skipped' || check.conclusion === 'neutral');
            const icon = document.createElement('span');
            icon.className = `qaap-pr-check-icon codicon ${running ? 'codicon-circle-large-outline theia-mod-pending'
                : failed ? 'codicon-error theia-mod-failing' : skipped ? 'codicon-circle-slash theia-mod-skipped' : 'codicon-pass theia-mod-passing'}`;
            icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'qaap-pr-check-name';
            name.textContent = check.name;
            const state = document.createElement('span');
            state.className = 'qaap-pr-check-state';
            state.textContent = running ? nls.localize('qaap/pullRequests/checkRunning', 'Running')
                : failed ? nls.localize('qaap/pullRequests/checkFailed', 'Failed')
                    : skipped ? nls.localize('qaap/pullRequests/checkSkipped', 'Skipped')
                        : nls.localize('qaap/pullRequests/checkPassed', 'Passed');
            row.append(icon, name, state);
            list.append(row);
        }
        return list;
    }

    protected createActivityContent(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const activity = document.createElement('div');
        activity.className = 'theia-mobile-work-hub-pull-request-activity';
        const entries = [
            nls.localize('qaap/pullRequests/activityOpened', '@{0} opened this pull request', pullRequest.author),
            nls.localize('qaap/pullRequests/activityBranch', 'Changes pushed to {0}', pullRequest.branch),
        ];
        for (const comment of this.comments) {
            entries.push(nls.localize('qaap/pullRequests/activityComment', 'You commented: {0}', comment));
        }
        for (const entry of entries) {
            const item = document.createElement('div');
            item.className = 'theia-mobile-work-hub-pull-request-activity-item';
            item.textContent = entry;
            activity.append(item);
        }

        return activity;
    }

    protected disposePopoverListeners(): void {
        this.popoverListenersCleanup?.();
        this.popoverListenersCleanup = undefined;
    }

    protected canSubmitCommentDialog(): boolean {
        if (this.commentDialogMode === 'review' && this.reviewVerdict === 'approve') {
            return true;
        }
        return this.commentDraft.trim().length > 0;
    }

    protected submitCommentDialog(): void {
        if (!this.canSubmitCommentDialog()) {
            return;
        }
        const value = this.commentDraft.trim();
        const you = nls.localize('qaap/pullRequests/you', 'You');
        const createdAt = new Date().toISOString();
        if (this.commentDialogMode === 'review') {
            const reviewState: QaapGithubPullRequestTimelineEvent['reviewState'] = this.reviewVerdict === 'approve'
                ? 'approved'
                : this.reviewVerdict === 'request_changes'
                    ? 'changes_requested'
                    : 'commented';
            this.localTimelineEntries.push({
                kind: 'reviewed',
                actor: you,
                reviewState,
                text: value || undefined,
                createdAt,
            });
            if (value) {
                this.comments.push(value);
            }
            this.notice = this.reviewVerdict === 'approve'
                ? nls.localize('qaap/pullRequests/reviewApprovedAdded', 'Approval added to the timeline.')
                : this.reviewVerdict === 'request_changes'
                    ? nls.localize('qaap/pullRequests/reviewChangesAdded', 'Change request added to the timeline.')
                    : nls.localize('qaap/pullRequests/reviewCommentAdded', 'Review comment added to the timeline.');
            this.reviewVerdict = 'comment';
        } else {
            this.comments.push(value);
            this.localTimelineEntries.push({
                kind: 'commented',
                actor: you,
                text: value,
                createdAt,
            });
            this.notice = nls.localize('qaap/pullRequests/commentAdded', 'Comment added to the activity.');
        }
        this.commentDraft = '';
        this.commentDialogOpen = false;
        this.render();
    }

    /** Floating bottom-right comment trigger button with an anchored Comment / Review popover dialog. */
    protected createFloatingCommentDock(): HTMLElement {
        const dock = document.createElement('div');
        dock.className = 'qaap-pr-floating-dock';

        const anchor = document.createElement('div');
        anchor.className = 'qaap-pr-floating-anchor';

        if (this.commentDialogOpen) {
            anchor.append(this.createCommentPopover());
            const handleKeyDown = (event: KeyboardEvent): void => {
                if (event.key === 'Escape' && this.commentDialogOpen) {
                    event.preventDefault();
                    this.commentDialogOpen = false;
                    this.render();
                }
            };
            const handlePointerDown = (event: Event): void => {
                if (!this.commentDialogOpen) {
                    return;
                }
                const target = event.target;
                if (target instanceof Node && !anchor.contains(target)) {
                    this.commentDialogOpen = false;
                    this.render();
                }
            };
            document.addEventListener('keydown', handleKeyDown);
            document.addEventListener('pointerdown', handlePointerDown);
            this.popoverListenersCleanup = () => {
                document.removeEventListener('keydown', handleKeyDown);
                document.removeEventListener('pointerdown', handlePointerDown);
            };
        }

        const triggerLabel = this.commentDialogOpen
            ? nls.localize('qaap/pullRequests/closeCommentDialog', 'Close comment dialog')
            : nls.localize('qaap/pullRequests/openCommentDialog', 'Leave a comment or review');
        const fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'qaap-pr-fab';
        fab.classList.toggle('theia-mod-open', this.commentDialogOpen);
        fab.classList.toggle('theia-mod-has-draft', !this.commentDialogOpen && this.commentDraft.trim().length > 0);
        fab.title = triggerLabel;
        fab.setAttribute('aria-label', triggerLabel);
        fab.setAttribute('aria-haspopup', 'dialog');
        fab.setAttribute('aria-expanded', String(this.commentDialogOpen));
        const fabIcon = document.createElement('span');
        fabIcon.className = 'codicon codicon-comment';
        fabIcon.setAttribute('aria-hidden', 'true');
        fab.append(fabIcon);
        fab.addEventListener('click', () => {
            this.commentDialogOpen = !this.commentDialogOpen;
            this.pendingCommentFocus = this.commentDialogOpen;
            this.render();
        });

        anchor.append(fab);
        dock.append(anchor);
        return dock;
    }

    protected createCommentPopover(): HTMLElement {
        const dialog = document.createElement('div');
        dialog.className = 'qaap-pr-comment-popover';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', nls.localize('qaap/pullRequests/commentDialogLabel', 'Comment or review pull request'));

        const head = document.createElement('div');
        head.className = 'qaap-pr-popover-head';

        const tabs = document.createElement('div');
        tabs.className = 'qaap-pr-popover-tabs';
        tabs.setAttribute('role', 'tablist');
        for (const [mode, label] of [
            ['comment', nls.localizeByDefault('Comment')],
            ['review', nls.localizeByDefault('Review')],
        ] as const) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'qaap-pr-popover-tab';
            tab.dataset.mode = mode;
            tab.textContent = label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(this.commentDialogMode === mode));
            tab.classList.toggle('theia-mod-active', this.commentDialogMode === mode);
            tab.addEventListener('click', () => {
                if (this.commentDialogMode !== mode) {
                    this.commentDialogMode = mode;
                    this.pendingCommentFocus = true;
                    this.render();
                }
            });
            tabs.append(tab);
        }

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'qaap-pr-popover-close';
        const closeLabel = nls.localizeByDefault('Close');
        close.title = closeLabel;
        close.setAttribute('aria-label', closeLabel);
        const closeIcon = document.createElement('span');
        closeIcon.className = 'codicon codicon-close';
        closeIcon.setAttribute('aria-hidden', 'true');
        close.append(closeIcon);
        close.addEventListener('click', () => {
            this.commentDialogOpen = false;
            this.render();
        });
        head.append(tabs, close);

        const textarea = document.createElement('textarea');
        textarea.className = 'qaap-pr-popover-textarea';
        textarea.placeholder = this.commentDialogMode === 'review'
            ? nls.localize('qaap/pullRequests/reviewPlaceholder', 'Leave a review comment')
            : nls.localize('qaap/pullRequests/commentPlaceholder', 'Leave a comment');
        textarea.value = this.commentDraft;
        textarea.rows = 3;
        textarea.setAttribute('aria-label', textarea.placeholder);

        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'qaap-pr-popover-submit';
        const submitIcon = document.createElement('span');
        submitIcon.className = `codicon ${this.commentDialogMode === 'review' ? 'codicon-check' : 'codicon-send'}`;
        submitIcon.setAttribute('aria-hidden', 'true');
        const submitLabel = document.createElement('span');
        submitLabel.textContent = this.commentDialogMode === 'review'
            ? nls.localize('qaap/pullRequests/submitReview', 'Submit review')
            : nls.localizeByDefault('Comment');
        submit.append(submitIcon, submitLabel);
        const syncSubmitDisabled = (): void => {
            submit.disabled = !this.canSubmitCommentDialog();
        };
        syncSubmitDisabled();
        submit.addEventListener('click', () => this.submitCommentDialog());

        textarea.addEventListener('input', () => {
            this.commentDraft = textarea.value;
            syncSubmitDisabled();
        });
        textarea.addEventListener('keydown', event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                this.submitCommentDialog();
            }
        });

        dialog.append(head, textarea);

        if (this.commentDialogMode === 'review') {
            const verdicts = document.createElement('div');
            verdicts.className = 'qaap-pr-popover-verdicts';
            verdicts.setAttribute('role', 'radiogroup');
            verdicts.setAttribute('aria-label', nls.localize('qaap/pullRequests/reviewVerdict', 'Review verdict'));
            const verdictButtons: HTMLButtonElement[] = [];
            for (const [verdict, iconClass, label] of [
                ['approve', 'codicon-pass', nls.localize('qaap/pullRequests/verdictApprove', 'Approve')],
                ['comment', 'codicon-comment', nls.localizeByDefault('Comment')],
                ['request_changes', 'codicon-request-changes', nls.localizeByDefault('Changes')],
            ] as const) {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = `qaap-pr-popover-verdict theia-mod-${verdict}`;
                option.dataset.verdict = verdict;
                option.setAttribute('role', 'radio');
                option.setAttribute('aria-checked', String(this.reviewVerdict === verdict));
                option.classList.toggle('theia-mod-active', this.reviewVerdict === verdict);
                const icon = document.createElement('span');
                icon.className = `codicon ${iconClass}`;
                icon.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.textContent = label;
                option.append(icon, text);
                option.addEventListener('click', () => {
                    this.reviewVerdict = verdict;
                    for (const candidate of verdictButtons) {
                        const active = candidate.dataset.verdict === verdict;
                        candidate.classList.toggle('theia-mod-active', active);
                        candidate.setAttribute('aria-checked', String(active));
                    }
                    syncSubmitDisabled();
                });
                verdictButtons.push(option);
                verdicts.append(option);
            }
            dialog.append(verdicts);
        }

        const actions = document.createElement('div');
        actions.className = 'qaap-pr-popover-actions';
        actions.append(submit);
        dialog.append(actions);
        return dialog;
    }

    protected createCodeView(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const code = document.createElement('div');
        code.className = 'theia-mobile-work-hub-pull-request-code';
        const intro = document.createElement('p');
        intro.className = 'theia-mobile-work-hub-pull-request-code-summary';
        intro.textContent = nls.localize(
            'qaap/pullRequests/codeSummary',
            '{0} files changed · +{1} -{2}',
            String(pullRequest.files),
            String(pullRequest.adds),
            String(pullRequest.dels),
        );
        code.append(intro);
        if (pullRequest.filesPreview.length === 0) {
            code.append(this.createEmptyCodeState());
            return code;
        }
        for (const file of pullRequest.filesPreview) {
            code.append(this.createFilePreview(file));
        }
        return code;
    }

    protected createFilePreview(file: QaapGithubPullRequestFile): HTMLElement {
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-pull-request-file';
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'theia-mobile-work-hub-pull-request-file-header';
        const chevron = document.createElement('span');
        chevron.className = `codicon ${this.expandedFiles.has(file.f) ? 'codicon-chevron-down' : 'codicon-chevron-right'}`;
        chevron.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'theia-mobile-work-hub-pull-request-file-name';
        name.textContent = file.f;
        const stats = document.createElement('span');
        stats.className = 'theia-mobile-work-hub-pull-request-file-stats';
        stats.textContent = `+${file.adds} -${file.dels}`;
        header.append(chevron, name, stats);
        header.setAttribute('aria-expanded', String(this.expandedFiles.has(file.f)));
        header.addEventListener('click', () => {
            if (this.expandedFiles.has(file.f)) {
                this.expandedFiles.delete(file.f);
            } else {
                this.expandedFiles.add(file.f);
            }
            this.render();
        });
        section.append(header);
        if (this.expandedFiles.has(file.f)) {
            const lines = document.createElement('div');
            lines.className = 'theia-mobile-work-hub-pull-request-diff';
            for (const line of file.preview) {
                const row = document.createElement('div');
                row.className = `theia-mobile-work-hub-pull-request-diff-line theia-mod-${line.t}`;
                const number = document.createElement('span');
                number.className = 'theia-mobile-work-hub-pull-request-diff-number';
                number.textContent = String(line.n);
                const text = document.createElement('code');
                text.textContent = `${line.t === 'add' ? '+' : line.t === 'del' ? '-' : ' '} ${line.s}`;
                row.append(number, text);
                lines.append(row);
            }
            section.append(lines);
        }
        return section;
    }

    protected createEmptyCodeState(): HTMLElement {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-work-hub-pull-request-empty-code';
        empty.textContent = nls.localize('qaap/pullRequests/noCodePreview', 'No code preview is available.');
        return empty;
    }

    protected createBranchSummary(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const branch = document.createElement('div');
        branch.className = 'theia-mobile-work-hub-pull-request-branch-summary';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-git-branch';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = `${pullRequest.branch}  ›  ${pullRequest.base}`;
        const stats = document.createElement('span');
        stats.className = 'theia-mobile-work-hub-pull-request-branch-stats';
        stats.textContent = `+${pullRequest.adds} -${pullRequest.dels}`;
        branch.append(icon, text, stats);
        return branch;
    }

    protected createCollapsibleSection(
        titleText: string,
        expanded: boolean,
        onToggle: (expanded: boolean) => void,
        content: HTMLElement,
        action?: HTMLElement,
    ): HTMLElement {
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-pull-request-section qaap-pr-section';
        const head = document.createElement('div');
        head.className = 'qaap-pr-section-head';
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'theia-mobile-work-hub-pull-request-section-header qaap-pr-section-toggle';
        const title = document.createElement('span');
        title.className = 'qaap-pr-section-title';
        title.textContent = titleText;
        const chevron = document.createElement('span');
        chevron.className = `codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`;
        chevron.setAttribute('aria-hidden', 'true');
        header.append(title, chevron);
        header.setAttribute('aria-expanded', String(expanded));
        header.addEventListener('click', () => onToggle(!expanded));
        head.append(header);
        if (action) {
            head.append(action);
        }
        section.append(head);
        if (expanded) {
            section.append(content);
        }
        return section;
    }

    protected createMergeConfirmation(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const confirmation = document.createElement('div');
        confirmation.className = 'theia-mobile-work-hub-pull-request-merge-confirmation';
        const text = document.createElement('span');
        text.textContent = nls.localize('qaap/pullRequests/mergeConfirm', 'Merge this pull request into {0}?', pullRequest.base);
        const cancel = this.createButton(nls.localize('qaap/pullRequests/cancel', 'Cancel'), 'theia-mobile-work-hub-pull-request-cancel-button');
        cancel.addEventListener('click', () => {
            this.mergeConfirming = false;
            this.render();
        });
        const confirm = this.createButton(nls.localize('qaap/pullRequests/confirmMerge', 'Confirm merge'), 'theia-mobile-work-hub-pull-request-confirm-button');
        confirm.disabled = this.merging;
        confirm.addEventListener('click', () => void this.mergePullRequest(pullRequest));
        confirmation.append(text, cancel, confirm);
        return confirmation;
    }

    protected async mergePullRequest(pullRequest: QaapGithubPullRequestSummary): Promise<void> {
        if (this.merging) {
            return;
        }
        this.merging = true;
        this.notice = nls.localize('qaap/pullRequests/merging', 'Merging pull request…');
        this.render();
        try {
            const response = await mergeQaapGithubPullRequest({
                owner: pullRequest.owner,
                repo: pullRequest.repo,
                number: pullRequest.number,
            });
            this.merged = response.merged;
            this.mergeConfirming = false;
            this.notice = response.message || nls.localize('qaap/pullRequests/mergedNotice', 'Pull request merged.');
            if (response.merged) {
                this.host.onPullRequestMerged?.(pullRequest);
            }
            await this.host.refreshInboxPullRequests(undefined, true);
        } catch (error) {
            this.notice = error instanceof Error
                ? error.message
                : nls.localize('qaap/pullRequests/mergeFailed', 'Unable to merge pull request.');
        } finally {
            this.merging = false;
            this.render();
        }
    }

    protected createButton(label: string, className: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        return button;
    }

    protected createIconButton(label: string, className: string, iconClass: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${className} theia-mobile-work-hub-pull-request-icon-button`;
        button.title = label;
        button.setAttribute('aria-label', label);
        const icon = document.createElement('span');
        icon.className = `codicon ${iconClass}`;
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon);
        return button;
    }

    /**
     * Closed PRs cannot be merged, and a partial summary from the all-PRs search does not know its
     * mergeability yet (the detail is still loading), so the merge action waits for it.
     */
    protected canMerge(pullRequest: QaapGithubPullRequestSummary): boolean {
        return pullRequest.mergeable !== false
            && pullRequest.state !== 'closed'
            && pullRequest.state !== 'merged'
            && pullRequest.partial !== true;
    }

    protected defaultDescription(pullRequest: QaapGithubPullRequestSummary): string {
        return nls.localize(
            'qaap/pullRequests/defaultDescription',
            'Changes proposed in {0} for {1}. Review the files and checks below before merging.',
            pullRequest.branch,
            pullRequest.title,
        );
    }

    protected statusLabel(pullRequest: QaapGithubPullRequestSummary): string {
        if (this.merged || pullRequest.state === 'merged') {
            return nls.localize('qaap/pullRequests/statusMerged', 'Merged');
        }
        if (pullRequest.state === 'closed') {
            return nls.localize('qaap/pullRequests/statusClosed', 'Closed');
        }
        if (pullRequest.draft) {
            return nls.localize('qaap/pullRequests/statusDraft', 'Draft');
        }
        return nls.localize('qaap/pullRequests/statusReady', 'Ready for review');
    }

    protected checkLabel(pullRequest: QaapGithubPullRequestSummary): string {
        switch (pullRequest.tests) {
            case 'passing': return nls.localize('qaap/pullRequests/checksPassing', 'All checks passing');
            case 'failing': return nls.localize('qaap/pullRequests/checksFailing', 'Checks failing');
            case 'pending': return nls.localize('qaap/pullRequests/checksPending', 'Checks in progress');
            default: return nls.localize('qaap/pullRequests/checksUnknown', 'No CI checks reported');
        }
    }

    protected formatRelativeTime(updatedAt: string): string {
        const timestamp = Date.parse(updatedAt);
        if (!Number.isFinite(timestamp)) {
            return nls.localize('qaap/pullRequests/justNowDetail', 'recently');
        }
        const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
        if (minutes < 1) {
            return nls.localize('qaap/pullRequests/justNowDetail', 'just now');
        }
        if (minutes < 60) {
            return nls.localize('qaap/pullRequests/minutesAgoDetail', '{0} minutes ago', String(minutes));
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return nls.localize('qaap/pullRequests/hoursAgoDetail', '{0} hours ago', String(hours));
        }
        return nls.localize('qaap/pullRequests/daysAgoDetail', '{0} days ago', String(Math.floor(hours / 24)));
    }
}

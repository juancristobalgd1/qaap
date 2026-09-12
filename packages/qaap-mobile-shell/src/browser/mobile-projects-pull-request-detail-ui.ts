// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    mergeQaapGithubPullRequest,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubPullRequestFile,
    QaapGithubPullRequestSummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { nls } from '@theia/core/lib/common/nls';

export interface MobileProjectsPullRequestDetailHost {
    pullRequestDetail: QaapGithubPullRequestSummary | undefined;
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoading: boolean;
    inboxPullRequestsLoaded: boolean;
    inboxGithubSignedIn: boolean | undefined;
    scroll: HTMLElement;

    closePullRequestDetail(): void;
    refreshInboxPullRequests(projects?: import('./mobile-projects-types').MobileProjectEntry[], force?: boolean): Promise<void>;
}

export type MobileProjectsPullRequestDetailTab = 'summary' | 'code';
type PullRequestDetailTab = MobileProjectsPullRequestDetailTab;

/** Main-content pull-request detail surface opened from the sidebar navigator. */
export class MobileProjectsPullRequestDetailUi {

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
        this.notice = nls.localize(
            'qaap/pullRequests/chatNotice',
            'Use the agent composer below to discuss this pull request.',
        );
        this.render();
    }

    toggleMergeConfirmation(): void {
        const pullRequest = this.host.pullRequestDetail;
        if (!pullRequest || this.merged || this.merging || pullRequest.mergeable === false) {
            return;
        }
        this.mergeConfirming = !this.mergeConfirming;
        this.render();
    }

    renderEmpty(): void {
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
            title.textContent = nls.localize('qaap/pullRequests/noDetail', 'No pull requests yet');
            body.textContent = nls.localize('qaap/pullRequests/noDetailBody', 'Pull requests from your linked repositories will appear here.');
        }

        root.append(icon, title, body);
        this.host.scroll.replaceChildren(root);
    }

    render(): void {
        const pullRequest = this.host.pullRequestDetail;
        if (!pullRequest) {
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
            this.merged = pullRequest.state === 'merged';
            this.mergeConfirming = false;
            this.notice = '';
        }

        const root = document.createElement('div');
        root.className = 'theia-mobile-work-hub-pull-request-detail';

        const toolbar = document.createElement('div');
        toolbar.className = 'theia-mobile-work-hub-pull-request-detail-toolbar';
        const tabs = document.createElement('div');
        tabs.className = 'theia-mobile-work-hub-pull-request-detail-tabs';
        for (const tab of [
            ['summary', nls.localize('qaap/pullRequests/summary', 'Summary')],
            ['code', nls.localize('qaap/pullRequests/code', 'Code')],
        ] as const) {
            const tabButton = document.createElement('button');
            tabButton.type = 'button';
            tabButton.className = 'theia-mobile-work-hub-pull-request-detail-tab';
            tabButton.textContent = tab[1];
            tabButton.classList.toggle('theia-mod-active', this.activeTab === tab[0]);
            tabButton.setAttribute('aria-selected', String(this.activeTab === tab[0]));
            tabButton.setAttribute('role', 'tab');
            tabButton.addEventListener('click', () => {
                this.activeTab = tab[0];
                this.render();
            });
            tabs.append(tabButton);
        }
        const toolbarActions = document.createElement('div');
        toolbarActions.className = 'theia-mobile-work-hub-pull-request-detail-actions';
        const external = document.createElement('a');
        external.className = 'theia-mobile-work-hub-pull-request-detail-icon-button';
        external.href = pullRequest.htmlUrl;
        external.target = '_blank';
        external.rel = 'noreferrer';
        external.title = nls.localize('qaap/pullRequests/openOnGithub', 'Open on GitHub');
        external.setAttribute('aria-label', external.title);
        external.innerHTML = '<span class="codicon codicon-link-external" aria-hidden="true"></span>';
        const chatButton = this.createButton(
            nls.localize('qaap/pullRequests/openChat', 'Open chat'),
            'theia-mobile-work-hub-pull-request-chat-button',
        );
        chatButton.addEventListener('click', () => this.openChat());
        const mergeButton = this.createButton(
            this.merged
                ? nls.localize('qaap/pullRequests/merged', 'Merged')
                : nls.localize('qaap/pullRequests/merge', 'Merge'),
            'theia-mobile-work-hub-pull-request-merge-button',
        );
        mergeButton.disabled = this.merged || this.merging || pullRequest.mergeable === false;
        mergeButton.addEventListener('click', () => {
            if (!this.merged) {
                this.mergeConfirming = !this.mergeConfirming;
                this.render();
            }
        });
        toolbarActions.append(external, chatButton, mergeButton);
        toolbar.append(tabs, toolbarActions);
        root.append(toolbar);

        if (this.notice) {
            const notice = document.createElement('div');
            notice.className = 'theia-mobile-work-hub-pull-request-notice';
            notice.textContent = this.notice;
            root.append(notice);
        }
        if (this.mergeConfirming) {
            root.append(this.createMergeConfirmation(pullRequest));
        }

        const heading = document.createElement('div');
        heading.className = 'theia-mobile-work-hub-pull-request-heading';
        const status = document.createElement('span');
        status.className = `theia-mobile-work-hub-pull-request-detail-status ${this.merged ? 'theia-mod-merged' : 'theia-mod-open'}`;
        status.innerHTML = `<span class="codicon ${this.merged ? 'codicon-git-merge' : 'codicon-git-pull-request'}" aria-hidden="true"></span>`;
        const titleBlock = document.createElement('div');
        const title = document.createElement('h2');
        title.textContent = pullRequest.title;
        const byline = document.createElement('p');
        byline.textContent = nls.localize(
            'qaap/pullRequests/byline',
            'Opened by @{0} · {1}',
            pullRequest.author,
            this.formatRelativeTime(pullRequest.updatedAt),
        );
        titleBlock.append(title, byline);
        heading.append(status, titleBlock);
        root.append(heading);

        root.append(this.createBranchSummary(pullRequest));
        if (this.activeTab === 'code') {
            root.append(this.createCodeView(pullRequest));
        } else {
            root.append(this.createSummaryView(pullRequest));
        }
        this.host.scroll.replaceChildren(root);
    }

    protected createSummaryView(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const content = document.createElement('div');
        content.className = 'theia-mobile-work-hub-pull-request-detail-content';
        content.append(this.createMetadata(pullRequest));
        content.append(this.createCollapsibleSection(
            nls.localize('qaap/pullRequests/description', 'Description'),
            this.descriptionExpanded,
            expanded => {
                this.descriptionExpanded = expanded;
                this.render();
            },
            this.createDescriptionContent(),
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
        content.append(this.createCollapsibleSection(
            nls.localize('qaap/pullRequests/activity', 'Activity'),
            this.activityExpanded,
            expanded => {
                this.activityExpanded = expanded;
                this.render();
            },
            this.createActivityContent(pullRequest),
        ));
        return content;
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
        const edit = this.createButton(
            this.descriptionEditing
                ? nls.localize('qaap/pullRequests/saveDescription', 'Save')
                : nls.localize('qaap/pullRequests/editDescription', 'Edit'),
            'theia-mobile-work-hub-pull-request-edit-button',
        );
        edit.addEventListener('click', () => {
            if (this.descriptionEditing) {
                this.descriptionEditing = false;
                this.notice = nls.localize('qaap/pullRequests/descriptionSaved', 'Description updated.');
            } else {
                this.descriptionEditing = true;
                this.notice = '';
            }
            this.render();
        });
        if (this.descriptionEditing) {
            const textarea = document.createElement('textarea');
            textarea.className = 'theia-mobile-work-hub-pull-request-description-editor';
            textarea.value = this.description;
            textarea.rows = 5;
            textarea.setAttribute('aria-label', nls.localize('qaap/pullRequests/descriptionEditor', 'Pull request description'));
            textarea.addEventListener('input', () => {
                this.description = textarea.value;
            });
            body.append(textarea, edit);
        } else {
            const text = document.createElement('p');
            text.className = 'theia-mobile-work-hub-pull-request-description-text';
            text.textContent = this.description;
            body.append(text, edit);
        }
        return body;
    }

    protected createChecksContent(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const checks = document.createElement('div');
        checks.className = 'theia-mobile-work-hub-pull-request-checks';
        const icon = document.createElement('span');
        icon.className = `codicon ${pullRequest.tests === 'passing' ? 'codicon-pass' : pullRequest.tests === 'failing' ? 'codicon-error' : 'codicon-clock'}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = this.checkLabel(pullRequest);
        checks.append(icon, label);
        return checks;
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

        const commentRow = document.createElement('div');
        commentRow.className = 'theia-mobile-work-hub-pull-request-comment-row';
        const comment = document.createElement('textarea');
        comment.className = 'theia-mobile-work-hub-pull-request-comment';
        comment.placeholder = nls.localize('qaap/pullRequests/commentPlaceholder', 'Leave a comment');
        comment.value = this.commentDraft;
        comment.rows = 2;
        comment.setAttribute('aria-label', comment.placeholder);
        comment.addEventListener('input', () => {
            this.commentDraft = comment.value;
        });
        const submit = this.createButton(nls.localize('qaap/pullRequests/comment', 'Comment'), 'theia-mobile-work-hub-pull-request-comment-submit');
        submit.disabled = !this.commentDraft.trim();
        submit.addEventListener('click', () => {
            const value = this.commentDraft.trim();
            if (!value) {
                return;
            }
            this.comments.push(value);
            this.commentDraft = '';
            this.notice = nls.localize('qaap/pullRequests/commentAdded', 'Comment added to the activity.');
            this.render();
        });
        commentRow.append(comment, submit);
        activity.append(commentRow);
        return activity;
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
    ): HTMLElement {
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-pull-request-section';
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'theia-mobile-work-hub-pull-request-section-header';
        const title = document.createElement('strong');
        title.textContent = titleText;
        const chevron = document.createElement('span');
        chevron.className = `codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`;
        chevron.setAttribute('aria-hidden', 'true');
        header.append(title, chevron);
        header.setAttribute('aria-expanded', String(expanded));
        header.addEventListener('click', () => onToggle(!expanded));
        section.append(header);
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

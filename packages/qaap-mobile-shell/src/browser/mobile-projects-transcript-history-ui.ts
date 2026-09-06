// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_GIT_REVIEW_API_PATH,
    isQaapGitReviewMissingRootError,
    isQaapGitReviewNotRepoError,
    readQaapGitReviewErrorBody,
    type QaapGitHistoryCommit,
    type QaapGitHistoryResponse,
} from '../common/qaap-git-review';
import {
    collectHistoryAuthors,
    collectHistoryBranches,
    cycleHistoryFilter,
    filterTranscriptHistoryCommits,
} from '../common/qaap-transcript-history-filter';
import { installMobilePanelResizeDrag } from './mobile-panel-resize-drag';

/** Panel state for the transcript review-tab commit history drawer. */
export interface MobileProjectsTranscriptHistoryHost {
    transcriptHistoryPanelOpen: boolean;
    transcriptHistoryPanelHeightPx: number | undefined;
    transcriptHistoryLoading: boolean;
    transcriptHistoryCommits: QaapGitHistoryCommit[];
    transcriptHistoryBranch: string | undefined;
    /** Human-readable load failure; never shown in the branch filter button. */
    transcriptHistoryError: string | undefined;
    transcriptHistoryQuery: string;
    transcriptHistoryAuthorFilter: string | undefined;
    transcriptHistoryBranchFilter: string | undefined;
    transcriptHistoryRoot: string | undefined;
    transcriptHistoryLoadGeneration: number;
    transcriptReviewHost: HTMLElement | undefined;
}

/** Commit history toggle, list, fetch, and resize handle in the transcript review surface. */
export class MobileProjectsTranscriptHistoryUi {

    constructor(protected readonly host: MobileProjectsTranscriptHistoryHost) { }

    renderTranscriptHistoryToggle(
        toggleHost: HTMLElement,
        panel: HTMLElement,
        resizeHandle: HTMLElement,
        root: string,
    ): void {
        toggleHost.replaceChildren();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-transcript-history-toggle codicon codicon-history';
        btn.title = nls.localize('qaap/mobileProjects/historyToggle', 'Show commit history');
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', String(this.host.transcriptHistoryPanelOpen));
        btn.classList.toggle('theia-mod-active', this.host.transcriptHistoryPanelOpen);
        btn.addEventListener('click', () => {
            this.host.transcriptHistoryPanelOpen = !this.host.transcriptHistoryPanelOpen;
            btn.setAttribute('aria-pressed', String(this.host.transcriptHistoryPanelOpen));
            btn.classList.toggle('theia-mod-active', this.host.transcriptHistoryPanelOpen);
            panel.hidden = !this.host.transcriptHistoryPanelOpen;
            resizeHandle.hidden = !this.host.transcriptHistoryPanelOpen;
            if (this.host.transcriptHistoryPanelOpen) {
                this.renderTranscriptHistoryPanel(panel, root);
                void this.loadTranscriptHistory(root, panel, true);
            }
        });
        toggleHost.append(btn);
        if (this.host.transcriptHistoryPanelOpen) {
            void this.loadTranscriptHistory(root, panel);
        }
    }

    async loadTranscriptHistory(root: string, panel: HTMLElement, force = false): Promise<void> {
        if (!force && this.host.transcriptHistoryRoot === root && this.host.transcriptHistoryCommits.length > 0) {
            return;
        }
        const generation = ++this.host.transcriptHistoryLoadGeneration;
        this.host.transcriptHistoryLoading = true;
        this.host.transcriptHistoryError = undefined;
        this.renderTranscriptHistoryPanel(panel, root);
        try {
            const params = new URLSearchParams({ root });
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/history?${params.toString()}`, {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const payload = await response.json() as QaapGitHistoryResponse;
            if (generation !== this.host.transcriptHistoryLoadGeneration || this.host.transcriptHistoryRoot !== root || !panel.isConnected) {
                return;
            }
            this.host.transcriptHistoryBranch = payload.branch;
            this.host.transcriptHistoryCommits = payload.commits;
            this.host.transcriptHistoryError = undefined;
        } catch (error) {
            if (generation === this.host.transcriptHistoryLoadGeneration && panel.isConnected) {
                this.host.transcriptHistoryCommits = [];
                this.host.transcriptHistoryBranch = undefined;
                const raw = error instanceof Error ? error.message : String(error);
                this.host.transcriptHistoryError = this.formatTranscriptHistoryLoadError(raw);
            }
        } finally {
            if (generation === this.host.transcriptHistoryLoadGeneration && panel.isConnected) {
                this.host.transcriptHistoryLoading = false;
                this.renderTranscriptHistoryPanel(panel, root);
            }
        }
    }

    protected formatTranscriptHistoryLoadError(raw: string): string {
        const message = readQaapGitReviewErrorBody(raw) ?? raw.trim();
        if (isQaapGitReviewMissingRootError(message)) {
            return nls.localize(
                'qaap/mobileProjects/historyUnavailable',
                'Open this project in the workspace to view commit history.',
            );
        }
        if (isQaapGitReviewNotRepoError(message)) {
            return nls.localize(
                'qaap/mobileProjects/historyNotGitRepo',
                'This project folder is not a git repository yet.',
            );
        }
        if (!message || message.startsWith('{')) {
            return nls.localize(
                'qaap/mobileProjects/historyLoadFailed',
                'Could not load commit history. Try opening the project again.',
            );
        }
        return message;
    }

    renderTranscriptHistoryPanel(panel: HTMLElement, root: string): void {
        panel.replaceChildren();
        if (panel.hidden) {
            return;
        }
        const header = document.createElement('div');
        header.className = 'theia-mobile-transcript-history-header';
        const title = document.createElement('div');
        title.className = 'theia-mobile-transcript-history-title';
        title.textContent = nls.localize('qaap/mobileProjects/historyTitle', 'History');
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-transcript-history-actions';
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'theia-mobile-transcript-history-icon codicon codicon-refresh';
        refresh.title = nls.localize('qaap/mobileProjects/historyRefresh', 'Refresh history');
        refresh.setAttribute('aria-label', refresh.title);
        refresh.addEventListener('click', () => { void this.loadTranscriptHistory(root, panel, true); });
        actions.append(refresh);
        header.append(title, actions);

        const searchWrap = document.createElement('label');
        searchWrap.className = 'theia-mobile-transcript-history-search';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'codicon codicon-search';
        searchIcon.setAttribute('aria-hidden', 'true');
        const search = document.createElement('input');
        search.type = 'search';
        search.value = this.host.transcriptHistoryQuery;
        search.placeholder = nls.localize('qaap/mobileProjects/historySearch', 'Search commits');
        search.setAttribute('aria-label', search.placeholder);
        search.addEventListener('input', () => {
            this.host.transcriptHistoryQuery = search.value;
            this.renderTranscriptHistoryPanel(panel, root);
        });
        searchWrap.append(searchIcon, search);

        const filters = document.createElement('div');
        filters.className = 'theia-mobile-transcript-history-filters';
        const branches = collectHistoryBranches(this.host.transcriptHistoryCommits, this.host.transcriptHistoryBranch);
        const authors = collectHistoryAuthors(this.host.transcriptHistoryCommits);
        const branch = document.createElement('button');
        branch.type = 'button';
        branch.className = 'theia-mobile-transcript-history-filter';
        branch.textContent = this.host.transcriptHistoryBranchFilter
            ?? nls.localize('qaap/mobileProjects/historyBranch', 'Branch');
        branch.title = nls.localize('qaap/mobileProjects/historyBranchFilter', 'Filter commits by branch');
        branch.setAttribute('aria-label', branch.title);
        branch.disabled = branches.length === 0;
        branch.addEventListener('click', () => {
            this.host.transcriptHistoryBranchFilter = cycleHistoryFilter(this.host.transcriptHistoryBranchFilter, branches);
            this.renderTranscriptHistoryPanel(panel, root);
        });
        const user = document.createElement('button');
        user.type = 'button';
        user.className = 'theia-mobile-transcript-history-filter';
        user.textContent = this.host.transcriptHistoryAuthorFilter
            ?? nls.localize('qaap/mobileProjects/historyUser', 'User');
        user.title = nls.localize('qaap/mobileProjects/historyUserFilter', 'Filter commits by author');
        user.setAttribute('aria-label', user.title);
        user.disabled = authors.length === 0;
        user.addEventListener('click', () => {
            this.host.transcriptHistoryAuthorFilter = cycleHistoryFilter(this.host.transcriptHistoryAuthorFilter, authors);
            this.renderTranscriptHistoryPanel(panel, root);
        });
        filters.append(branch, user);

        const list = document.createElement('div');
        list.className = 'theia-mobile-transcript-history-list';
        const commits = filterTranscriptHistoryCommits(this.host.transcriptHistoryCommits, {
            query: this.host.transcriptHistoryQuery,
            branch: this.host.transcriptHistoryBranchFilter,
            author: this.host.transcriptHistoryAuthorFilter,
        });
        if (this.host.transcriptHistoryLoading) {
            list.append(this.createTranscriptHistoryNote(nls.localize('qaap/mobileProjects/historyLoading', 'Loading history...')));
        } else if (this.host.transcriptHistoryError) {
            list.append(this.createTranscriptHistoryNote(this.host.transcriptHistoryError));
        } else if (commits.length === 0) {
            list.append(this.createTranscriptHistoryNote(
                this.host.transcriptHistoryQuery.trim()
                    || this.host.transcriptHistoryBranchFilter
                    || this.host.transcriptHistoryAuthorFilter
                    ? nls.localize('qaap/mobileProjects/historyNoMatches', 'No matching commits.')
                    : nls.localize('qaap/mobileProjects/historyEmpty', 'No commits found.'),
            ));
        } else {
            commits.forEach((commit, index) => list.append(this.createTranscriptHistoryRow(commit, index)));
        }
        panel.append(header, searchWrap, filters, list);
    }

    installTranscriptHistoryResize(
        handle: HTMLElement,
        panel: HTMLElement,
        surfaceHost = this.host.transcriptReviewHost,
    ): void {
        const applyHeight = (height: number): void => {
            const hostHeight = surfaceHost?.getBoundingClientRect().height ?? window.innerHeight;
            const max = Math.max(180, Math.min(420, hostHeight * 0.62));
            const next = Math.round(Math.max(150, Math.min(max, height)));
            this.host.transcriptHistoryPanelHeightPx = next;
            panel.style.setProperty('--qaap-transcript-history-height', `${next}px`);
            handle.setAttribute('aria-valuemax', String(Math.round(max)));
            handle.setAttribute('aria-valuenow', String(next));
        };
        handle.addEventListener('keydown', event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                return;
            }
            event.preventDefault();
            const measured = panel.getBoundingClientRect().height;
            const current = this.host.transcriptHistoryPanelHeightPx ?? measured;
            applyHeight(current + (event.key === 'ArrowUp' ? 20 : -20));
        });
        let startHeight = 0;
        installMobilePanelResizeDrag({
            handle,
            enabled: () => !handle.hidden,
            onStart: () => {
                const measured = panel.getBoundingClientRect().height;
                startHeight = this.host.transcriptHistoryPanelHeightPx ?? measured;
                surfaceHost?.classList.add('theia-mod-resizing-history');
            },
            onMove: ({ clientY, startClientY }) => {
                applyHeight(startHeight + (startClientY - clientY));
            },
            onEnd: () => {
                surfaceHost?.classList.remove('theia-mod-resizing-history');
            },
        });
    }

    protected createTranscriptHistoryNote(text: string): HTMLElement {
        const note = document.createElement('div');
        note.className = 'theia-mobile-transcript-history-note';
        note.textContent = text;
        return note;
    }

    protected createTranscriptHistoryRow(commit: QaapGitHistoryCommit, index: number): HTMLElement {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'theia-mobile-transcript-history-row';
        row.title = `${commit.subject}\n${commit.shortHash}`;
        const lane = document.createElement('span');
        lane.className = `theia-mobile-transcript-history-lane theia-mod-${index % 5}`;
        const dot = document.createElement('span');
        dot.className = 'theia-mobile-transcript-history-dot';
        lane.append(dot);
        const body = document.createElement('span');
        body.className = 'theia-mobile-transcript-history-body';
        const subject = document.createElement('span');
        subject.className = 'theia-mobile-transcript-history-subject';
        subject.textContent = commit.subject || commit.shortHash;
        const meta = document.createElement('span');
        meta.className = 'theia-mobile-transcript-history-meta';
        meta.textContent = `${commit.authorName || commit.shortHash}, ${this.formatTranscriptHistoryDate(commit.authoredAt)}`;
        body.append(subject, meta);
        if (commit.refs.length > 0) {
            const refs = document.createElement('span');
            refs.className = 'theia-mobile-transcript-history-refs';
            for (const ref of commit.refs.slice(0, 3)) {
                const chip = document.createElement('span');
                chip.className = 'theia-mobile-transcript-history-ref';
                chip.textContent = ref.replace(/^HEAD ->\s*/, '');
                refs.append(chip);
            }
            body.append(refs);
        }
        row.append(lane, body);
        return row;
    }

    protected formatTranscriptHistoryDate(value: string): string {
        const date = value ? new Date(value) : undefined;
        if (!date || Number.isNaN(date.getTime())) {
            return '';
        }
        return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
    }
}

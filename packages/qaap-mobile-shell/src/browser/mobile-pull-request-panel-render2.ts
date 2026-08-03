// @ts-nocheck
// Extracted from mobile-pull-request-panel.ts

import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    fetchQaapGithubPullRequests,
    mergeQaapGithubPullRequest,
    startGithubOAuth,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import type {
    QaapGithubPullRequestFile,
    QaapGithubPullRequestLine,
    QaapGithubPullRequestSummary,
    QaapGithubRepositorySummary,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    createMobileSheetGrabber,
    installMobilePullToRefresh,
    installMobileSheetDragDismiss,
} from './mobile-sheet-gestures';
import { MobileSnackbar } from './mobile-snackbar';

export function disposeExtracted(ctx: any): void {
        ctx.loadRequestGeneration++;
        ctx.visible = false;
        ctx.root.classList.remove('theia-mod-visible');
        ctx.root.setAttribute('aria-hidden', 'true');
        ctx.root.hidden = true;
        ctx.clearActionChrome();
        ctx.dragDismissDispose.dispose();
        ctx.dragDismissDispose = Disposable.NULL;
        ctx.pullToRefreshDispose.dispose();
        ctx.pullToRefreshDispose = Disposable.NULL;
        ctx.root.remove();
}

export function showExtracted(ctx: any): void {
        ctx.visible = true;
        ctx.root.hidden = false;
        ctx.root.setAttribute('aria-hidden', 'false');
        ctx.root.classList.add('theia-mod-visible');
        if (!ctx.loaded) {
            void ctx.loadPullRequests();
        } else {
            ctx.render();
        }
}

export function showWithPullRequestExtracted(ctx: any, pullRequest: QaapGithubPullRequestSummary): void {
        ctx.visible = true;
        ctx.root.hidden = false;
        ctx.root.setAttribute('aria-hidden', 'false');
        ctx.root.classList.add('theia-mod-visible');
        ctx.loading = false;
        ctx.errorMessage = undefined;
        ctx.signedOut = false;
        ctx.loaded = true;
        const existing = ctx.pullRequests.find(
            candidate => candidate.owner === pullRequest.owner
                && candidate.repo === pullRequest.repo
                && candidate.number === pullRequest.number,
        );
        if (!existing) {
            ctx.pullRequests = [pullRequest, ...ctx.pullRequests];
        }
        ctx.usePullRequest(existing ?? pullRequest);
}

export function hideExtracted(ctx: any): void {
        if (!ctx.visible) {
            return;
        }
        ctx.loadRequestGeneration++;
        ctx.visible = false;
        ctx.root.classList.remove('theia-mod-visible');
        ctx.root.setAttribute('aria-hidden', 'true');
        ctx.resetSheetPresentation();
        ctx.pointerId = undefined;
        ctx.dragX = 0;
        ctx.dragMode = undefined;
        ctx.hideToast();
        ctx.clearActionChrome();
        window.setTimeout(() => {
            if (!ctx.visible) {
                ctx.root.hidden = true;
            }
        }, 180);
        ctx.delegate.onDismiss();
}

export async function loadPullRequestsExtracted(ctx: any): Promise<void> {
        const generation = ++ctx.loadRequestGeneration;
        ctx.loading = true;
        ctx.errorMessage = undefined;
        ctx.signedOut = false;
        ctx.render();
        try {
            const response = await fetchQaapGithubPullRequests();
            if (generation !== ctx.loadRequestGeneration) {
                return;
            }
            ctx.loaded = true;
            ctx.loading = false;
            ctx.currentRepository = response.currentRepository;
            ctx.signedOut = !response.signedIn;
            ctx.pullRequests = response.pullRequests;
            if (!response.signedIn) {
                ctx.clearActivePullRequest();
            } else if (response.pullRequests.length === 0) {
                ctx.clearActivePullRequest();
            } else {
                const previousNumber = ctx.activePullRequest?.number;
                const previous = previousNumber !== undefined
                    ? response.pullRequests.find(pr => pr.number === previousNumber)
                    : undefined;
                ctx.usePullRequest(previous ?? response.pullRequests[0]);
            }
        } catch (err) {
            if (generation !== ctx.loadRequestGeneration) {
                return;
            }
            ctx.loaded = true;
            ctx.loading = false;
            ctx.errorMessage = err instanceof Error ? err.message : nls.localize('qaap/mobilePr/loadError', 'Failed to load pull requests.');
            ctx.clearActivePullRequest();
        }
        if (generation !== ctx.loadRequestGeneration) {
            return;
        }
        ctx.render();
}

export function clearActivePullRequestExtracted(ctx: any): void {
        ctx.clearMergeTimer();
        ctx.activePullRequest = undefined;
        ctx.queue = [];
        ctx.decisions.clear();
        ctx.history = [];
        ctx.confirmingMerge = false;
        ctx.mergeState = 'idle';
        ctx.mergeError = undefined;
}

export function usePullRequestExtracted(ctx: any, pullRequest: QaapGithubPullRequestSummary): void {
        ctx.clearMergeTimer();
        ctx.activePullRequest = pullRequest;
        ctx.confirmingMerge = false;
        ctx.mergeError = undefined;
        ctx.expanded = false;
        ctx.dragX = 0;
        ctx.restoreReviewState();
}

export function restoreReviewStateExtracted(ctx: any): void {
        const pullRequest = ctx.activePullRequest;
        if (!pullRequest) {
            return;
        }
        ctx.decisions.clear();
        ctx.history = [];
        ctx.mergeState = 'idle';
        const stored = ctx.readStoredReview(pullRequest);
        if (stored) {
            for (const [path, review] of stored.decisions) {
                if (ctx.findFile(path)) {
                    ctx.decisions.set(path, review);
                }
            }
            for (const entry of stored.history) {
                const file = ctx.findFile(entry.path);
                if (file) {
                    ctx.history.push({ file, review: entry.review });
                }
            }
            if (stored.mergeState === 'merged') {
                ctx.mergeState = 'merged';
            }
        }
        ctx.queue = pullRequest.filesPreview.filter(file => !ctx.decisions.has(file.f));
}

export function renderExtracted(ctx: any): void {
        ctx.renderHeader();
        ctx.clearActionChrome();
        if (ctx.loading && !ctx.activePullRequest) {
            ctx.renderProgress(0, 0, 0, 0, 0);
            ctx.hintRow.hidden = true;
            ctx.stack.replaceChildren(ctx.createBusyState());
            return;
        }
        if (ctx.signedOut) {
            ctx.renderProgress(0, 0, 0, 0, 0);
            ctx.hintRow.hidden = true;
            ctx.stack.replaceChildren(ctx.createSignInState());
            ctx.renderSignInActions();
            return;
        }
        if (ctx.errorMessage && !ctx.activePullRequest) {
            ctx.renderProgress(0, 0, 0, 0, 0);
            ctx.hintRow.hidden = true;
            ctx.stack.replaceChildren(ctx.createErrorState());
            ctx.renderErrorActions();
            return;
        }
        if (!ctx.activePullRequest) {
            ctx.renderProgress(0, 0, 0, 0, 0);
            ctx.hintRow.hidden = true;
            ctx.stack.replaceChildren(ctx.createEmptyState());
            ctx.renderEmptyActions();
            return;
        }
        const stats = ctx.reviewStats();
        const allReviewed = ctx.queue.length === 0;
        ctx.renderProgress(stats.reviewed, stats.total, stats.approved, stats.rejected, stats.commented);
        ctx.hintRow.hidden = allReviewed;
        ctx.stack.replaceChildren();
        if (allReviewed) {
            ctx.stack.appendChild(ctx.createDoneState(stats));
        } else {
            ctx.stack.appendChild(ctx.createCardStack());
        }
        ctx.renderActions(allReviewed, stats);
}

export function renderHeaderExtracted(ctx: any): void {
        ctx.header.replaceChildren();
        const pullRequest = ctx.activePullRequest;
        const repoLabel = ctx.repositoryLabel();
        const top = document.createElement('div');
        top.className = 'theia-mobile-pr-meta-row';

        const repoChip = document.createElement('span');
        repoChip.className = 'theia-mobile-pr-repo';
        repoChip.append(
            ctx.createIcon('codicon-github'),
            ctx.createTextSpan(repoLabel)
        );

        const spacer = document.createElement('span');
        spacer.className = 'theia-mobile-pr-spacer';

        top.append(repoChip, spacer);

        if (pullRequest) {
            const externalLink = document.createElement('a');
            externalLink.className = 'theia-mobile-pr-icon-btn theia-mod-link codicon codicon-link-external';
            externalLink.href = pullRequest.htmlUrl;
            externalLink.target = '_blank';
            externalLink.rel = 'noopener noreferrer';
            externalLink.title = nls.localize('qaap/mobilePr/openOnGithub', 'Open on GitHub');
            externalLink.setAttribute('aria-label', externalLink.title);
            top.append(externalLink);
        }

        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'theia-mobile-pr-icon-btn codicon codicon-refresh';
        refresh.title = nls.localize('qaap/mobilePr/refresh', 'Refresh pull requests');
        refresh.setAttribute('aria-label', refresh.title);
        if (ctx.loading) {
            refresh.classList.add('codicon-modifier-spin');
        }
        refresh.disabled = ctx.loading || ctx.mergeState === 'merging' || ctx.mergeState === 'deploying';
        refresh.addEventListener('click', () => { void ctx.loadPullRequests(); });
        top.append(refresh);

        ctx.header.append(top);

        if (ctx.pullRequests.length > 1 && pullRequest) {
            ctx.header.append(ctx.createPullRequestPicker(pullRequest));
        }

        if (pullRequest) {
            const titleRow = document.createElement('div');
            titleRow.className = 'theia-mobile-pr-title-row';
            const number = document.createElement('span');
            number.className = 'theia-mobile-pr-number';
            number.textContent = `#${pullRequest.number}`;
            const title = document.createElement('h1');
            title.className = 'theia-mobile-pr-title';
            title.textContent = pullRequest.title;
            titleRow.append(number, title);

            const branchRow = document.createElement('div');
            branchRow.className = 'theia-mobile-pr-branchrow';
            branchRow.append(
                ctx.createIcon('codicon-git-branch'),
                ctx.createClassedTextSpan('theia-mobile-pr-branch-name', pullRequest.branch),
                ctx.createIcon('codicon-arrow-right'),
                ctx.createClassedTextSpan('theia-mobile-pr-branch-name theia-mod-base', pullRequest.base),
                ctx.createClassedTextSpan('theia-mobile-pr-author', `@${pullRequest.author}`)
            );

            const stats = document.createElement('div');
            stats.className = 'theia-mobile-pr-stats';
            stats.append(
                ctx.createStatChip('codicon-file', `${pullRequest.files} ${nls.localize('qaap/mobilePr/files', 'files')}`),
                ctx.createClassedTextSpan('theia-mod-add', `+${pullRequest.adds}`),
                ctx.createClassedTextSpan('theia-mod-del', `-${pullRequest.dels}`),
                ctx.createTestsPill(pullRequest.tests)
            );

            ctx.header.append(titleRow, branchRow, stats);
        }
}

export function createPullRequestPickerExtracted(ctx: any, pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        const picker = document.createElement('div');
        picker.className = 'theia-mobile-pr-picker';
        picker.setAttribute('role', 'tablist');
        picker.setAttribute('aria-label', nls.localize('qaap/mobilePr/pickerLabel', 'Select pull request'));
        for (const candidate of ctx.pullRequests) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'theia-mobile-pr-picker-tab';
            tab.setAttribute('role', 'tab');
            const active = candidate.number === pullRequest.number;
            if (active) {
                tab.classList.add('theia-mod-active');
                tab.setAttribute('aria-selected', 'true');
            } else {
                tab.setAttribute('aria-selected', 'false');
            }
            tab.title = candidate.title;
            const number = document.createElement('span');
            number.className = 'theia-mobile-pr-picker-num';
            number.textContent = `#${candidate.number}`;
            const label = document.createElement('span');
            label.className = 'theia-mobile-pr-picker-title';
            label.textContent = candidate.title;
            tab.append(number, label);
            tab.addEventListener('click', () => {
                if (candidate.number === ctx.activePullRequest?.number) {
                    return;
                }
                ctx.usePullRequest(candidate);
                ctx.render();
            });
            picker.appendChild(tab);
        }
        return picker;
}

export function repositoryLabelExtracted(ctx: any): string {
        const pr = ctx.activePullRequest;
        if (pr) {
            return `${pr.owner}/${pr.repo}`;
        }
        const repo = ctx.currentRepository;
        if (repo) {
            return repo.fullName;
        }
        return nls.localize('qaap/mobilePr/noRepo', 'No repository open');
}

export function renderProgressExtracted(ctx: any, reviewed: number, total: number, approved: number, rejected: number, commented: number): void {
        ctx.progressLabel.textContent = total > 0 ? `${reviewed} / ${total} reviewed` : '0 reviewed';
        ctx.progressFill.style.width = total > 0 ? `${(reviewed / total) * 100}%` : '0';
        ctx.approveCount.textContent = approved > 0 ? `ok ${approved}` : '';
        ctx.rejectCount.textContent = rejected > 0 ? `x ${rejected}` : '';
        ctx.noteCount.textContent = commented > 0 ? `note ${commented}` : '';
}

export function createCardStackExtracted(ctx: any): HTMLElement {
        const host = document.createElement('div');
        host.className = 'theia-mobile-pr-card-host';
        const approve = document.createElement('div');
        approve.className = 'theia-mobile-pr-backdrop theia-mod-approve';
        const approveLabel = document.createElement('span');
        approveLabel.append(document.createTextNode('Approve '), ctx.createIcon('codicon-check'));
        approve.appendChild(approveLabel);
        const reject = document.createElement('div');
        reject.className = 'theia-mobile-pr-backdrop theia-mod-reject';
        const rejectLabel = document.createElement('span');
        rejectLabel.append(ctx.createIcon('codicon-close'), document.createTextNode(' Changes'));
        reject.appendChild(rejectLabel);
        host.append(approve, reject);
        const next = ctx.queue[1];
        if (next) {
            host.appendChild(ctx.createFileCard(next, false));
        }
        const top = ctx.queue[0];
        if (top) {
            host.appendChild(ctx.createFileCard(top, true));
        }
        ctx.applyDragStyles(host);
        return host;
}

export function createFileCardExtracted(ctx: any, file: QaapGithubPullRequestFile, top: boolean): HTMLElement {
        const card = document.createElement('article');
        card.className = top ? 'theia-mobile-pr-card theia-mod-top' : 'theia-mobile-pr-card theia-mod-next';
        card.setAttribute('aria-label', `${file.f}, ${file.adds} additions, ${file.dels} deletions`);
        if (ctx.expanded && top) {
            card.classList.add('theia-mod-expanded');
        }
        const header = document.createElement('header');
        header.className = 'theia-mobile-pr-card-header';
        const glyph = document.createElement('span');
        glyph.className = 'theia-mobile-pr-file-glyph';
        glyph.textContent = file.ext;
        const name = document.createElement('span');
        name.className = 'theia-mobile-pr-file-name';
        name.textContent = file.f;
        const adds = document.createElement('span');
        adds.className = 'theia-mobile-pr-file-add';
        adds.textContent = `+${file.adds}`;
        const dels = document.createElement('span');
        dels.className = 'theia-mobile-pr-file-del';
        dels.textContent = `-${file.dels}`;
        header.append(glyph, name, adds, dels);
        const body = document.createElement('div');
        body.className = 'theia-mobile-pr-diff';
        if (file.preview.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-pr-diff-empty';
            empty.textContent = nls.localize('qaap/mobilePr/noPreview', 'No inline preview available.');
            body.appendChild(empty);
        } else {
            for (const line of file.preview) {
                body.appendChild(ctx.createDiffLine(line));
            }
        }
        card.append(header, body);
        if (top) {
            card.addEventListener('pointerdown', event => ctx.onPointerDown(event, card));
            card.addEventListener('pointermove', event => ctx.onPointerMove(event, card));
            card.addEventListener('pointerup', event => ctx.onPointerUp(event, card));
            card.addEventListener('pointercancel', event => ctx.onPointerUp(event, card));
        }
        return card;
}


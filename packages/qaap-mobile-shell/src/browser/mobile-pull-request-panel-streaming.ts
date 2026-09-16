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

export function createDiffLineExtracted(ctx: any, line: QaapGithubPullRequestLine): HTMLElement {
        const row = document.createElement('div');
        row.className = `theia-mobile-pr-diff-line theia-mod-${line.t}`;
        const number = document.createElement('span');
        number.className = 'theia-mobile-pr-diff-number';
        number.textContent = String(line.n);
        const marker = document.createElement('span');
        marker.className = 'theia-mobile-pr-diff-marker';
        marker.textContent = line.t === 'add' ? '+' : line.t === 'del' ? '-' : ' ';
        const source = document.createElement('span');
        source.className = 'theia-mobile-pr-diff-source';
        source.textContent = line.s;
        row.append(number, marker, source);
        return row;
}

export function createBusyStateExtracted(ctx: any): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-pr-skeleton-list';
        list.setAttribute('aria-busy', 'true');
        list.setAttribute('aria-label', nls.localize('qaap/mobilePr/loading', 'Loading pull requests...'));
        for (let i = 0; i < 3; i++) {
            list.append(ctx.createSkeletonCard());
        }
        return list;
}

export function createSkeletonCardExtracted(ctx: any): HTMLElement {
        const card = document.createElement('div');
        card.className = 'theia-mobile-pr-skeleton-card q-card';
        const title = document.createElement('div');
        title.className = 'q-skeleton q-skeleton-text theia-mobile-pr-skeleton-line theia-mod-title';
        const meta = document.createElement('div');
        meta.className = 'q-skeleton q-skeleton-text theia-mobile-pr-skeleton-line theia-mod-meta';
        const chips = document.createElement('div');
        chips.className = 'theia-mobile-pr-skeleton-chips';
        for (let i = 0; i < 2; i++) {
            const chip = document.createElement('div');
            chip.className = 'q-skeleton theia-mobile-pr-skeleton-chip';
            chips.append(chip);
        }
        card.append(title, meta, chips);
        return card;
}

export function createSignInStateExtracted(ctx: any): HTMLElement {
        const state = document.createElement('div');
        state.className = 'theia-mobile-pr-empty theia-mod-signin';
        state.append(
            ctx.createIcon('codicon-github'),
            ctx.createTextSpan(nls.localize('qaap/mobilePr/signInTitle', 'Sign in to review pull requests')),
            ctx.createClassedTextSpan(
                'theia-mobile-pr-empty-hint',
                nls.localize('qaap/mobilePr/signInDetail', 'Connect your GitHub account to load the open PRs for the current repository.')
            )
        );
        return state;
}

export function createErrorStateExtracted(ctx: any): HTMLElement {
        const state = document.createElement('div');
        state.className = 'theia-mobile-pr-empty theia-mod-error';
        state.append(
            ctx.createIcon('codicon-warning'),
            ctx.createTextSpan(nls.localize('qaap/mobilePr/loadFailed', 'Could not load pull requests')),
            ctx.createClassedTextSpan('theia-mobile-pr-empty-hint', ctx.errorMessage ?? '')
        );
        return state;
}

export function createEmptyStateExtracted(ctx: any): HTMLElement {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-pr-empty';
        const repoLabel = ctx.repositoryLabel();
        const hasRepo = !!ctx.currentRepository;
        empty.append(
            ctx.createIcon('codicon-git-pull-request'),
            ctx.createTextSpan(
                hasRepo
                    ? nls.localize('qaap/mobilePr/noPullsForRepo', 'No open pull requests in {0}', repoLabel)
                    : nls.localize('qaap/mobilePr/noPulls', 'No open pull requests')
            ),
            ctx.createClassedTextSpan(
                'theia-mobile-pr-empty-hint',
                hasRepo
                    ? nls.localize('qaap/mobilePr/noPullsHint', 'Open a PR on GitHub or pull a branch into this workspace to start reviewing here.')
                    : nls.localize('qaap/mobilePr/noPullsDetail', 'Open a GitHub repository workspace to see its open pull requests.')
            )
        );
        return empty;
}

export function createDoneStateExtracted(ctx: any, stats: ReturnType<MobilePullRequestPanel['reviewStats']>): HTMLElement {
        const done = document.createElement('div');
        done.className = 'theia-mobile-pr-done';
        if (ctx.confirmingMerge) {
            done.classList.add('theia-mod-confirm');
        }
        if (ctx.mergeState === 'merged') {
            done.classList.add('theia-mod-merged');
        } else if (ctx.mergeState === 'merging' || ctx.mergeState === 'deploying') {
            done.classList.add('theia-mod-merging');
        } else if (ctx.mergeState === 'failed') {
            done.classList.add('theia-mod-failed');
        }
        const icon = ctx.createIcon(ctx.mergeState === 'failed' ? 'codicon-warning' : ctx.confirmingMerge ? 'codicon-shield' : 'codicon-check');
        icon.classList.add('theia-mobile-pr-done-icon');
        const title = document.createElement('strong');
        title.textContent = ctx.doneTitle();
        const summary = document.createElement('span');
        summary.textContent = ctx.doneSummary(stats);
        done.append(icon, title, summary);
        if (ctx.mergeState === 'merged') {
            done.appendChild(ctx.createClassedTextSpan(
                'theia-mobile-pr-success',
                nls.localize('qaap/mobilePr/deployNotice', 'Merged in the current repository. Deploy started.')
            ));
        }
        if (ctx.mergeError) {
            done.appendChild(ctx.createClassedTextSpan('theia-mobile-pr-error', ctx.mergeError));
        }
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'theia-mobile-pr-secondary';
        reset.textContent = nls.localize('qaap/mobilePr/reviewAgain', 'Review again');
        reset.disabled = ctx.mergeState === 'merging' || ctx.mergeState === 'deploying';
        reset.addEventListener('click', () => ctx.reset());
        done.appendChild(reset);
        return done;
}

export function doneTitleExtracted(ctx: any): string {
        if (ctx.mergeState === 'merged') {
            return nls.localize('qaap/mobilePr/deployedTitle', 'Merged & deployed');
        }
        if (ctx.mergeState === 'deploying') {
            return nls.localize('qaap/mobilePr/deployingTitle', 'Deploying');
        }
        if (ctx.mergeState === 'merging') {
            return nls.localize('qaap/mobilePr/mergingTitle', 'Merging');
        }
        if (ctx.mergeState === 'failed') {
            return nls.localize('qaap/mobilePr/mergeFailedTitle', 'Merge failed');
        }
        if (ctx.confirmingMerge) {
            return nls.localize('qaap/mobilePr/confirmTitle', 'Confirm merge');
        }
        return nls.localize('qaap/mobilePr/allReviewed', 'All reviewed');
}

export function doneSummaryExtracted(ctx: any, stats: ReturnType<MobilePullRequestPanel['reviewStats']>): string {
        const pr = ctx.activePullRequest;
        if (ctx.mergeState === 'merged') {
            return nls.localize('qaap/mobilePr/deployedSummary', 'PR #{0} landed on {1}.', String(pr?.number ?? ''), pr?.base ?? 'base');
        }
        if (ctx.mergeState === 'deploying') {
            return nls.localize('qaap/mobilePr/deployingSummary', 'Merge complete. Starting deploy.');
        }
        if (ctx.mergeState === 'merging') {
            return nls.localize('qaap/mobilePr/mergingSummary', 'Submitting the approved review to GitHub.');
        }
        if (ctx.mergeState === 'failed') {
            return nls.localize('qaap/mobilePr/mergeFailedSummary', 'Nothing changed. You can retry after resolving the issue.');
        }
        if (ctx.confirmingMerge) {
            return nls.localize(
                'qaap/mobilePr/confirmSummary',
                '{0} approved files will merge into {1}.',
                String(stats.approved),
                pr?.base ?? 'base'
            );
        }
        return `${stats.approved} approved - ${stats.rejected} changes - ${stats.commented} notes`;
}

export function renderActionsExtracted(ctx: any, allReviewed: boolean, stats: ReturnType<MobilePullRequestPanel['reviewStats']>): void {
        if (allReviewed) {
            ctx.renderReviewedActions(stats);
            return;
        }
        const top = ctx.queue[0];
        const quickRow = document.createElement('div');
        quickRow.className = 'theia-mobile-pr-quick-row';
        quickRow.append(
            ctx.createChipButton(nls.localize('qaap/mobilePr/fullDiff', 'Full diff'), 'codicon-open-preview', () => ctx.toggleExpanded()),
            ctx.createChipButton(nls.localize('qaap/mobilePr/quickLooksGood', 'Looks good'), 'codicon-comment-discussion', () => ctx.decideTop('approved', 'Looks good')),
            ctx.createChipButton(nls.localize('qaap/mobilePr/quickNeedsTests', 'Needs tests'), 'codicon-beaker', () => ctx.decideTop('commented', 'Needs tests')),
            ctx.createChipButton(nls.localize('qaap/mobilePr/quickSecurity', 'Security risk'), 'codicon-shield', () => ctx.decideTop('rejected', 'Security risk')),
        );
        const buttonRow = document.createElement('div');
        buttonRow.className = 'theia-mobile-pr-button-row';
        const reject = ctx.createActionButton('secondary', nls.localize('qaap/mobilePr/requestChanges', 'Changes'), 'codicon-close', () => ctx.decideTop('rejected'));
        const undo = ctx.createActionButton('ghost', nls.localize('qaap/mobilePr/undo', 'Undo'), 'codicon-discard', () => ctx.undo());
        undo.disabled = ctx.history.length === 0;
        const approve = ctx.createActionButton('primary', nls.localize('qaap/mobilePr/approve', 'Approve'), 'codicon-check', () => ctx.decideTop('approved'));
        if (!top) {
            reject.disabled = true;
            approve.disabled = true;
        }
        buttonRow.append(reject, undo, approve);
        ctx.setCtaContent(quickRow, buttonRow);
}

export function renderReviewedActionsExtracted(ctx: any, stats: ReturnType<MobilePullRequestPanel['reviewStats']>): void {
        const blockers = stats.rejected + stats.commented;
        const buttonRow = document.createElement('div');
        buttonRow.className = 'theia-mobile-pr-button-row';
        if (ctx.confirmingMerge && ctx.mergeState === 'idle') {
            const cancel = ctx.createActionButton('secondary', nls.localize('qaap/mobilePr/cancel', 'Cancel'), 'codicon-close', () => {
                ctx.confirmingMerge = false;
                ctx.render();
            });
            const confirm = ctx.createActionButton('primary', nls.localize('qaap/mobilePr/confirmMerge', 'Confirm merge'), 'codicon-git-merge', () => { void ctx.executeMergeAndDeploy(); });
            buttonRow.append(cancel, confirm);
            ctx.setCtaContent(buttonRow);
            return;
        }
        const undo = ctx.createActionButton('secondary', nls.localize('qaap/mobilePr/undo', 'Undo'), 'codicon-discard', () => ctx.undo());
        undo.disabled = ctx.history.length === 0 || ctx.mergeState !== 'idle';
        const label = ctx.mergeButtonLabel(blockers);
        const icon = ctx.mergeState === 'merging' || ctx.mergeState === 'deploying' ? 'codicon-sync codicon-modifier-spin' : 'codicon-git-merge';
        const merge = ctx.createActionButton('primary', label, icon, () => ctx.startMergeConfirmation());
        merge.disabled = blockers > 0 || ctx.mergeState === 'merging' || ctx.mergeState === 'deploying' || ctx.mergeState === 'merged';
        if (ctx.mergeState === 'failed') {
            merge.disabled = false;
            merge.replaceChildren(ctx.createIcon('codicon-debug-restart'), ctx.createTextSpan(nls.localize('qaap/mobilePr/retryMerge', 'Retry merge')));
        }
        buttonRow.append(undo, merge);
        ctx.setCtaContent(buttonRow);
}

export function resetSheetPresentationExtracted(ctx: any): void {
        ctx.root.style.transition = '';
        ctx.root.style.transform = '';
        ctx.root.style.opacity = '';
}

export function renderEmptyActionsExtracted(ctx: any): void {
        const buttonRow = document.createElement('div');
        buttonRow.className = 'theia-mobile-pr-button-row';
        const refresh = ctx.createActionButton(
            'primary',
            nls.localize('qaap/mobilePr/refresh', 'Refresh'),
            ctx.loading ? 'codicon-sync codicon-modifier-spin' : 'codicon-refresh',
            () => { void ctx.loadPullRequests(); }
        );
        refresh.disabled = ctx.loading;
        buttonRow.append(refresh);
        const repo = ctx.currentRepository;
        if (repo) {
            const open = document.createElement('a');
            open.className = 'theia-mobile-pr-action theia-mod-secondary';
            open.href = `${repo.htmlUrl}/pulls`;
            open.target = '_blank';
            open.rel = 'noopener noreferrer';
            open.append(
                ctx.createIcon('codicon-link-external'),
                ctx.createTextSpan(nls.localize('qaap/mobilePr/openPullsOnGithub', 'Open PRs on GitHub'))
            );
            buttonRow.append(open);
        }
        ctx.setCtaContent(buttonRow);
}

export function renderErrorActionsExtracted(ctx: any): void {
        const buttonRow = document.createElement('div');
        buttonRow.className = 'theia-mobile-pr-button-row';
        const retry = ctx.createActionButton(
            'primary',
            nls.localize('qaap/mobilePr/retry', 'Retry'),
            ctx.loading ? 'codicon-sync codicon-modifier-spin' : 'codicon-debug-restart',
            () => { void ctx.loadPullRequests(); }
        );
        retry.disabled = ctx.loading;
        buttonRow.append(retry);
        ctx.setCtaContent(buttonRow);
}

export function renderSignInActionsExtracted(ctx: any): void {
        const buttonRow = document.createElement('div');
        buttonRow.className = 'theia-mobile-pr-button-row';
        const signIn = ctx.createActionButton(
            'primary',
            nls.localize('qaap/mobilePr/signIn', 'Sign in with GitHub'),
            'codicon-github',
            () => startGithubOAuth()
        );
        buttonRow.append(signIn);
        ctx.setCtaContent(buttonRow);
}

export function mergeButtonLabelExtracted(ctx: any, blockers: number): string {
        if (ctx.mergeState === 'merged') {
            return nls.localize('qaap/mobilePr/deployed', 'Deployed');
        }
        if (ctx.mergeState === 'deploying') {
            return nls.localize('qaap/mobilePr/deploying', 'Deploying...');
        }
        if (ctx.mergeState === 'merging') {
            return nls.localize('qaap/mobilePr/merging', 'Merging...');
        }
        if (blockers > 0) {
            return nls.localize('qaap/mobilePr/resolveFirst', 'Resolve notes first');
        }
        return nls.localize('qaap/mobilePr/merge', 'Merge & deploy');
}

export function createActionButtonExtracted(ctx: any, kind: 'primary' | 'secondary' | 'ghost',
        label: string,
        icon: string,
        onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theia-mobile-pr-action theia-mod-${kind}`;
        button.setAttribute('aria-label', label);
        button.append(ctx.createIcon(icon), ctx.createTextSpan(label));
        button.addEventListener('click', onClick);
        return button;
}

export function createChipButtonExtracted(ctx: any, label: string, icon: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-pr-chip';
        button.append(ctx.createIcon(icon), ctx.createTextSpan(label));
        button.addEventListener('click', onClick);
        return button;
}

export function createStatChipExtracted(ctx: any, icon: string, text: string): HTMLElement {
        const span = document.createElement('span');
        span.className = 'theia-mobile-pr-stat-chip';
        span.append(ctx.createIcon(icon), ctx.createTextSpan(text));
        return span;
}

export function onPointerDownExtracted(ctx: any, event: PointerEvent, card: HTMLElement): void {
        if (ctx.animating || !ctx.queue.length) {
            return;
        }
        ctx.pointerId = event.pointerId;
        ctx.dragStartX = event.clientX;
        ctx.dragStartY = event.clientY;
        ctx.dragX = 0;
        ctx.dragMode = undefined;
        card.setPointerCapture(event.pointerId);
}

export function onPointerMoveExtracted(ctx: any, event: PointerEvent, card: HTMLElement): void {
        if (ctx.pointerId !== event.pointerId) {
            return;
        }
        const dx = event.clientX - ctx.dragStartX;
        const dy = event.clientY - ctx.dragStartY;
        if (!ctx.dragMode) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.2) {
                ctx.dragMode = 'vertical';
                return;
            }
            if (Math.abs(dx) > 8) {
                ctx.dragMode = 'horizontal';
            }
        }
        if (ctx.dragMode !== 'horizontal') {
            return;
        }
        ctx.dragX = dx;
        ctx.applyDragStyles(card.parentElement);
}

export function onPointerUpExtracted(ctx: any, event: PointerEvent, card: HTMLElement): void {
        if (ctx.pointerId !== event.pointerId) {
            return;
        }
        ctx.pointerId = undefined;
        card.releasePointerCapture(event.pointerId);
        if (ctx.dragMode === 'vertical') {
            ctx.dragMode = undefined;
            return;
        }
        ctx.dragMode = undefined;
        if (Math.abs(ctx.dragX) < 8) {
            ctx.toggleExpanded();
            return;
        }
        if (Math.abs(ctx.dragX) > 100) {
            ctx.decideTop(ctx.dragX > 0 ? 'approved' : 'rejected');
        } else {
            ctx.dragX = 0;
            ctx.applyDragStyles(card.parentElement, true);
            window.setTimeout(() => ctx.render(), 160);
        }
}

export function toggleExpandedExtracted(ctx: any): void {
        ctx.expanded = !ctx.expanded;
        ctx.dragX = 0;
        ctx.render();
}


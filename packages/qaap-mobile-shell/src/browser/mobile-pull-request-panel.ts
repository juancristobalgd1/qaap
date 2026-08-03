// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { clearActivePullRequestExtracted, createCardStackExtracted, createFileCardExtracted, createPullRequestPickerExtracted, disposeExtracted, hideExtracted, loadPullRequestsExtracted, renderExtracted, renderHeaderExtracted, renderProgressExtracted, repositoryLabelExtracted, restoreReviewStateExtracted, showExtracted, showWithPullRequestExtracted, usePullRequestExtracted } from './mobile-pull-request-panel-render2';
import { createActionButtonExtracted, createBusyStateExtracted, createChipButtonExtracted, createDiffLineExtracted, createDoneStateExtracted, createEmptyStateExtracted, createErrorStateExtracted, createSignInStateExtracted, createSkeletonCardExtracted, createStatChipExtracted, doneSummaryExtracted, doneTitleExtracted, mergeButtonLabelExtracted, onPointerDownExtracted, onPointerMoveExtracted, onPointerUpExtracted, renderActionsExtracted, renderEmptyActionsExtracted, renderErrorActionsExtracted, renderReviewedActionsExtracted, renderSignInActionsExtracted, resetSheetPresentationExtracted, toggleExpandedExtracted } from './mobile-pull-request-panel-streaming2';
import { applyDragStylesExtracted, clearMergeTimerExtracted, createClassedTextSpanExtracted, createIconExtracted, createTestsPillExtracted, createTextSpanExtracted, decideTopExtracted, delayExtracted, executeMergeAndDeployExtracted, fireConfettiExtracted, hideToastExtracted, readStoredReviewExtracted, resetExtracted, reviewLabelExtracted, reviewStatsExtracted, saveReviewStateExtracted, showToastExtracted, showUndoToastExtracted, startMergeConfirmationExtracted, undoExtracted } from './mobile-pull-request-panel-timeline2';

type PullRequestDecision = 'approved' | 'rejected' | 'commented';
type PullRequestMergeState = 'idle' | 'merging' | 'deploying' | 'merged' | 'failed';
type DragMode = 'horizontal' | 'vertical';
type ToastKind = 'default' | 'success' | 'error';

interface PullRequestReview {
    decision: PullRequestDecision;
    comment?: string;
}

interface PullRequestHistoryEntry {
    file: QaapGithubPullRequestFile;
    review: PullRequestReview;
}

interface StoredPullRequestReview {
    decisions: Array<[string, PullRequestReview]>;
    history: Array<{ path: string; review: PullRequestReview }>;
    mergeState?: PullRequestMergeState;
}

export interface MobilePullRequestPanelDelegate {
    onDismiss(): void;
}

const QAAP_MOBILE_PR_STORAGE_PREFIX = 'qaap.mobilePr.review.';

export class MobilePullRequestPanel {

    protected readonly root: HTMLElement;
    protected readonly header: HTMLElement;
    protected readonly progressLabel: HTMLElement;
    protected readonly progressFill: HTMLElement;
    protected readonly approveCount: HTMLElement;
    protected readonly rejectCount: HTMLElement;
    protected readonly noteCount: HTMLElement;
    protected readonly hintRow: HTMLElement;
    protected readonly stack: HTMLElement;
    protected readonly ctaRow: HTMLElement;
    protected readonly toast: HTMLElement;
    protected pullRequests: QaapGithubPullRequestSummary[] = [];
    protected activePullRequest: QaapGithubPullRequestSummary | undefined;
    protected currentRepository: QaapGithubRepositorySummary | undefined;
    protected queue: QaapGithubPullRequestFile[] = [];
    protected decisions = new Map<string, PullRequestReview>();
    protected history: PullRequestHistoryEntry[] = [];
    protected visible = false;
    protected loaded = false;
    protected loading = false;
    protected signedOut = false;
    protected errorMessage: string | undefined;
    protected confirmingMerge = false;
    protected dragStartX = 0;
    protected dragStartY = 0;
    protected dragX = 0;
    protected pointerId: number | undefined;
    protected dragMode: DragMode | undefined;
    protected animating = false;
    protected expanded = false;
    protected mergeState: PullRequestMergeState = 'idle';
    protected mergeTimer: number | undefined;
    protected toastTimer: number | undefined;
    protected mergeError: string | undefined;
    protected dragDismissDispose: Disposable = Disposable.NULL;
    protected pullToRefreshDispose: Disposable = Disposable.NULL;
    /** Bumps on hide so in-flight `loadPullRequests` cannot append stale CTA rows after close. */
    protected loadRequestGeneration = 0;

    constructor(protected readonly delegate: MobilePullRequestPanelDelegate) {
        this.root = document.createElement('div');
        this.root.className = 'theia-mobile-pr';
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.setAttribute('aria-hidden', 'true');
        this.root.hidden = true;

        const grabber = createMobileSheetGrabber();
        this.root.append(grabber);

        this.header = document.createElement('header');
        this.header.className = 'theia-mobile-pr-header';

        const progress = document.createElement('section');
        progress.className = 'theia-mobile-pr-progress';
        progress.setAttribute('aria-live', 'polite');
        this.progressLabel = document.createElement('span');
        this.progressLabel.className = 'theia-mobile-pr-progress-label';
        const track = document.createElement('span');
        track.className = 'theia-mobile-pr-progress-track';
        this.progressFill = document.createElement('span');
        this.progressFill.className = 'theia-mobile-pr-progress-fill';
        track.appendChild(this.progressFill);
        this.approveCount = document.createElement('span');
        this.approveCount.className = 'theia-mobile-pr-count theia-mod-approve';
        this.rejectCount = document.createElement('span');
        this.rejectCount.className = 'theia-mobile-pr-count theia-mod-reject';
        this.noteCount = document.createElement('span');
        this.noteCount.className = 'theia-mobile-pr-count theia-mod-note';
        progress.append(this.progressLabel, track, this.approveCount, this.rejectCount, this.noteCount);

        this.hintRow = document.createElement('div');
        this.hintRow.className = 'theia-mobile-pr-hints';
        this.hintRow.append(
            this.createTextSpan('<- changes'),
            this.createTextSpan('tap to expand'),
            this.createTextSpan('approve ->')
        );

        this.stack = document.createElement('section');
        this.stack.className = 'theia-mobile-pr-stack';

        this.ctaRow = document.createElement('footer');
        this.ctaRow.className = 'theia-mobile-pr-actions';

        this.toast = document.createElement('div');
        this.toast.className = 'theia-mobile-pr-toast';
        this.toast.setAttribute('role', 'status');
        this.toast.setAttribute('aria-live', 'polite');
        this.toast.hidden = true;

        this.root.append(this.header, progress, this.hintRow, this.stack, this.ctaRow, this.toast);

        this.dragDismissDispose = installMobileSheetDragDismiss({
            target: this.root,
            grip: grabber,
            onDismiss: () => this.hide(),
        });

        this.pullToRefreshDispose = installMobilePullToRefresh({
            scroller: this.stack,
            host: this.root,
            onRefresh: async () => {
                this.loaded = false;
                await this.loadPullRequests();
                MobileSnackbar.show(
                    nls.localize('qaap/mobilePr/refreshed', 'Pull requests refreshed'),
                    { kind: 'success', duration: 1400 }
                );
            },
        });
    }

    dispose(): void {
        disposeExtracted(this);
    }

    get node(): HTMLElement {
        return this.root;
    }

    isVisible(): boolean {
        return this.visible;
    }

    show(): void {
        showExtracted(this);
    }

    showWithPullRequest(pullRequest: QaapGithubPullRequestSummary): void {
        showWithPullRequestExtracted(this, pullRequest);
    }

    hide(): void {
        hideExtracted(this);
    }

    protected async loadPullRequests(): Promise<void> {
        return loadPullRequestsExtracted(this);
    }

    protected clearActivePullRequest(): void {
        clearActivePullRequestExtracted(this);
    }

    protected usePullRequest(pullRequest: QaapGithubPullRequestSummary): void {
        usePullRequestExtracted(this, pullRequest);
    }

    protected restoreReviewState(): void {
        restoreReviewStateExtracted(this);
    }

    /** Single place to reset footer actions (avoids stacked rows after re-open). */
    protected clearActionChrome(): void {
        this.root.querySelectorAll('.theia-mobile-pr-button-row, .theia-mobile-pr-quick-row').forEach(el => el.remove());
        this.ctaRow.replaceChildren();
    }

    protected setCtaContent(...nodes: Node[]): void {
        this.ctaRow.replaceChildren(...nodes);
    }

    protected render(): void {
        renderExtracted(this);
    }

    protected renderHeader(): void {
        renderHeaderExtracted(this);
    }

    protected createPullRequestPicker(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        return createPullRequestPickerExtracted(this, pullRequest);
    }

    protected repositoryLabel(): string {
        return repositoryLabelExtracted(this);
    }

    protected renderProgress(reviewed: number, total: number, approved: number, rejected: number, commented: number): void {
        renderProgressExtracted(this, reviewed, total, approved, rejected, commented);
    }

    protected createCardStack(): HTMLElement {
        return createCardStackExtracted(this);
    }

    protected createFileCard(file: QaapGithubPullRequestFile, top: boolean): HTMLElement {
        return createFileCardExtracted(this, file, top);
    }

    protected createDiffLine(line: QaapGithubPullRequestLine): HTMLElement {
        return createDiffLineExtracted(this, line);
    }

    protected createBusyState(): HTMLElement {
        return createBusyStateExtracted(this);
    }

    protected createSkeletonCard(): HTMLElement {
        return createSkeletonCardExtracted(this);
    }

    protected createSignInState(): HTMLElement {
        return createSignInStateExtracted(this);
    }

    protected createErrorState(): HTMLElement {
        return createErrorStateExtracted(this);
    }

    protected createEmptyState(): HTMLElement {
        return createEmptyStateExtracted(this);
    }

    protected createDoneState(stats: ReturnType<MobilePullRequestPanel['reviewStats']>): HTMLElement {
        return createDoneStateExtracted(this, stats);
    }

    protected doneTitle(): string {
        return doneTitleExtracted(this);
    }

    protected doneSummary(stats: ReturnType<MobilePullRequestPanel['reviewStats']>): string {
        return doneSummaryExtracted(this, stats);
    }

    protected renderActions(allReviewed: boolean, stats: ReturnType<MobilePullRequestPanel['reviewStats']>): void {
        renderActionsExtracted(this, allReviewed, stats);
    }

    protected renderReviewedActions(stats: ReturnType<MobilePullRequestPanel['reviewStats']>): void {
        renderReviewedActionsExtracted(this, stats);
    }

    protected resetSheetPresentation(): void {
        resetSheetPresentationExtracted(this);
    }

    protected renderEmptyActions(): void {
        renderEmptyActionsExtracted(this);
    }

    protected renderErrorActions(): void {
        renderErrorActionsExtracted(this);
    }

    protected renderSignInActions(): void {
        renderSignInActionsExtracted(this);
    }

    protected mergeButtonLabel(blockers: number): string {
        return mergeButtonLabelExtracted(this, blockers);
    }

    protected createActionButton(kind: 'primary' | 'secondary' | 'ghost', label: string, icon: string, onClick: () => void): HTMLButtonElement {
        return createActionButtonExtracted(this, kind, label, icon, onClick);
    }

    protected createChipButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
        return createChipButtonExtracted(this, label, icon, onClick);
    }

    protected createStatChip(icon: string, text: string): HTMLElement {
        return createStatChipExtracted(this, icon, text);
    }

    protected onPointerDown(event: PointerEvent, card: HTMLElement): void {
        onPointerDownExtracted(this, event, card);
    }

    protected onPointerMove(event: PointerEvent, card: HTMLElement): void {
        onPointerMoveExtracted(this, event, card);
    }

    protected onPointerUp(event: PointerEvent, card: HTMLElement): void {
        onPointerUpExtracted(this, event, card);
    }

    protected toggleExpanded(): void {
        toggleExpandedExtracted(this);
    }

    protected decideTop(decision: PullRequestDecision, comment?: string): void {
        decideTopExtracted(this, decision, comment);
    }

    protected startMergeConfirmation(): void {
        startMergeConfirmationExtracted(this);
    }

    protected async executeMergeAndDeploy(): Promise<void> {
        return executeMergeAndDeployExtracted(this);
    }

    protected undo(): void {
        undoExtracted(this);
    }

    protected reset(): void {
        resetExtracted(this);
    }

    protected showUndoToast(file: QaapGithubPullRequestFile, review: PullRequestReview): void {
        showUndoToastExtracted(this, file, review);
    }

    protected showToast(message: string, kind: ToastKind = 'default'): void {
        showToastExtracted(this, message, kind);
    }

    protected hideToast(): void {
        hideToastExtracted(this);
    }

    protected fireConfetti(): void {
        fireConfettiExtracted(this);
    }

    protected reviewLabel(review: PullRequestReview): string {
        return reviewLabelExtracted(this, review);
    }

    protected reviewStats(): { total: number; reviewed: number; approved: number; rejected: number; commented: number } {
        return reviewStatsExtracted(this);
    }

    protected findFile(path: string): QaapGithubPullRequestFile | undefined {
        return this.activePullRequest?.filesPreview.find(file => file.f === path);
    }

    protected saveReviewState(): void {
        saveReviewStateExtracted(this);
    }

    protected readStoredReview(pr: QaapGithubPullRequestSummary): StoredPullRequestReview | undefined {
        return readStoredReviewExtracted(this, pr);
    }

    protected storageKey(pr: QaapGithubPullRequestSummary): string {
        return `${QAAP_MOBILE_PR_STORAGE_PREFIX}${pr.owner}/${pr.repo}#${pr.number}`;
    }

    protected clearMergeTimer(): void {
        clearMergeTimerExtracted(this);
    }

    protected delay(ms: number): Promise<void> {
        return delayExtracted(this, ms);
    }

    protected applyDragStyles(host: Element | null, animate = false): void {
        applyDragStylesExtracted(this, host, animate = false);
    }

    protected createTestsPill(tests: QaapGithubPullRequestSummary['tests']): HTMLElement {
        return createTestsPillExtracted(this, tests);
    }

    protected createIcon(icon: string): HTMLElement {
        return createIconExtracted(this, icon);
    }

    protected createTextSpan(text: string): HTMLElement {
        return createTextSpanExtracted(this, text);
    }

    protected createClassedTextSpan(className: string, text: string): HTMLElement {
        return createClassedTextSpanExtracted(this, className, text);
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
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
import { clearActivePullRequestExtracted, createCardStackExtracted, createFileCardExtracted, createPullRequestPickerExtracted, disposeExtracted, hideExtracted, loadPullRequestsExtracted, renderExtracted, renderHeaderExtracted, renderProgressExtracted, repositoryLabelExtracted, restoreReviewStateExtracted, showExtracted, showWithPullRequestExtracted, usePullRequestExtracted } from './mobile-pull-request-panel-render';
import { createActionButtonExtracted, createBusyStateExtracted, createChipButtonExtracted, createDiffLineExtracted, createDoneStateExtracted, createEmptyStateExtracted, createErrorStateExtracted, createSignInStateExtracted, createSkeletonCardExtracted, createStatChipExtracted, doneSummaryExtracted, doneTitleExtracted, mergeButtonLabelExtracted, onPointerDownExtracted, onPointerMoveExtracted, onPointerUpExtracted, renderActionsExtracted, renderEmptyActionsExtracted, renderErrorActionsExtracted, renderReviewedActionsExtracted, renderSignInActionsExtracted, resetSheetPresentationExtracted, toggleExpandedExtracted } from './mobile-pull-request-panel-streaming';
import { applyDragStylesExtracted, clearMergeTimerExtracted, createClassedTextSpanExtracted, createIconExtracted, createTestsPillExtracted, createTextSpanExtracted, decideTopExtracted, delayExtracted, executeMergeAndDeployExtracted, fireConfettiExtracted, hideToastExtracted, readStoredReviewExtracted, resetExtracted, reviewLabelExtracted, reviewStatsExtracted, saveReviewStateExtracted, showToastExtracted, showUndoToastExtracted, startMergeConfirmationExtracted, undoExtracted } from './mobile-pull-request-panel-timeline';

export type PullRequestDecision = 'approved' | 'rejected' | 'commented';
type PullRequestMergeState = 'idle' | 'merging' | 'deploying' | 'merged' | 'failed';
type DragMode = 'horizontal' | 'vertical';
export type ToastKind = 'default' | 'success' | 'error';

export interface PullRequestReview {
    decision: PullRequestDecision;
    comment?: string;
}

interface PullRequestHistoryEntry {
    file: QaapGithubPullRequestFile;
    review: PullRequestReview;
}

export interface StoredPullRequestReview {
    decisions: Array<[string, PullRequestReview]>;
    history: Array<{ path: string; review: PullRequestReview }>;
    mergeState?: PullRequestMergeState;
}

export interface MobilePullRequestPanelDelegate {
    onDismiss(): void;
}

const QAAP_MOBILE_PR_STORAGE_PREFIX = 'qaap.mobilePr.review.';

export class MobilePullRequestPanel {

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly root: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly header: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly progressLabel: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly progressFill: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly approveCount: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly rejectCount: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly noteCount: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly hintRow: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly stack: HTMLElement;
    protected readonly ctaRow: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readonly toast: HTMLElement;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public pullRequests: QaapGithubPullRequestSummary[] = [];
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public activePullRequest: QaapGithubPullRequestSummary | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public currentRepository: QaapGithubRepositorySummary | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public queue: QaapGithubPullRequestFile[] = [];
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public decisions = new Map<string, PullRequestReview>();
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public history: PullRequestHistoryEntry[] = [];
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public visible = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public loaded = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public loading = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public signedOut = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public errorMessage: string | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public confirmingMerge = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public dragStartX = 0;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public dragStartY = 0;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public dragX = 0;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public pointerId: number | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public dragMode: DragMode | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public animating = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public expanded = false;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public mergeState: PullRequestMergeState = 'idle';
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public mergeTimer: number | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public toastTimer: number | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public mergeError: string | undefined;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public dragDismissDispose: Disposable = Disposable.NULL;
    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public pullToRefreshDispose: Disposable = Disposable.NULL;
    /**
     * Bumps on hide so in-flight `loadPullRequests` cannot append stale CTA rows after close.
     * @internal Used by the extracted mobile-pull-request-panel-* modules.
     */
    public loadRequestGeneration = 0;

    constructor(
        /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
        public readonly delegate: MobilePullRequestPanelDelegate,
    ) {
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

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public async loadPullRequests(): Promise<void> {
        return loadPullRequestsExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public clearActivePullRequest(): void {
        clearActivePullRequestExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public usePullRequest(pullRequest: QaapGithubPullRequestSummary): void {
        usePullRequestExtracted(this, pullRequest);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public restoreReviewState(): void {
        restoreReviewStateExtracted(this);
    }

    /**
     * Single place to reset footer actions (avoids stacked rows after re-open).
     * @internal Used by the extracted mobile-pull-request-panel-* modules.
     */
    public clearActionChrome(): void {
        this.root.querySelectorAll('.theia-mobile-pr-button-row, .theia-mobile-pr-quick-row').forEach(el => el.remove());
        this.ctaRow.replaceChildren();
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public setCtaContent(...nodes: Node[]): void {
        this.ctaRow.replaceChildren(...nodes);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public render(): void {
        renderExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderHeader(): void {
        renderHeaderExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createPullRequestPicker(pullRequest: QaapGithubPullRequestSummary): HTMLElement {
        return createPullRequestPickerExtracted(this, pullRequest);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public repositoryLabel(): string {
        return repositoryLabelExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderProgress(reviewed: number, total: number, approved: number, rejected: number, commented: number): void {
        renderProgressExtracted(this, reviewed, total, approved, rejected, commented);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createCardStack(): HTMLElement {
        return createCardStackExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createFileCard(file: QaapGithubPullRequestFile, top: boolean): HTMLElement {
        return createFileCardExtracted(this, file, top);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createDiffLine(line: QaapGithubPullRequestLine): HTMLElement {
        return createDiffLineExtracted(this, line);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createBusyState(): HTMLElement {
        return createBusyStateExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createSkeletonCard(): HTMLElement {
        return createSkeletonCardExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createSignInState(): HTMLElement {
        return createSignInStateExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createErrorState(): HTMLElement {
        return createErrorStateExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createEmptyState(): HTMLElement {
        return createEmptyStateExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createDoneState(stats: ReturnType<MobilePullRequestPanel['reviewStats']>): HTMLElement {
        return createDoneStateExtracted(this, stats);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public doneTitle(): string {
        return doneTitleExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public doneSummary(stats: ReturnType<MobilePullRequestPanel['reviewStats']>): string {
        return doneSummaryExtracted(this, stats);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderActions(allReviewed: boolean, stats: ReturnType<MobilePullRequestPanel['reviewStats']>): void {
        renderActionsExtracted(this, allReviewed, stats);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderReviewedActions(stats: ReturnType<MobilePullRequestPanel['reviewStats']>): void {
        renderReviewedActionsExtracted(this, stats);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public resetSheetPresentation(): void {
        resetSheetPresentationExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderEmptyActions(): void {
        renderEmptyActionsExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderErrorActions(): void {
        renderErrorActionsExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public renderSignInActions(): void {
        renderSignInActionsExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public mergeButtonLabel(blockers: number): string {
        return mergeButtonLabelExtracted(this, blockers);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createActionButton(kind: 'primary' | 'secondary' | 'ghost', label: string, icon: string, onClick: () => void): HTMLButtonElement {
        return createActionButtonExtracted(this, kind, label, icon, onClick);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createChipButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
        return createChipButtonExtracted(this, label, icon, onClick);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createStatChip(icon: string, text: string): HTMLElement {
        return createStatChipExtracted(this, icon, text);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public onPointerDown(event: PointerEvent, card: HTMLElement): void {
        onPointerDownExtracted(this, event, card);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public onPointerMove(event: PointerEvent, card: HTMLElement): void {
        onPointerMoveExtracted(this, event, card);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public onPointerUp(event: PointerEvent, card: HTMLElement): void {
        onPointerUpExtracted(this, event, card);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public toggleExpanded(): void {
        toggleExpandedExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public decideTop(decision: PullRequestDecision, comment?: string): void {
        decideTopExtracted(this, decision, comment);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public startMergeConfirmation(): void {
        startMergeConfirmationExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public async executeMergeAndDeploy(): Promise<void> {
        return executeMergeAndDeployExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public undo(): void {
        undoExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public reset(): void {
        resetExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public showUndoToast(file: QaapGithubPullRequestFile, review: PullRequestReview): void {
        showUndoToastExtracted(this, file, review);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public showToast(message: string, kind: ToastKind = 'default'): void {
        showToastExtracted(this, message, kind);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public hideToast(): void {
        hideToastExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public fireConfetti(): void {
        fireConfettiExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public reviewLabel(review: PullRequestReview): string {
        return reviewLabelExtracted(this, review);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public reviewStats(): { total: number; reviewed: number; approved: number; rejected: number; commented: number } {
        return reviewStatsExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public findFile(path: string): QaapGithubPullRequestFile | undefined {
        return this.activePullRequest?.filesPreview.find(file => file.f === path);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public saveReviewState(): void {
        saveReviewStateExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public readStoredReview(pr: QaapGithubPullRequestSummary): StoredPullRequestReview | undefined {
        return readStoredReviewExtracted(this, pr);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public storageKey(pr: QaapGithubPullRequestSummary): string {
        return `${QAAP_MOBILE_PR_STORAGE_PREFIX}${pr.owner}/${pr.repo}#${pr.number}`;
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public clearMergeTimer(): void {
        clearMergeTimerExtracted(this);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public delay(ms: number): Promise<void> {
        return delayExtracted(this, ms);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public applyDragStyles(host: Element | null, animate = false): void {
        applyDragStylesExtracted(this, host, animate);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createTestsPill(tests: QaapGithubPullRequestSummary['tests']): HTMLElement {
        return createTestsPillExtracted(this, tests);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createIcon(icon: string): HTMLElement {
        return createIconExtracted(this, icon);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createTextSpan(text: string): HTMLElement {
        return createTextSpanExtracted(this, text);
    }

    /** @internal Used by the extracted mobile-pull-request-panel-* modules. */
    public createClassedTextSpan(className: string, text: string): HTMLElement {
        return createClassedTextSpanExtracted(this, className, text);
    }
}

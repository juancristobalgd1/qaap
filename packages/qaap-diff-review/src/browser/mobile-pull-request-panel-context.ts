// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobilePullRequestPanel` and the extracted free functions in the
// `mobile-pull-request-panel-*.ts` cluster. Each extracted function receives the host typed as
// `MobilePullRequestPanelContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobilePullRequestPanel } from './mobile-pull-request-panel';

/** Members referenced by the extracted `mobile-pull-request-panel-*` modules. */
export type MobilePullRequestPanelContextMember =
    | 'activePullRequest'
    | 'animating'
    | 'applyDragStyles'
    | 'approveCount'
    | 'clearActionChrome'
    | 'clearActivePullRequest'
    | 'clearMergeTimer'
    | 'confirmingMerge'
    | 'createActionButton'
    | 'createBusyState'
    | 'createCardStack'
    | 'createChipButton'
    | 'createClassedTextSpan'
    | 'createDiffLine'
    | 'createDoneState'
    | 'createEmptyState'
    | 'createErrorState'
    | 'createFileCard'
    | 'createIcon'
    | 'createPullRequestPicker'
    | 'createSignInState'
    | 'createSkeletonCard'
    | 'createStatChip'
    | 'createTestsPill'
    | 'createTextSpan'
    | 'currentRepository'
    | 'decideTop'
    | 'decisions'
    | 'delay'
    | 'delegate'
    | 'doneSummary'
    | 'doneTitle'
    | 'dragDismissDispose'
    | 'dragMode'
    | 'dragStartX'
    | 'dragStartY'
    | 'dragX'
    | 'errorMessage'
    | 'executeMergeAndDeploy'
    | 'expanded'
    | 'findFile'
    | 'fireConfetti'
    | 'header'
    | 'hideToast'
    | 'hintRow'
    | 'history'
    | 'loadPullRequests'
    | 'loadRequestGeneration'
    | 'loaded'
    | 'loading'
    | 'mergeButtonLabel'
    | 'mergeError'
    | 'mergeState'
    | 'mergeTimer'
    | 'noteCount'
    | 'onPointerDown'
    | 'onPointerMove'
    | 'onPointerUp'
    | 'pointerId'
    | 'progressFill'
    | 'progressLabel'
    | 'pullRequests'
    | 'pullToRefreshDispose'
    | 'queue'
    | 'readStoredReview'
    | 'rejectCount'
    | 'render'
    | 'renderActions'
    | 'renderEmptyActions'
    | 'renderErrorActions'
    | 'renderHeader'
    | 'renderProgress'
    | 'renderReviewedActions'
    | 'renderSignInActions'
    | 'repositoryLabel'
    | 'reset'
    | 'resetSheetPresentation'
    | 'restoreReviewState'
    | 'reviewLabel'
    | 'reviewStats'
    | 'root'
    | 'saveReviewState'
    | 'setCtaContent'
    | 'showToast'
    | 'showUndoToast'
    | 'signedOut'
    | 'stack'
    | 'startMergeConfirmation'
    | 'storageKey'
    | 'toast'
    | 'toastTimer'
    | 'toggleExpanded'
    | 'undo'
    | 'usePullRequest'
    | 'visible';

/**
 * Members of {@link MobilePullRequestPanel} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobilePullRequestPanelContext
    extends Pick<MobilePullRequestPanel, MobilePullRequestPanelContextMember> { }

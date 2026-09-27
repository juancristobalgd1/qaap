// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsTranscriptMessagesRenderUi` and the extracted free functions in the
// `mobile-projects-transcript-messages-render-ui-*.ts` cluster. Each extracted function receives the UI typed as
// `MobileProjectsTranscriptMessagesRenderUiContext` instead of `any`. As with `MobileProjectsTranscriptSurfacesUiContext`, the
// contract is picked from the class over an explicit member list, so every member keeps the exact
// type the class declares. Members named here are `public` (+ `@internal` where they used to be
// `protected`) on the class. `import type` keeps this free of a runtime import cycle (the class
// imports every extracted module).

import type { MobileProjectsTranscriptMessagesRenderUi } from './mobile-projects-transcript-messages-render-ui';

/** Members referenced by the extracted `mobile-projects-transcript-messages-render-ui-*` modules. */
export type MobileProjectsTranscriptMessagesRenderUiContextMember =
    | 'applyTranscriptScrollAfterMutation'
    | 'artifactsUi'
    | 'attachTranscriptScrollChrome'
    | 'buildTranscriptAgentFailureDialogOptions'
    | 'buildTranscriptVirtualFooter'
    | 'cancelQueuedMessage'
    | 'captureTranscriptScrollAnchor'
    | 'clearTranscriptEmptyQuickActions'
    | 'contentUi'
    | 'createTranscriptAgentFailureRow'
    | 'createTranscriptContextCompactionRow'
    | 'createTranscriptEmptyWelcome'
    | 'createTranscriptMessageRow'
    | 'createTranscriptMessageRowAtIndex'
    | 'dispatchQueuedMessage'
    | 'ensureLiveStatusBeforeRemovingActivityRow'
    | 'findAppendedUserMessageIndex'
    | 'findLastUserMessageIndex'
    | 'findLastUserMessageRow'
    | 'findTranscriptStreamingActivityRow'
    | 'hasExplicitTranscriptMessageHash'
    | 'host'
    | 'lastAgentPatchRejectReason'
    | 'markTranscriptMessageRow'
    | 'normalizeConversationFailuresCached'
    | 'normalizedFailuresCache'
    | 'positionTranscriptVirtualListAtUserTurn'
    | 'prepareTranscriptReadingAnchorWindow'
    | 'removeTranscriptActivityRow'
    | 'renderTranscriptMessagesVirtual'
    | 'resolveTranscriptAgentSegments'
    | 'resolveTranscriptMessageHost'
    | 'resolveTranscriptScrollController'
    | 'restoreTranscriptOpeningPosition'
    | 'restoreTranscriptOpeningPositionVirtual'
    | 'scheduleTranscriptScrollAfterMutation'
    | 'scrollTranscriptFollowTail'
    | 'scrollTranscriptToLastUserTurn'
    | 'scrollTranscriptTurnStartIntoReadingPosition'
    | 'scrollTranscriptVirtualListToIndex'
    | 'setTranscriptAgentSegmentsCacheEntry'
    | 'shouldFollowTranscriptTail'
    | 'syncTranscriptActivityRow'
    | 'syncTranscriptAgentSegmentsCache'
    | 'toolUi'
    | 'transcriptAgentSegmentsCache'
    | 'transcriptAgentSegmentsCacheConversationId'
    | 'transcriptAgentSegmentsCacheKey'
    | 'transcriptAgentSegmentsCacheKeyByMessage'
    | 'transcriptContextCompactionBoundaryIndex'
    | 'transcriptRowRenderKey'
    | 'transcriptScrollChromeBoundConversationId'
    | 'transcriptSegmentsSignature'
    | 'transcriptTextSignature'
    | 'tryPatchStreamingAgentTextContent'
    | 'tryPatchStreamingTranscriptMessages'
    | 'tryPatchStreamingTranscriptVirtual'
    | 'userUi'
    | 'withDerivedTranscriptSegments'
    | 'workHub';

/**
 * Members of {@link MobileProjectsTranscriptMessagesRenderUi} that the extracted helper functions access through their `ctx`
 * parameter.
 */
export interface MobileProjectsTranscriptMessagesRenderUiContext
    extends Pick<MobileProjectsTranscriptMessagesRenderUi, MobileProjectsTranscriptMessagesRenderUiContextMember> { }

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsTranscriptLiveUi` and the extracted free functions in the
// `mobile-projects-transcript-live-ui-*.ts` cluster. Each extracted function receives the host typed as
// `MobileProjectsTranscriptLiveUiContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';

/** Members referenced by the extracted `mobile-projects-transcript-live-ui-*` modules. */
export type MobileProjectsTranscriptLiveUiContextMember =
    | 'agUiLiveBridge'
    | 'applyTranscriptSseRender'
    | 'bindOpenTranscriptThreadStore'
    | 'bootstrapPreviewListenerInitialized'
    | 'buildTranscriptApprovalSyncKey'
    | 'cacheTranscriptConversation'
    | 'clearTranscriptSemanticProgressClock'
    | 'conversationTranscriptFingerprint'
    | 'doRefreshOpenTranscriptConversation'
    | 'ensureTranscriptConversationRefresh'
    | 'ensureTranscriptDevPreviewWatch'
    | 'ensureTranscriptLiveController'
    | 'finalizeTranscriptDevPreviewAfterSettle'
    | 'findTranscriptToolSegment'
    | 'flushPendingSseRender'
    | 'hasPendingTranscriptToolApproval'
    | 'host'
    | 'isActiveTranscriptConversation'
    | 'isActiveTranscriptNearBottom'
    | 'isWatchingOpenTranscript'
    | 'kickoffTranscriptDevPreviewBootstrap'
    | 'lastInlineApprovalSyncKey'
    | 'lastMountedApprovalId'
    | 'maybeActivateTranscriptDevPreview'
    | 'maybeReportTranscriptPreviewBootstrapFailure'
    | 'maybeSyncTranscriptVisuallySettledChrome'
    | 'openReadyTranscriptPreviewUrl'
    | 'pauseTranscriptBackgroundRenders'
    | 'peekCachedOpenTranscript'
    | 'pendingSseRenderConv'
    | 'readCachedTranscriptConversation'
    | 'readOpenTranscriptRollbackSnapshot'
    | 'reconcileConversationListSummary'
    | 'reconcileTranscriptInlineToolApprovalCards'
    | 'refreshInFlight'
    | 'refreshInFlightConversationId'
    | 'refreshOpenTranscriptConversation'
    | 'refreshTranscriptApprovals'
    | 'refreshTranscriptPreviewOffer'
    | 'resolveActiveTranscriptChatHost'
    | 'resolveLiveSseMessage'
    | 'resolveOpenTranscriptConversation'
    | 'resolveReadyTranscriptPreviewUrl'
    | 'resolveTranscriptPreviewPollIntervalMs'
    | 'resolveTranscriptRefreshContext'
    | 'schedulePendingSseRender'
    | 'scheduleSseDeltaResync'
    | 'scheduleTranscriptApprovalRefresh'
    | 'scheduleTranscriptComposerActivityRefresh'
    | 'scheduleTranscriptConversationRefresh'
    | 'scheduleTranscriptPreviewOfferRefresh'
    | 'scheduleTranscriptVisualVerificationPoll'
    | 'seedTranscriptSemanticProgressClock'
    | 'sseDeltaResyncTimer'
    | 'sseRenderRafId'
    | 'sseRenderTimer'
    | 'stopTranscriptApprovalRefresh'
    | 'stopTranscriptComposerActivityRefresh'
    | 'stopTranscriptPreviewOfferRefresh'
    | 'stopTranscriptVisualVerificationPoll'
    | 'syncTranscriptConversationSettledChrome'
    | 'syncTranscriptPendingApproval'
    | 'threadStoreSummaryDispose'
    | 'touchTranscriptSemanticProgressFromConversation'
    | 'touchTranscriptTransportEvent'
    | 'transcriptComposerActivityIdleHandle'
    | 'transcriptComposerActivityTimer'
    | 'transcriptDevPreviewBootstrapConversationId'
    | 'transcriptLiveController'
    | 'transcriptPreviewFailureReportedFor'
    | 'transcriptPreviewOfferAnnouncedUrl'
    | 'transcriptPreviewOfferTimer'
    | 'transcriptPreviewPollIntervalMs'
    | 'transcriptPreviewPollMisses'
    | 'transcriptPreviewSettlePollUntil'
    | 'transcriptTurnVisuallySettledActive'
    | 'transcriptVisualVerificationPollTimer'
    | 'transcriptVisualVerificationPollUntil'
    | 'visibilityResumeListenerInstalled';

/**
 * Members of {@link MobileProjectsTranscriptLiveUi} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsTranscriptLiveUiContext
    extends Pick<MobileProjectsTranscriptLiveUi, MobileProjectsTranscriptLiveUiContextMember> { }

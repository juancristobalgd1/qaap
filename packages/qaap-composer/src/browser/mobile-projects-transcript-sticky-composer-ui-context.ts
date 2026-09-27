// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsTranscriptStickyComposerUi` and the extracted free
// functions in the `mobile-projects-transcript-sticky-composer-ui-*.ts` cluster. Each extracted
// function receives the UI typed as `MobileProjectsTranscriptStickyComposerUiContext` instead of
// `any`. As with `MobileProjectsTranscriptSurfacesUiContext`, the contract is picked from the class
// over an explicit member list, so every member keeps the exact type the class declares. Members
// named here are `public` (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';

/** Members referenced by the extracted `mobile-projects-transcript-sticky-composer-ui-*` modules. */
export type MobileProjectsTranscriptStickyComposerUiContextMember =
    | 'agentsHubIdleComposerMounted'
    | 'appendRunningGitActionToTranscript'
    | 'applyGitActionTranscriptConversation'
    | 'applyTranscriptComposerPrefs'
    | 'applyTranscriptComposerPrefsFromConversation'
    | 'buildComposerActivityFingerprint'
    | 'buildGitActionMetadata'
    | 'buildTranscriptComposerActivityOptions'
    | 'clearComposerPreviewHealthTimer'
    | 'clearIdleComposerFocusRetention'
    | 'clearStaleComposerGitLatches'
    | 'composerActivityGitFilesByConversationId'
    | 'composerChangedFilesBulkBusy'
    | 'composerChangesResolvedByConversationId'
    | 'composerCleanTreeByConversationId'
    | 'composerCommitBusy'
    | 'composerPreviewHealthTimer'
    | 'composerPreviewLastCheckedAt'
    | 'composerPreviewProbeInFlight'
    | 'dispatchQueuedFollowUpInParallel'
    | 'enqueueTranscriptFollowUp'
    | 'ensureTranscriptComposerPrefsForMount'
    | 'fetchWorkspaceChangedFiles'
    | 'hasComposerAgentActivity'
    | 'hasComposerCommittableChangesFromGit'
    | 'hasComposerFileActivity'
    | 'host'
    | 'hydrateTranscriptComposerPrefs'
    | 'idleComposerAutofocusDeadline'
    | 'idleComposerFocusRetentionDispose'
    | 'interruptQueuedFollowUp'
    | 'isComposerBackgroundWorkAllowed'
    | 'isTranscriptFollowUpReady'
    | 'isTranscriptStickyComposerAgentBeamIdle'
    | 'isTranscriptStickyComposerAgentWorking'
    | 'keepAllComposerChangedFiles'
    | 'lastComposerActivityFingerprint'
    | 'lastComposerActivityStackFingerprint'
    | 'lastComposerChangesPillFingerprint'
    | 'launchComposerDevPreview'
    | 'mapGitChangedFileToComposerView'
    | 'markPendingGitActionFailed'
    | 'mirrorFollowUpToServerQueue'
    | 'mountTranscriptStickyComposer'
    | 'mountTranscriptStickyComposerAsync'
    | 'onTranscriptComposerAttach'
    | 'openComposerPreview'
    | 'peekTranscriptComposerChangedFilesExpanded'
    | 'pendingGitActionMessageId'
    | 'persistTranscriptComposerPrefs'
    | 'queuePeerRunMessage'
    | 'recordComposerGitActionInTranscript'
    | 'refreshComposerActivityGitFilesIfNeeded'
    | 'refreshComposerActivityStack'
    | 'remountTranscriptStickyComposer'
    | 'resolveChangedFilesStats'
    | 'resolveComposerActivityFilesForStack'
    | 'resolveComposerPreviewRuntime'
    | 'resolveComposerTranscriptChatHost'
    | 'resolveComposerUploadTargetDir'
    | 'resolveComposerWorkspaceRoot'
    | 'resolveGitCommitWorkflowLabel'
    | 'resolveTranscriptContextUsageTarget'
    | 'resolveTranscriptTheiaChatModel'
    | 'runComposerCommitAction'
    | 'runComposerGitFileAction'
    | 'scheduleComposerPreviewHealthCheck'
    | 'scheduleIdleComposerFocusRetention'
    | 'schedulePersistTranscriptComposerDraft'
    | 'sendQueuedFollowUpNow'
    | 'setTranscriptComposerChangedFilesExpanded'
    | 'shouldRefetchComposerGitSnapshot'
    | 'startIsolatedRunIfRequested'
    | 'startPeerRunOrQueue'
    | 'stopOpenComposerAgentLikeComposerStop'
    | 'submitQueuedFollowUpEntry'
    | 'submitTranscriptComposerDraft'
    | 'syncComposerActivityFingerprint'
    | 'syncComposerGitSnapshot'
    | 'syncComposerPreviewAvailability'
    | 'syncTranscriptComposerQuickActionsVisibility'
    | 'syncTranscriptQueuedFollowUpBubbles'
    | 'undoAllComposerChangedFiles'
    | 'verifiedComposerPreview'
    | 'workHub';

/**
 * Members of {@link MobileProjectsTranscriptStickyComposerUi} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsTranscriptStickyComposerUiContext
    extends Pick<MobileProjectsTranscriptStickyComposerUi, MobileProjectsTranscriptStickyComposerUiContextMember> { }

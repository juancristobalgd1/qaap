// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { QuickInputService } from '@theia/core/lib/common/quick-pick-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatMode, ChatModel } from '@theia/ai-chat';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    conversationToSummary,
    getConversation,
    isMaxConcurrentRunsError,
    recordConversationGitAction,
    updateConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
} from '../common/qaap-agent-conversation-client';
import { createComposerGitActionDisplayMarker, type ComposerGitActionDisplayMetadata } from '../common/qaap-composer-git-action-display';
import {
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    QAAP_PRIMARY_AGENT_ID,
    readStoredAgentModel,
    resolveExplicitAgentForSubmit,
    type QaapAgentTaskAgentOption,
} from '../common/qaap-agent-task-client';
import { warmAgentTurnPath } from '../common/qaap-agent-turn-warm';
import { formatCommitFeedback } from '../common/qaap-commit-feedback';
import { createComposerContextEntry } from '../common/qaap-composer-context-entry';
import { isTranscriptAgentExecutionBusy, resolveTranscriptEffectiveStatus, isTranscriptSummaryAgentWorking, shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import { mergePendingUserMessagesWithLocalQueue } from '../common/qaap-pending-user-messages-merge';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import {
    resolveChatModelContextUsageBreakdown,
    resolveVpsContextUsageBreakdown,
} from './qaap-chat-context-usage-panel';
import {
    applyConversationComposerPrefs,
    applyProjectComposerDefaults,
    buildRuntimeComposerPersistPatch,
    clearConversationComposerDraft,
    extractConversationComposerPrefs,
    extractConversationComposerPrefsFromSummary,
    readConversationComposerDraft,
    writeConversationComposerDraft,
} from '../common/qaap-conversation-composer-state';
import {
    describeComposerInteractionMode,
    reconcileComposerModeId,
    resolveComposerModeLabel,
    resolveStickyComposerModes,
} from '../common/qaap-sticky-composer-mode';
import {
    reconcileModelCapabilityLevel,
} from '../common/qaap-sticky-composer-model-capability';
import {
    agentSupportsApprovalPolicy,
    reconcileAgentApprovalPolicyId,
    resolveComposerAutoApprove,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    MAX_TRANSCRIPT_FOLLOW_UP_QUEUE,
    TranscriptFollowUpQueue,
    type TranscriptFollowUpEntry,
} from '../common/qaap-transcript-follow-up-queue';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { readProjectComposerDraft, writeProjectComposerDraft } from '../common/qaap-project-composer-draft';
import type { StickyComposerContextChipView } from './qaap-sticky-composer-context-ui';
import { collectComposerImagePreviews } from './qaap-sticky-composer-context-ui';
import {
    composerContextRequests,
    disposeComposerContextEntries,
    hasPendingComposerContextEntries,
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import type { StickyComposerTokenOption } from '../common/qaap-sticky-composer-mention';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import { createStickyComposerImprovePromptHandler } from './qaap-composer-prompt-improve-handler';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import { MobileSnackbar } from './mobile-snackbar';
import {
    QAAP_GIT_REVIEW_API_PATH,
    type QaapGitChangedFile,
    type QaapGitCommitWorkflowAction,
} from '../common/qaap-git-review';
import {
    renderStickyComposerActivityStack,
    buildStickyComposerActivityStackFingerprint,
    buildStickyComposerChangesPillFingerprint,
    patchStickyComposerActivityStack,
    patchStickyComposerChangesPillHost,
    renderStickyComposerChangesPill,
    selectComposerPillChanges,
    type StickyComposerActivityStackOptions,
    type StickyComposerChangedFileView,
} from './qaap-sticky-composer-activity-stack';
import { syncTranscriptQueuedBubbles } from './qaap-transcript-queued-bubbles';
import {
    mergeFailedComposerDraft,
    isIdleComposerFocusStealable,
    hasComposerAgentActivity as hasComposerAgentActivityHelper,
    resolveChangedFilesStats as resolveChangedFilesStatsHelper,
    mapGitChangedFileToComposerView as mapGitChangedFileToComposerViewHelper,
    resolveGitCommitWorkflowLabel as resolveGitCommitWorkflowLabelHelper,
    isComposerBackgroundWorkAllowed as isComposerBackgroundWorkAllowedHelper,
} from './mobile-projects-transcript-sticky-composer-helpers';
// Re-export public API functions from the helpers module.
export { mergeFailedComposerDraft, isIdleComposerFocusStealable } from './mobile-projects-transcript-sticky-composer-helpers';
import {
    parkWorkingControlFromAncestor,
    transferWorkingControlToHost,
} from './qaap-sticky-composer-working-agents-popover';
import { transferStepPillToHost } from './qaap-sticky-composer-step-pill';
import { probeQaapDevPreviewPort, probeQaapIdentityPreview } from './qaap-dev-preview-client';
import { extractTranscriptPreviewId } from './mobile-projects-transcript-messages-content-ui';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import {
    openCurrentComposerPreview,
    resolveComposerPreviewCandidate,
    resolveVerifiedComposerPreviewUrl,
    type ComposerPreviewRuntime,
} from './qaap-composer-preview-action';
import { applyTranscriptComposerPrefsExtracted, applyTranscriptComposerPrefsFromConversationExtracted, ensureTranscriptComposerPrefsForMountExtracted, flushTranscriptComposerDraftExtracted, flushTranscriptComposerPrefsExtracted, hydrateTranscriptComposerPrefsExtracted, isTranscriptStickyComposerAgentWorkingExtracted, mirrorFollowUpToServerQueueExtracted, mountTranscriptStickyComposerExtracted, persistTranscriptComposerPrefsExtracted, queuePeerRunMessageExtracted, resetToProjectComposerDefaultsExtracted, schedulePersistTranscriptComposerDraftExtracted, schedulePersistTranscriptComposerPrefsExtracted, startPeerRunOrQueueExtracted, stopOpenComposerAgentLikeComposerStopExtracted, submitQueuedFollowUpEntryExtracted } from './mobile-projects-transcript-sticky-composer-ui-activity2';
import { remountTranscriptStickyComposerExtracted, submitTranscriptComposerDraftExtracted } from './mobile-projects-transcript-sticky-composer-ui-live-status2';
import { clearComposerPreviewHealthTimerExtracted, enqueueTranscriptFollowUpExtracted, fetchWorkspaceChangedFilesExtracted, hasComposerAgentActivityExtracted, hasComposerCommittableChangesFromGitExtracted, hasComposerFileActivityExtracted, onTranscriptComposerAttachExtracted, openComposerPreviewExtracted, resolveChangedFilesStatsExtracted, resolveComposerActivityFilesForStackExtracted, resolveComposerPreviewRuntimeExtracted, resolveComposerUploadTargetDirExtracted, resolveComposerWorkspaceRootExtracted, resolveTranscriptContextUsageTargetExtracted, resolveTranscriptTheiaChatModelExtracted, scheduleComposerPreviewHealthCheckExtracted, scheduleIdleComposerFocusRetentionExtracted, shouldRefetchComposerGitSnapshotExtracted, syncComposerPreviewAvailabilityExtracted, syncTranscriptComposerQuickActionsVisibilityExtracted } from './mobile-projects-transcript-sticky-composer-ui-render2';
import { buildGitActionMetadataExtracted, buildTranscriptComposerActivityOptionsExtracted, keepAllComposerChangedFilesExtracted, launchComposerDevPreviewExtracted, refreshComposerActivityGitFilesIfNeededExtracted, runComposerCommitActionExtracted, runComposerGitFileActionExtracted, submitRunGeneratedAppFollowUpExtracted, syncComposerGitSnapshotExtracted, undoAllComposerChangedFilesExtracted } from './mobile-projects-transcript-sticky-composer-ui-streaming2';
import { appendRunningGitActionToTranscriptExtracted, applyGitActionTranscriptConversationExtracted, buildComposerActivityFingerprintExtracted, buildTranscriptComposerActivityStackExtracted, buildTranscriptComposerChangesPillExtracted, dispatchQueuedFollowUpInParallelExtracted, flushTranscriptFollowUpQueueExtracted, interruptQueuedFollowUpExtracted, isTranscriptFollowUpReadyExtracted, markPendingGitActionFailedExtracted, recordComposerGitActionInTranscriptExtracted, refreshComposerActivityStackExtracted, refreshTranscriptComposerActivityIfNeededExtracted, sendQueuedFollowUpNowExtracted, startIsolatedRunIfRequestedExtracted, syncComposerActivityFingerprintExtracted } from './mobile-projects-transcript-sticky-composer-ui-timeline2';
import { mountTranscriptStickyComposerAsyncExtracted } from './mobile-projects-transcript-sticky-composer-ui-tool-pills2';

export const COMPOSER_PREVIEW_HEALTH_INTERVAL_MS = 5_000;

export interface TranscriptStickyComposerColumnOptions {
    project: MobileProjectEntry;
    surface?: string;
    agentLocked?: boolean;
    getContext: () => StickyComposerContextEntry[];
    clearContext: () => void;
    removeContextItem: (index: number) => void;
    formatContextChip: (item: StickyComposerContextEntry) => StickyComposerContextChipView;
    filesExpanded?: boolean;
    onFilesExpandedChange?: (expanded: boolean) => void;
    getDraft: () => string;
    setDraft: (value: string) => void;
    resolveAgentLabel: () => string;
    resolveAgentId: () => string;
    modes?: readonly ChatMode[];
    resolveModeLabel?: () => string;
    resolveModeId?: () => string | undefined;
    onOpenModeSheet?: (anchor: HTMLButtonElement) => void;
    approvalPolicyId?: QaapAgentApprovalPolicyId;
    onOpenApprovalPolicySheet?: (anchor: HTMLButtonElement) => void;
    canSubmit: boolean;
    isAgentWorking?: () => boolean;
    onStop?: () => void;
    onAttach: (anchor: HTMLElement) => void;
    onOpenAgentSheet: (anchor: HTMLButtonElement) => void;
    onSubmit: (draft: string) => void;
    sendLabel?: string;
    onSendControlMounted?: (refresh: () => void) => void;
    inputPlaceholder?: string;
    getMentionOptions?: () => readonly StickyComposerTokenOption[];
    getVariableOptions?: () => readonly StickyComposerTokenOption[];
    onContextUsageBadgeMounted?: (badge: HTMLElement) => void;
    showWorkspaceBar?: boolean;
    transcriptOverlay?: boolean;
}

/** Preserve both a failed send and anything the user typed while it was in flight. */
/** Panel surface for transcript sticky composer mount, prefs persistence, and follow-up queue. */
export interface MobileProjectsTranscriptStickyComposerHost {
    /** Resolves when the frontend app reached 'ready' (immediately if unwired). */
    whenFrontendReady?(): Promise<void>;
    /** Fresh resolution of the Agents Hub shell's project/summary (see submit-time re-resolution). */
    resolveAgentsHubShellProject?(): MobileProjectEntry | undefined;
    resolveAgentsHubShellSummary?(project: MobileProjectEntry): QaapAgentConversationSummaryDTO;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerMountKey: string | undefined;
    transcriptComposerProject: MobileProjectEntry | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptComposerContext: StickyComposerContextEntry[];
    transcriptComposerFilesExpanded: boolean;
    transcriptComposerQueueExpanded: boolean;
    transcriptComposerChangedFilesExpandedById: Map<string, boolean>;
    transcriptComposerDraft: string;
    transcriptComposerSendRefresh: (() => void) | undefined;
    stickyComposerContextUsageDispose: Disposable;
    transcriptComposerModeId: string | undefined;
    transcriptComposerCapabilityLevel: import('../common/qaap-sticky-composer-model-capability').ModelCapabilityLevelValue | undefined;
    transcriptComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    transcriptComposerToolApprovalRules: QaapAgentToolApprovalRules | undefined;
    transcriptComposerPinnedAgentId: string | undefined;
    transcriptComposerAgentModel: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel | undefined;
    transcriptComposerPrefsConvId: string | undefined;
    transcriptComposerDraftPersistTimer: number | undefined;
    transcriptComposerPrefsPersistTimer: number | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptLastStreamProgressAt: number | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptComposerBackendAgents: QaapAgentTaskAgentOption[];
    agentsHubShellActive: boolean;
    transcriptFollowUpFlushInFlight: boolean;
    transcriptFollowUpQueue: TranscriptFollowUpQueue;
    transcriptTheiaSessionByConversationId: ReadonlyMap<string, string>;
    projectsService: MobileProjectsService;
    projectBootstrap?: QaapProjectBootstrapService;
    chatAgentService?: ChatAgentService;
    chatService?: import('@theia/ai-chat').ChatService;
    messageService?: MessageService;
    /** Quick input for the commit split-button branch-name prompt (and message fallback). */
    quickInputService?: QuickInputService;
    /** Generates commit messages automatically from the diff (Cursor-agents style). */
    commitMessageAi?: import('./qaap-commit-message-ai').QaapCommitMessageAi;
    /** Rewrites composer drafts via the selected language model. */
    composerPromptImprover?: import('./qaap-composer-prompt-improver').QaapComposerPromptImprover;
    /** Command registry for opening the Create-PR flow after a commit. */
    commands?: CommandRegistry;
    conversations?: MobileProjectsConversations;
    getComposerVariables?: unknown;
    getComposerSkills?: () => readonly { readonly name: string; readonly description?: string }[];
    getComposerSlashCommands?: (agentId?: string) => readonly import('@theia/ai-core').PromptFragment[];
    pickContextVariable?: (
        anchor: HTMLElement,
        handlers: MobileComposerAttachHandlers,
    ) => Promise<import('@theia/ai-core').AIVariableResolutionRequest[]>;
    resolveAttachmentPreview?: (
        item: import('@theia/ai-core').AIVariableResolutionRequest,
    ) => Promise<string | undefined>;
    transcriptComposerUi: MobileProjectsTranscriptComposerUi;

    onCancelConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    submitBackgroundAgentTask(
        project: MobileProjectEntry,
        draft: string,
        options: Record<string, unknown>,
    ): Promise<QaapAgentConversationSummaryDTO | undefined>;
    submitTranscriptViaBackendConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        draft: string,
        options: Record<string, unknown>,
    ): Promise<boolean>;
    resolveActiveTranscriptChatHost(): HTMLElement | undefined;
    stickyComposerColumnUi: import('./mobile-projects-sticky-composer-column-ui').MobileProjectsStickyComposerColumnUi;
    stickyComposerWorkspaceUi: import('./mobile-projects-sticky-composer-workspace-ui').MobileProjectsStickyComposerWorkspaceUi;
    stickyComposerContextUi: import('./mobile-projects-sticky-composer-context-ui').MobileProjectsStickyComposerContextUi;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    stickyComposerSheetsUi: import('./mobile-projects-sticky-composer-sheets-ui').MobileProjectsStickyComposerSheetsUi;
    composerHeaderUi: import('./mobile-projects-composer-header-ui').MobileProjectsComposerHeaderUi;
    updateWorkingPillChrome(): void;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    chatServiceSummariesUi: import('./mobile-projects-chat-service-summaries-ui').MobileProjectsChatServiceSummariesUi;
    transcriptMessagesUi: import('./mobile-projects-transcript-messages-ui').MobileProjectsTranscriptMessagesUi;
    handleComposerContextItemRemoved(entry: StickyComposerContextEntry): void;
    executionSurfaceTabsUi: import('./mobile-projects-execution-surface-tabs-ui').MobileProjectsExecutionSurfaceTabsUi;
    transcriptLiveUi: import('./mobile-projects-transcript-live-ui').MobileProjectsTranscriptLiveUi;
    beginTranscriptDevPreviewRequest(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void;
}

/** Transcript overlay sticky composer: mount, prefs, follow-up queue, and submit wiring. */
export class MobileProjectsTranscriptStickyComposerUi {

    protected lastComposerActivityFingerprint = '';
    protected lastComposerChangesPillFingerprint = '';
    protected lastComposerActivityStackFingerprint = '';
    protected readonly composerActivityGitFilesByConversationId = new Map<string, StickyComposerChangedFileView[]>();
    /** Conversations whose changes were resolved while the git snapshot was absent or clean. */
    protected readonly composerChangesResolvedByConversationId = new Set<string>();
    /** Conversations whose working tree is clean (nothing to commit) — the Commit button stays
     *  hidden across a momentary snapshot gap until fresh changes appear. */
    protected readonly composerCleanTreeByConversationId = new Set<string>();
    protected composerChangedFilesBulkBusy = false;
    protected composerCommitBusy = false;
    protected verifiedComposerPreview: { readonly projectId: string; readonly url: string } | undefined;
    protected composerPreviewProbeInFlight: Promise<void> | undefined;
    protected composerPreviewLastCheckedAt = 0;
    protected composerPreviewHealthTimer: number | undefined;
    protected pendingGitActionMessageId: string | undefined;

    /** Tracks whether the Agents Hub idle (pre-conversation) composer is currently mounted, to drive autofocus-on-ready. */
    protected agentsHubIdleComposerMounted = false;

    /** Disposer for the idle-composer focus-retention watchers (see mount). */
    protected idleComposerFocusRetentionDispose: (() => void) | undefined;

    /** Autofocus is only attempted during the boot window after construction. */
    protected readonly idleComposerAutofocusDeadline = Date.now() + 20_000;

    protected clearIdleComposerFocusRetention(): void {
        this.idleComposerFocusRetentionDispose?.();
        this.idleComposerFocusRetentionDispose = undefined;
    }

    protected scheduleIdleComposerFocusRetention(textarea: HTMLTextAreaElement): void {
        scheduleIdleComposerFocusRetentionExtracted(this, textarea);
    }

    constructor(
        protected readonly host: MobileProjectsTranscriptStickyComposerHost,
        protected readonly workHub: WorkHubTranscriptBridge,
    ) { }

    protected isComposerBackgroundWorkAllowed(): boolean {
        return isComposerBackgroundWorkAllowedHelper();
    }

    protected resolveComposerPreviewRuntime(project: MobileProjectEntry): ComposerPreviewRuntime {
        return resolveComposerPreviewRuntimeExtracted(this, project);
    }

    protected clearComposerPreviewHealthTimer(): void {
        clearComposerPreviewHealthTimerExtracted(this);
    }

    protected scheduleComposerPreviewHealthCheck(projectId: string): void {
        scheduleComposerPreviewHealthCheckExtracted(this, projectId);
    }

    protected syncComposerPreviewAvailability(project: MobileProjectEntry, candidate: string | undefined): void {
        syncComposerPreviewAvailabilityExtracted(this, project, candidate);
    }

    protected async openComposerPreview(projectId: string): Promise<void> {
        return openComposerPreviewExtracted(this, projectId);
    }

    protected peekTranscriptComposerChangedFilesExpanded(summaryId: string): boolean {
        return this.host.transcriptComposerChangedFilesExpandedById.get(summaryId) ?? true;
    }

    protected setTranscriptComposerChangedFilesExpanded(summaryId: string, expanded: boolean): void {
        this.host.transcriptComposerChangedFilesExpandedById.set(summaryId, expanded);
    }

    /** Prefer the live inline/overlay host — mount-time chatHost can go stale after renderList(). */
    protected resolveComposerTranscriptChatHost(fallback?: HTMLElement): HTMLElement | undefined {
        return this.host.resolveActiveTranscriptChatHost() ?? fallback;
    }

    syncTranscriptComposerQuickActionsVisibility(host: HTMLElement, summary: QaapAgentConversationSummaryDTO,): void {
        syncTranscriptComposerQuickActionsVisibilityExtracted(this, host, summary);
    }

    async onTranscriptComposerAttach(project: MobileProjectEntry, anchor: HTMLElement,): Promise<void> {
        return onTranscriptComposerAttachExtracted(this, project, anchor);
    }

    protected resolveComposerUploadTargetDir(project: MobileProjectEntry): URI | undefined {
        return resolveComposerUploadTargetDirExtracted(this, project);
    }

    resolveTranscriptContextUsageTarget(summary: QaapAgentConversationSummaryDTO,): {
        readonly summary?: QaapAgentConversationSummaryDTO;
        readonly chatModel?: ChatModel;
        readonly full?: QaapAgentConversationDTO;
    } {
        return resolveTranscriptContextUsageTargetExtracted(this, summary);
    }

    resolveTranscriptTheiaChatModel(summary: QaapAgentConversationSummaryDTO): ChatModel | undefined {
        return resolveTranscriptTheiaChatModelExtracted(this, summary);
    }

    enqueueTranscriptFollowUp(conversationId: string, entry: TranscriptFollowUpEntry,): boolean {
        return enqueueTranscriptFollowUpExtracted(this, conversationId, entry);
    }

    protected resolveComposerActivityFilesForStack(_project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO | undefined,): {
        readonly files: StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    } {
        return resolveComposerActivityFilesForStackExtracted(this, _project, summary, conv);
    }

    protected hasComposerFileActivity(conv: QaapAgentConversationDTO | undefined): boolean {
        return hasComposerFileActivityExtracted(this, conv);
    }

    /**
     * A premature empty git snapshot during streaming must not permanently latch the tree as
     * clean — that hides the Changes / Commit row even after the agent finishes editing.
     */
    protected clearStaleComposerGitLatches(summaryId: string): void {
        this.composerCleanTreeByConversationId.delete(summaryId);
        this.composerChangesResolvedByConversationId.delete(summaryId);
    }

    protected shouldRefetchComposerGitSnapshot(summaryId: string, conv: QaapAgentConversationDTO | undefined,): boolean {
        return shouldRefetchComposerGitSnapshotExtracted(this, summaryId, conv);
    }

    protected hasComposerCommittableChangesFromGit(summary: QaapAgentConversationSummaryDTO): boolean {
        return hasComposerCommittableChangesFromGitExtracted(this, summary);
    }

    protected hasComposerAgentActivity(activityFiles: { readonly files: readonly StickyComposerChangedFileView[]; readonly stats?: { readonly added: number; readonly removed: number }; }): boolean {
        return hasComposerAgentActivityExtracted(this, activityFiles);
    }

    protected resolveChangedFilesStats(files: readonly StickyComposerChangedFileView[], fallback?: { readonly added: number; readonly removed: number },): { readonly added: number; readonly removed: number } | undefined {
        return resolveChangedFilesStatsExtracted(this, files, fallback);
    }

    protected resolveComposerWorkspaceRoot(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): string | undefined {
        return resolveComposerWorkspaceRootExtracted(this, project, summary);
    }

    protected async fetchWorkspaceChangedFiles(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<StickyComposerChangedFileView[]> {
        return fetchWorkspaceChangedFilesExtracted(this, project, summary);
    }

    protected async runComposerGitFileAction(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, endpoint: 'stage' | 'discard', files: readonly StickyComposerChangedFileView[],): Promise<void> {
        return runComposerGitFileActionExtracted(this, project, summary, endpoint, files);
    }

    protected async syncComposerGitSnapshot(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<StickyComposerChangedFileView[]> {
        return syncComposerGitSnapshotExtracted(this, project, summary);
    }

    /** Cached git changes for a conversation (used by Files Changed rows when tool diffs are missing). */
    peekComposerGitChangedFiles(conversationId: string): readonly StickyComposerChangedFileView[] | undefined {
        return this.composerActivityGitFilesByConversationId.get(conversationId);
    }

    protected async undoAllComposerChangedFiles(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return undoAllComposerChangedFilesExtracted(this, project, summary);
    }

    protected async keepAllComposerChangedFiles(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return keepAllComposerChangedFilesExtracted(this, project, summary);
    }

    protected mapGitChangedFileToComposerView(file: QaapGitChangedFile): StickyComposerChangedFileView {
        return mapGitChangedFileToComposerViewHelper(file);
    }

    protected async refreshComposerActivityGitFilesIfNeeded(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO | undefined, activityFiles: { readonly files: readonly StickyComposerChangedFileView[]; readonly stats?: { readonly added: number; readonly removed: number }; },): Promise<void> {
        return refreshComposerActivityGitFilesIfNeededExtracted(this, project, summary, conv, activityFiles);
    }

    protected buildTranscriptComposerActivityOptions(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): StickyComposerActivityStackOptions {
        return buildTranscriptComposerActivityOptionsExtracted(this, project, summary);
    }

    protected async launchComposerDevPreview(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return launchComposerDevPreviewExtracted(this, project, summary);
    }

    protected async submitRunGeneratedAppFollowUp(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return submitRunGeneratedAppFollowUpExtracted(this, project, summary);
    }

    protected async runComposerCommitAction(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction,): Promise<void> {
        return runComposerCommitActionExtracted(this, project, summary, action);
    }

    protected buildGitActionMetadata(action: QaapGitCommitWorkflowAction, status: ComposerGitActionDisplayMetadata['status'], options: { readonly branch?: string; readonly stat?: { files: number; insertions: number; deletions: number }; } = {},): ComposerGitActionDisplayMetadata {
        return buildGitActionMetadataExtracted(this, action, status, options);
    }

    protected appendRunningGitActionToTranscript(summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction,): string | undefined {
        return appendRunningGitActionToTranscriptExtracted(this, summary, action);
    }

    protected markPendingGitActionFailed(summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction,): void {
        markPendingGitActionFailedExtracted(this, summary, action);
    }

    protected applyGitActionTranscriptConversation(summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO,): void {
        applyGitActionTranscriptConversationExtracted(this, summary, conv);
    }

    protected resolveGitCommitWorkflowLabel(action: QaapGitCommitWorkflowAction): string {
        return resolveGitCommitWorkflowLabelHelper(action);
    }

    protected async recordComposerGitActionInTranscript(summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction, options: { readonly branch?: string; readonly stat?: { files: number; insertions: number; deletions: number }; readonly status: 'completed' | 'failed'; readonly replaceMessageId?: string; },): Promise<void> {
        return recordComposerGitActionInTranscriptExtracted(this, summary, action, options);
    }

    buildTranscriptComposerActivityStack(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): HTMLElement | undefined {
        return buildTranscriptComposerActivityStackExtracted(this, project, summary);
    }

    buildTranscriptComposerChangesPill(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): HTMLElement | undefined {
        return buildTranscriptComposerChangesPillExtracted(this, project, summary);
    }

    protected buildComposerActivityFingerprint(summary: QaapAgentConversationSummaryDTO, activityOptions: StickyComposerActivityStackOptions, activityFiles: { readonly files: readonly StickyComposerChangedFileView[]; readonly stats?: { readonly added: number; readonly removed: number }; },): string {
        return buildComposerActivityFingerprintExtracted(this, summary, activityOptions, activityFiles);
    }

    syncComposerActivityFingerprint(summary: QaapAgentConversationSummaryDTO, project?: MobileProjectEntry, activityOptions?: StickyComposerActivityStackOptions,): void {
        syncComposerActivityFingerprintExtracted(this, summary, project, activityOptions);
    }

    refreshComposerActivityStack(): void {
        refreshComposerActivityStackExtracted(this);
    }

    /**
     * Keeps same-session queued follow-ups visible in the transcript footer (`pendingUserMessages`)
     * in lockstep with the composer queue — including optimistic local rows before the mirror POST.
     */
    protected syncTranscriptQueuedFollowUpBubbles(summary: QaapAgentConversationSummaryDTO): void {
        const chatHost = this.host.resolveActiveTranscriptChatHost() ?? this.host.transcriptChatHost;
        // Legacy DOM cleanup (old in-scroller queued bubbles).
        syncTranscriptQueuedBubbles(chatHost, this.host.transcriptFollowUpQueue.peek(summary.id));
        const cached = this.host.transcriptLastConv;
        if (!chatHost?.isConnected || !cached || cached.id !== summary.id) {
            return;
        }
        const pendingUserMessages = mergePendingUserMessagesWithLocalQueue(
            cached.pendingUserMessages,
            this.host.transcriptFollowUpQueue.peek(summary.id),
        );
        const next = { ...cached, pendingUserMessages };
        // Avoid a no-op full re-render when the merge did not change ids/content.
        const prevKey = (cached.pendingUserMessages ?? []).map(item => `${item.id}:${item.content}`).join('|');
        const nextKey = pendingUserMessages.map(item => `${item.id}:${item.content}`).join('|');
        if (prevKey === nextKey) {
            return;
        }
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, next);
    }

    refreshTranscriptComposerActivityIfNeeded(conv: QaapAgentConversationDTO): void {
        refreshTranscriptComposerActivityIfNeededExtracted(this, conv);
    }

    isTranscriptFollowUpReady(summary: QaapAgentConversationSummaryDTO): boolean {
        return isTranscriptFollowUpReadyExtracted(this, summary);
    }

    async flushTranscriptFollowUpQueue(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return flushTranscriptFollowUpQueueExtracted(this, project, summary);
    }

    async sendQueuedFollowUpNow(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, index: number,): Promise<void> {
        return sendQueuedFollowUpNowExtracted(this, project, summary, index);
    }

    async interruptQueuedFollowUp(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, index: number,): Promise<void> {
        return interruptQueuedFollowUpExtracted(this, project, summary, index);
    }

    protected async dispatchQueuedFollowUpInParallel(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry,): Promise<void> {
        return dispatchQueuedFollowUpInParallelExtracted(this, project, summary, entry);
    }

    protected async startIsolatedRunIfRequested(project: MobileProjectEntry, entry: TranscriptFollowUpEntry,): Promise<boolean> {
        return startIsolatedRunIfRequestedExtracted(this, project, entry);
    }

    protected async startPeerRunOrQueue(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry,): Promise<boolean> {
        return startPeerRunOrQueueExtracted(this, project, summary, entry);
    }

    protected queuePeerRunMessage(summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry,): boolean {
        return queuePeerRunMessageExtracted(this, summary, entry);
    }

    /** Resolves `false` when the mirror to durable server storage could not be confirmed. */
    protected async mirrorFollowUpToServerQueue(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        entry: TranscriptFollowUpEntry,
    ): Promise<boolean> {
        return mirrorFollowUpToServerQueueExtracted(this, project, summary, entry);
    }

    protected async submitQueuedFollowUpEntry(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry, options: { readonly parallel?: boolean } = {},): Promise<void> {
        return submitQueuedFollowUpEntryExtracted(this, project, summary, entry, options);
    }

    isTranscriptStickyComposerAgentWorking(): boolean {
        return isTranscriptStickyComposerAgentWorkingExtracted(this);
    }

    stopOpenComposerAgentLikeComposerStop(): boolean {
        return stopOpenComposerAgentLikeComposerStopExtracted(this);
    }

    isTranscriptStickyComposerAgentBeamIdle(): boolean {
        return false;
    }

    applyTranscriptComposerPrefsFromConversation(conv: QaapAgentConversationDTO, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        applyTranscriptComposerPrefsFromConversationExtracted(this, conv, project, summary);
    }

    protected applyTranscriptComposerPrefs(prefs: ReturnType<typeof extractConversationComposerPrefs>, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conversationId: string,): void {
        applyTranscriptComposerPrefsExtracted(this, prefs, project, summary, conversationId);
    }

    resetToProjectComposerDefaults(project: MobileProjectEntry, defaultAgentId: string = QAAP_COMPOSER_DEFAULT_AGENT_ID,): void {
        resetToProjectComposerDefaultsExtracted(this, project, defaultAgentId);
    }

    async hydrateTranscriptComposerPrefs(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<boolean> {
        return hydrateTranscriptComposerPrefsExtracted(this, project, summary);
    }

    schedulePersistTranscriptComposerDraft(conversationId: string | undefined): void {
        schedulePersistTranscriptComposerDraftExtracted(this, conversationId);
    }

    flushTranscriptComposerDraft(conversationId: string | undefined): void {
        flushTranscriptComposerDraftExtracted(this, conversationId);
    }

    schedulePersistTranscriptComposerPrefs(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        schedulePersistTranscriptComposerPrefsExtracted(this, project, summary);
    }

    async flushTranscriptComposerPrefs(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return flushTranscriptComposerPrefsExtracted(this, project, summary);
    }

    async persistTranscriptComposerPrefs(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return persistTranscriptComposerPrefsExtracted(this, project, summary);
    }

    protected async ensureTranscriptComposerPrefsForMount(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return ensureTranscriptComposerPrefsForMountExtracted(this, project, summary);
    }

    mountTranscriptStickyComposer(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement,): void {
        mountTranscriptStickyComposerExtracted(this, host, project, summary, chatHost);
    }

    protected async mountTranscriptStickyComposerAsync(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement,): Promise<void> {
        return mountTranscriptStickyComposerAsyncExtracted(this, host, project, summary, chatHost);
    }

    protected async submitTranscriptComposerDraft(draft: string, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement, options: { readonly resolvedPinnedId: string; readonly showApprovalPolicy: boolean; readonly isLegacyTheiaChat: boolean; readonly forceDeliveryMode?: 'queue' | 'parallel' | 'interrupt'; },): Promise<void> {
        return submitTranscriptComposerDraftExtracted(this, draft, project, summary, chatHost, options);
    }

    remountTranscriptStickyComposer(): void {
        remountTranscriptStickyComposerExtracted(this);
    }
}

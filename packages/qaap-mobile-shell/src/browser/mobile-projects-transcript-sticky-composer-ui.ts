// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { QuickInputService } from '@theia/core/lib/common/quick-pick-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatModel } from '@theia/ai-chat';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapMessageDeliveryMode,
} from '../common/qaap-agent-conversation-client';
import { type ComposerGitActionDisplayMetadata } from '../common/qaap-composer-git-action-display';
import {
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    type QaapAgentTaskAgentOption,
} from '../common/qaap-agent-task-client';
import { mergePendingUserMessagesWithLocalQueue } from '../common/qaap-pending-user-messages-merge';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import {
    extractConversationComposerPrefs,
} from '../common/qaap-conversation-composer-state';
import {
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    TranscriptFollowUpQueue,
    type TranscriptFollowUpEntry,
} from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-follow-up-queue';
import {
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { ComposerTranscriptSurfacesApi } from './qaap-composer-host-contracts';
import type { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import type { ChatSessionActivityApi } from './mobile-projects-conversation-index-ui';
import type { MobileProjectsTranscriptVerifyHost } from './mobile-projects-transcript-verify-ui';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { WorkHubTranscriptBridge } from '@theia/qaap-transcript-overlay/lib/browser/work-hub-transcript-bridge';
import {
    type QaapGitChangedFile,
    type QaapGitCommitWorkflowAction,
} from '../common/qaap-git-review';
import { type StickyComposerActivityStackOptions } from './qaap-sticky-composer-activity-stack';
import { syncTranscriptQueuedBubbles } from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-queued-bubbles';
import {
    mapGitChangedFileToComposerView as mapGitChangedFileToComposerViewHelper,
    resolveGitCommitWorkflowLabel as resolveGitCommitWorkflowLabelHelper,
    isComposerBackgroundWorkAllowed as isComposerBackgroundWorkAllowedHelper,
} from './mobile-projects-transcript-sticky-composer-helpers';
// Re-export public API functions from the helpers module.
export { mergeFailedComposerDraft, isIdleComposerFocusStealable } from './mobile-projects-transcript-sticky-composer-helpers';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import {
    type ComposerPreviewRuntime,
} from './qaap-composer-preview-action';
import { applyTranscriptComposerPrefsExtracted, applyTranscriptComposerPrefsFromConversationExtracted, ensureTranscriptComposerPrefsForMountExtracted, flushTranscriptComposerDraftExtracted, flushTranscriptComposerPrefsExtracted, hydrateTranscriptComposerPrefsExtracted, isTranscriptStickyComposerAgentWorkingExtracted, mirrorFollowUpToServerQueueExtracted, mountTranscriptStickyComposerExtracted, persistTranscriptComposerPrefsExtracted, queuePeerRunMessageExtracted, resetToProjectComposerDefaultsExtracted, schedulePersistTranscriptComposerDraftExtracted, schedulePersistTranscriptComposerPrefsExtracted, startPeerRunOrQueueExtracted, stopOpenComposerAgentLikeComposerStopExtracted, submitQueuedFollowUpEntryExtracted } from './mobile-projects-transcript-sticky-composer-ui-activity';
import { remountTranscriptStickyComposerExtracted, submitTranscriptComposerDraftExtracted } from './mobile-projects-transcript-sticky-composer-ui-live-status';
import { clearComposerPreviewHealthTimerExtracted, enqueueTranscriptFollowUpExtracted, fetchWorkspaceChangedFilesExtracted, hasComposerAgentActivityExtracted, hasComposerCommittableChangesFromGitExtracted, hasComposerFileActivityExtracted, onTranscriptComposerAttachExtracted, openComposerPreviewExtracted, resolveChangedFilesStatsExtracted, resolveComposerActivityFilesForStackExtracted, resolveComposerPreviewRuntimeExtracted, resolveComposerUploadTargetDirExtracted, resolveComposerWorkspaceRootExtracted, resolveTranscriptContextUsageTargetExtracted, resolveTranscriptTheiaChatModelExtracted, scheduleComposerPreviewHealthCheckExtracted, scheduleIdleComposerFocusRetentionExtracted, shouldRefetchComposerGitSnapshotExtracted, syncComposerPreviewAvailabilityExtracted, syncTranscriptComposerQuickActionsVisibilityExtracted } from './mobile-projects-transcript-sticky-composer-ui-render';
import { buildGitActionMetadataExtracted, buildTranscriptComposerActivityOptionsExtracted, keepAllComposerChangedFilesExtracted, launchComposerDevPreviewExtracted, refreshComposerActivityGitFilesIfNeededExtracted, runComposerCommitActionExtracted, runComposerGitFileActionExtracted, syncComposerGitSnapshotExtracted, undoAllComposerChangedFilesExtracted } from './mobile-projects-transcript-sticky-composer-ui-streaming';
import { appendRunningGitActionToTranscriptExtracted, applyGitActionTranscriptConversationExtracted, buildComposerActivityFingerprintExtracted, dispatchQueuedFollowUpInParallelExtracted, flushTranscriptFollowUpQueueExtracted, interruptQueuedFollowUpExtracted, isTranscriptFollowUpReadyExtracted, markPendingGitActionFailedExtracted, recordComposerGitActionInTranscriptExtracted, refreshComposerActivityStackExtracted, refreshTranscriptComposerActivityIfNeededExtracted, sendQueuedFollowUpNowExtracted, startIsolatedRunIfRequestedExtracted, syncComposerActivityFingerprintExtracted } from './mobile-projects-transcript-sticky-composer-ui-timeline';
import { mountTranscriptStickyComposerAsyncExtracted } from './mobile-projects-transcript-sticky-composer-ui-tool-pills';
import type { StickyComposerChangedFileView } from './qaap-transcript-host-contracts';

export const COMPOSER_PREVIEW_HEALTH_INTERVAL_MS = 5_000;

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
    chatServiceSummariesUi: ChatSessionActivityApi;
    transcriptMessagesUi: import('./mobile-projects-transcript-messages-ui').MobileProjectsTranscriptMessagesUi;
    handleComposerContextItemRemoved(entry: StickyComposerContextEntry): void;
    executionSurfaceTabsUi: import('./qaap-transcript-host-contracts').TranscriptExecutionSurfaceTabsApi;
    transcriptLiveUi: import('./mobile-projects-transcript-live-ui').MobileProjectsTranscriptLiveUi;
    beginTranscriptDevPreviewRequest(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void;
    requestTranscriptPreview?(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        options?: {
            readonly revealPreviewTab?: boolean;
            readonly deferPreviewTabUntilReady?: boolean;
            readonly allowAgentFallback?: boolean;
        },
    ): Promise<void>;
    transcriptLastFingerprint: string | undefined;
    transcriptSurfacesUi: ComposerTranscriptSurfacesApi;
    projects: MobileProjectEntry[];
    preparedCwdByProjectId: Map<string, string>;
    transcriptPreviewRequestRunning: boolean;
    transcriptPreviewRequestPending: boolean;
    transcriptPreviewSuppressedByUser: boolean;
    diffReviewWidget: QaapDiffReviewWidget | undefined;
    verifyChecksLoading: boolean;
    verifyRunning: boolean;
    verifyResults: MobileProjectsTranscriptVerifyHost['verifyResults'];
}

/** Transcript overlay sticky composer: mount, prefs, follow-up queue, and submit wiring. */
export class MobileProjectsTranscriptStickyComposerUi {
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public lastComposerActivityFingerprint = '';
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public lastComposerChangesPillFingerprint = '';
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public lastComposerActivityStackFingerprint = '';
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public readonly composerActivityGitFilesByConversationId = new Map<string, StickyComposerChangedFileView[]>();
    /** Conversations whose changes were resolved while the git snapshot was absent or clean. */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public readonly composerChangesResolvedByConversationId = new Set<string>();
    /** Conversations whose working tree is clean (nothing to commit) — the Commit button stays
     *  hidden across a momentary snapshot gap until fresh changes appear. */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public readonly composerCleanTreeByConversationId = new Set<string>();
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public composerChangedFilesBulkBusy = false;
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public composerCommitBusy = false;
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public verifiedComposerPreview: { readonly projectId: string; readonly url: string } | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public composerPreviewProbeInFlight: Promise<void> | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public composerPreviewLastCheckedAt = 0;
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public composerPreviewHealthTimer: number | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public pendingGitActionMessageId: string | undefined;

    /** Tracks whether the Agents Hub idle (pre-conversation) composer is currently mounted, to drive autofocus-on-ready. */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public agentsHubIdleComposerMounted = false;

    /** Disposer for the idle-composer focus-retention watchers (see mount). */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public idleComposerFocusRetentionDispose: (() => void) | undefined;

    /** Autofocus is only attempted during the boot window after construction. */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public readonly idleComposerAutofocusDeadline = Date.now() + 20_000;

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public clearIdleComposerFocusRetention(): void {
        this.idleComposerFocusRetentionDispose?.();
        this.idleComposerFocusRetentionDispose = undefined;
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public scheduleIdleComposerFocusRetention(textarea: HTMLTextAreaElement): void {
        scheduleIdleComposerFocusRetentionExtracted(this, textarea);
    }

    constructor(
        /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
        public readonly host: MobileProjectsTranscriptStickyComposerHost,
        /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
        public readonly workHub: WorkHubTranscriptBridge,
    ) { }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public isComposerBackgroundWorkAllowed(): boolean {
        return isComposerBackgroundWorkAllowedHelper();
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveComposerPreviewRuntime(project: MobileProjectEntry): ComposerPreviewRuntime {
        return resolveComposerPreviewRuntimeExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public clearComposerPreviewHealthTimer(): void {
        clearComposerPreviewHealthTimerExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public scheduleComposerPreviewHealthCheck(projectId: string): void {
        scheduleComposerPreviewHealthCheckExtracted(this, projectId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public syncComposerPreviewAvailability(project: MobileProjectEntry, candidate: string | undefined): void {
        syncComposerPreviewAvailabilityExtracted(this, project, candidate);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async openComposerPreview(projectId: string): Promise<void> {
        return openComposerPreviewExtracted(this, projectId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public peekTranscriptComposerChangedFilesExpanded(summaryId: string): boolean {
        return this.host.transcriptComposerChangedFilesExpandedById.get(summaryId) ?? true;
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public setTranscriptComposerChangedFilesExpanded(summaryId: string, expanded: boolean): void {
        this.host.transcriptComposerChangedFilesExpandedById.set(summaryId, expanded);
    }

    /** Prefer the live inline/overlay host — mount-time chatHost can go stale after renderList(). */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveComposerTranscriptChatHost(fallback?: HTMLElement): HTMLElement | undefined {
        const active = this.host.resolveActiveTranscriptChatHost();
        if (active?.isConnected) {
            return active;
        }
        return fallback?.isConnected ? fallback : undefined;
    }

    syncTranscriptComposerQuickActionsVisibility(host: HTMLElement, summary: QaapAgentConversationSummaryDTO,): void {
        syncTranscriptComposerQuickActionsVisibilityExtracted(this, host, summary);
    }

    async onTranscriptComposerAttach(project: MobileProjectEntry, anchor: HTMLElement,): Promise<void> {
        return onTranscriptComposerAttachExtracted(this, project, anchor);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveComposerUploadTargetDir(project: MobileProjectEntry): URI | undefined {
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

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveComposerActivityFilesForStack(_project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO | undefined,): {
        readonly files: StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    } {
        return resolveComposerActivityFilesForStackExtracted(this, _project, summary, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public hasComposerFileActivity(conv: QaapAgentConversationDTO | undefined): boolean {
        return hasComposerFileActivityExtracted(this, conv);
    }

    /**
     * A premature empty git snapshot during streaming must not permanently latch the tree as
     * clean — that hides the Changes / Commit row even after the agent finishes editing.
     */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public clearStaleComposerGitLatches(summaryId: string): void {
        this.composerCleanTreeByConversationId.delete(summaryId);
        this.composerChangesResolvedByConversationId.delete(summaryId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public shouldRefetchComposerGitSnapshot(summaryId: string, conv: QaapAgentConversationDTO | undefined,): boolean {
        return shouldRefetchComposerGitSnapshotExtracted(this, summaryId, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public hasComposerCommittableChangesFromGit(summary: QaapAgentConversationSummaryDTO): boolean {
        return hasComposerCommittableChangesFromGitExtracted(this, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public hasComposerAgentActivity(activityFiles: { readonly files: readonly StickyComposerChangedFileView[]; readonly stats?: { readonly added: number; readonly removed: number }; }): boolean {
        return hasComposerAgentActivityExtracted(this, activityFiles);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveChangedFilesStats(files: readonly StickyComposerChangedFileView[], fallback?: { readonly added: number; readonly removed: number },): { readonly added: number; readonly removed: number } | undefined {
        return resolveChangedFilesStatsExtracted(this, files, fallback);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveComposerWorkspaceRoot(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): string | undefined {
        return resolveComposerWorkspaceRootExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async fetchWorkspaceChangedFiles(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<StickyComposerChangedFileView[]> {
        return fetchWorkspaceChangedFilesExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async runComposerGitFileAction(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, endpoint: 'stage' | 'discard', files: readonly StickyComposerChangedFileView[],): Promise<void> {
        return runComposerGitFileActionExtracted(this, project, summary, endpoint, files);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async syncComposerGitSnapshot(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<StickyComposerChangedFileView[]> {
        return syncComposerGitSnapshotExtracted(this, project, summary);
    }

    /** Cached git changes for a conversation (used by Files Changed rows when tool diffs are missing). */
    peekComposerGitChangedFiles(conversationId: string): readonly StickyComposerChangedFileView[] | undefined {
        return this.composerActivityGitFilesByConversationId.get(conversationId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async undoAllComposerChangedFiles(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return undoAllComposerChangedFilesExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async keepAllComposerChangedFiles(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return keepAllComposerChangedFilesExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public mapGitChangedFileToComposerView(file: QaapGitChangedFile): StickyComposerChangedFileView {
        return mapGitChangedFileToComposerViewHelper(file);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async refreshComposerActivityGitFilesIfNeeded(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO | undefined, activityFiles: { readonly files: readonly StickyComposerChangedFileView[]; readonly stats?: { readonly added: number; readonly removed: number }; },): Promise<void> {
        return refreshComposerActivityGitFilesIfNeededExtracted(this, project, summary, conv, activityFiles);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public buildTranscriptComposerActivityOptions(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): StickyComposerActivityStackOptions {
        return buildTranscriptComposerActivityOptionsExtracted(this, project, summary);
    }

    async launchComposerDevPreview(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return launchComposerDevPreviewExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async runComposerCommitAction(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction,): Promise<void> {
        return runComposerCommitActionExtracted(this, project, summary, action);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public buildGitActionMetadata(action: QaapGitCommitWorkflowAction, status: ComposerGitActionDisplayMetadata['status'], options: { readonly branch?: string; readonly stat?: { files: number; insertions: number; deletions: number }; } = {},): ComposerGitActionDisplayMetadata {
        return buildGitActionMetadataExtracted(this, action, status, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public appendRunningGitActionToTranscript(summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction,): string | undefined {
        return appendRunningGitActionToTranscriptExtracted(this, summary, action);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public markPendingGitActionFailed(summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction,): void {
        markPendingGitActionFailedExtracted(this, summary, action);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public applyGitActionTranscriptConversation(summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO,): void {
        applyGitActionTranscriptConversationExtracted(this, summary, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public resolveGitCommitWorkflowLabel(action: QaapGitCommitWorkflowAction): string {
        return resolveGitCommitWorkflowLabelHelper(action);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async recordComposerGitActionInTranscript(summary: QaapAgentConversationSummaryDTO, action: QaapGitCommitWorkflowAction, options: { readonly branch?: string; readonly stat?: { files: number; insertions: number; deletions: number }; readonly status: 'completed' | 'failed'; readonly replaceMessageId?: string; },): Promise<void> {
        return recordComposerGitActionInTranscriptExtracted(this, summary, action, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public buildComposerActivityFingerprint(summary: QaapAgentConversationSummaryDTO, activityOptions: StickyComposerActivityStackOptions, activityFiles: { readonly files: readonly StickyComposerChangedFileView[]; readonly stats?: { readonly added: number; readonly removed: number }; },): string {
        return buildComposerActivityFingerprintExtracted(this, summary, activityOptions, activityFiles);
    }

    syncComposerActivityFingerprint(summary: QaapAgentConversationSummaryDTO, project?: MobileProjectEntry, activityOptions?: StickyComposerActivityStackOptions,): void {
        syncComposerActivityFingerprintExtracted(this, summary, project, activityOptions);
    }

    refreshComposerActivityStack(): void {
        refreshComposerActivityStackExtracted(this);
    }

    /** Refresh only the empty-composer quick actions when preview startup changes state. */
    refreshComposerQuickActions(): void {
        const composerHost = this.host.transcriptComposerHost;
        const quickActions = composerHost?.querySelector<HTMLElement>(
            '.theia-mobile-projects-sticky-composer > .theia-mobile-agent-transcript-empty-actions',
        );
        if (!quickActions) {
            return;
        }
        quickActions.replaceWith(this.workHub.createAgentsHubQuickActionsBlock());
    }

    /**
     * Keeps same-session queued follow-ups visible in the transcript footer (`pendingUserMessages`)
     * in lockstep with the composer queue — including optimistic local rows before the mirror POST.
     */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public syncTranscriptQueuedFollowUpBubbles(summary: QaapAgentConversationSummaryDTO): void {
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

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async dispatchQueuedFollowUpInParallel(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry,): Promise<void> {
        return dispatchQueuedFollowUpInParallelExtracted(this, project, summary, entry);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async startIsolatedRunIfRequested(project: MobileProjectEntry, entry: TranscriptFollowUpEntry,): Promise<boolean> {
        return startIsolatedRunIfRequestedExtracted(this, project, entry);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async startPeerRunOrQueue(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry,): Promise<boolean> {
        return startPeerRunOrQueueExtracted(this, project, summary, entry);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public queuePeerRunMessage(summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry,): boolean {
        return queuePeerRunMessageExtracted(this, summary, entry);
    }

    /** Resolves `false` when the mirror to durable server storage could not be confirmed. */
    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async mirrorFollowUpToServerQueue(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        entry: TranscriptFollowUpEntry,
    ): Promise<boolean> {
        return mirrorFollowUpToServerQueueExtracted(this, project, summary, entry);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async submitQueuedFollowUpEntry(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, entry: TranscriptFollowUpEntry, options: { readonly parallel?: boolean; readonly deliveryMode?: QaapMessageDeliveryMode } = {},): Promise<void> {
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

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public applyTranscriptComposerPrefs(prefs: ReturnType<typeof extractConversationComposerPrefs>, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conversationId: string,): void {
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

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async ensureTranscriptComposerPrefsForMount(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return ensureTranscriptComposerPrefsForMountExtracted(this, project, summary);
    }

    mountTranscriptStickyComposer(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement,): void {
        mountTranscriptStickyComposerExtracted(this, host, project, summary, chatHost);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async mountTranscriptStickyComposerAsync(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement,): Promise<void> {
        return mountTranscriptStickyComposerAsyncExtracted(this, host, project, summary, chatHost);
    }

    /** @internal Used by the extracted mobile-projects-transcript-sticky-composer-ui-* modules. */
    public async submitTranscriptComposerDraft(draft: string, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, chatHost: HTMLElement, options: { readonly resolvedPinnedId: string; readonly showApprovalPolicy: boolean; readonly isLegacyTheiaChat: boolean; readonly forceDeliveryMode?: 'queue' | 'parallel' | 'interrupt'; },): Promise<void> {
        return submitTranscriptComposerDraftExtracted(this, draft, project, summary, chatHost, options);
    }

    remountTranscriptStickyComposer(): void {
        remountTranscriptStickyComposerExtracted(this);
    }
}

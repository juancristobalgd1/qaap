// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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

const COMPOSER_PREVIEW_HEALTH_INTERVAL_MS = 5_000;

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

    /**
     * Keeps the freshly-mounted idle composer focused through the Theia shell
     * boot sequence, which steals focus back to `<body>` at unpredictable
     * times. Watches the textarea's `focusout` for 10s after mount and
     * re-asserts focus ONLY when the steal was programmatic: focus landed on
     * body/none AND the user did not interact (pointer/key) in the previous
     * 500ms — so a deliberate tap outside (e.g. dismissing the mobile
     * keyboard) is always respected.
     */
    protected scheduleIdleComposerFocusRetention(textarea: HTMLTextAreaElement): void {
        this.clearIdleComposerFocusRetention();
        let lastUserInteraction = 0;
        const markInteraction = (): void => { lastUserInteraction = Date.now(); };
        const onFocusOut = (): void => {
            // Let the new focus target settle before inspecting it.
            setTimeout(() => {
                if (!textarea.isConnected || textarea.disabled) {
                    this.clearIdleComposerFocusRetention();
                    return;
                }
                const active = document.activeElement;
                const userDriven = Date.now() - lastUserInteraction < 500;
                if (isIdleComposerFocusStealable(active, textarea) && !userDriven) {
                    textarea.focus();
                }
            }, 0);
        };
        window.addEventListener('pointerdown', markInteraction, true);
        window.addEventListener('keydown', markInteraction, true);
        textarea.addEventListener('focusout', onFocusOut);
        const expiry = setTimeout(() => this.clearIdleComposerFocusRetention(), 10_000);
        this.idleComposerFocusRetentionDispose = () => {
            clearTimeout(expiry);
            window.removeEventListener('pointerdown', markInteraction, true);
            window.removeEventListener('keydown', markInteraction, true);
            textarea.removeEventListener('focusout', onFocusOut);
        };
    }

    constructor(
        protected readonly host: MobileProjectsTranscriptStickyComposerHost,
        protected readonly workHub: WorkHubTranscriptBridge,
    ) { }

    protected isComposerBackgroundWorkAllowed(): boolean {
        return isComposerBackgroundWorkAllowedHelper();
    }

    protected resolveComposerPreviewRuntime(project: MobileProjectEntry): ComposerPreviewRuntime {
        const bootstrap = this.host.projectBootstrap;
        const descriptor = bootstrap?.descriptor;
        return {
            projectId: project.id,
            projectCwd: this.host.projectsService.getProjectCwd(project),
            bootstrapRoot: descriptor ? FileUri.fsPath(descriptor.rootUri) : undefined,
            dependenciesInstalled: descriptor?.nodeModulesPresent === true,
            phase: bootstrap?.phase ?? 'idle',
            previewUrl: bootstrap?.previewUrl,
        };
    }

    protected clearComposerPreviewHealthTimer(): void {
        if (this.composerPreviewHealthTimer !== undefined) {
            window.clearTimeout(this.composerPreviewHealthTimer);
            this.composerPreviewHealthTimer = undefined;
        }
    }

    protected scheduleComposerPreviewHealthCheck(projectId: string): void {
        this.clearComposerPreviewHealthTimer();
        this.composerPreviewHealthTimer = window.setTimeout(() => {
            this.composerPreviewHealthTimer = undefined;
            if (this.host.transcriptComposerProject?.id !== projectId
                || !this.host.transcriptComposerHost?.isConnected) {
                return;
            }
            this.composerPreviewLastCheckedAt = 0;
            this.refreshComposerActivityStack();
        }, COMPOSER_PREVIEW_HEALTH_INTERVAL_MS);
    }

    protected syncComposerPreviewAvailability(project: MobileProjectEntry, candidate: string | undefined): void {
        if (!candidate) {
            this.clearComposerPreviewHealthTimer();
            if (this.verifiedComposerPreview?.projectId === project.id) {
                this.verifiedComposerPreview = undefined;
            }
            return;
        }
        const runtime = this.resolveComposerPreviewRuntime(project);
        const verified = this.verifiedComposerPreview?.projectId === project.id
            ? resolveVerifiedComposerPreviewUrl(runtime, this.verifiedComposerPreview.url)
            : undefined;
        if (verified && Date.now() - this.composerPreviewLastCheckedAt < COMPOSER_PREVIEW_HEALTH_INTERVAL_MS) {
            this.scheduleComposerPreviewHealthCheck(project.id);
            return;
        }
        if (this.composerPreviewProbeInFlight) {
            return;
        }
        // Identity preview URLs (`/qaap-preview/<id>/`) carry no port — verify them through the
        // identity probe instead of silently bailing, or the "Open preview" pill can never appear
        // for identity-proxied apps (the "started the app but nothing to click" failure).
        const port = extractDevPreviewPortFromUrl(candidate);
        const identityId = port === undefined
            ? extractTranscriptPreviewId(candidate, window.location.origin)
            : undefined;
        if (port === undefined && !identityId) {
            return;
        }
        const probePromise = port !== undefined
            ? probeQaapDevPreviewPort(port)
            : probeQaapIdentityPreview(identityId!);
        this.composerPreviewProbeInFlight = probePromise.then(async probe => {
            this.composerPreviewLastCheckedAt = Date.now();
            const currentProject = this.host.transcriptComposerProject;
            const stillCurrent = currentProject?.id === project.id
                && resolveComposerPreviewCandidate(this.resolveComposerPreviewRuntime(currentProject));
            if (!probe.ready && stillCurrent) {
                // The candidate claim may have been superseded by a newer run (retry, second
                // tab, backend restart) — its identity probe then 403s although the project has
                // a live preview. Adopting the successor refreshes `bootstrap.previewUrl`, so
                // the re-sync below verifies the live claim instead of dropping the pill.
                const adopted = await this.host.projectBootstrap?.reconcileSupersededPreviewClaim()
                    .catch(() => false);
                if (adopted && this.host.transcriptComposerProject?.id === project.id) {
                    this.composerPreviewLastCheckedAt = 0;
                    window.setTimeout(() => {
                        if (this.host.transcriptComposerProject?.id === project.id) {
                            this.refreshComposerActivityStack();
                        }
                    }, 0);
                }
            }
            const next = probe.ready && stillCurrent
                ? { projectId: project.id, url: probe.previewUrl }
                : undefined;
            const changed = this.verifiedComposerPreview?.projectId !== next?.projectId
                || this.verifiedComposerPreview?.url !== next?.url;
            this.verifiedComposerPreview = next;
            if (stillCurrent) {
                this.scheduleComposerPreviewHealthCheck(project.id);
            } else {
                this.clearComposerPreviewHealthTimer();
            }
            if (changed) {
                this.refreshComposerActivityStack();
            }
        }).finally(() => {
            this.composerPreviewProbeInFlight = undefined;
        });
    }

    protected async openComposerPreview(projectId: string): Promise<void> {
        const opened = await openCurrentComposerPreview(
            projectId,
            () => {
                const current = this.host.transcriptComposerProject;
                return current ? this.resolveComposerPreviewRuntime(current) : undefined;
            },
            target => target.previewId !== undefined
                ? probeQaapIdentityPreview(target.previewId)
                : probeQaapDevPreviewPort(target.port!),
            url => this.host.transcriptOpenProject?.id === projectId
                ? this.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(url)
                : Promise.resolve(false),
        );
        if (!opened) {
            // A URL the backend just verified as ready must not dead-end in a silent no-op (the
            // transcript surface can lack an open summary right after a reload). Route through the
            // bootstrap opener: its qaap-bootstrap-preview-opened event surfaces the hub Preview
            // tab, and the IDE surface gets the mini-browser widget as before. Keep the pill.
            //
            // ONLY when the active bootstrap actually belongs to this project: the bootstrap is
            // scoped to the active workspace, so falling back while another project's transcript
            // is open would surface (and record) the WRONG app's preview — observed live as an
            // empty repo getting another project's previewUrl persisted onto its hub session.
            const bootstrap = this.host.projectBootstrap;
            const project = this.host.transcriptComposerProject;
            const ownsBootstrap = !!project
                && project.id === projectId
                && !!resolveComposerPreviewCandidate(this.resolveComposerPreviewRuntime(project));
            if (bootstrap && ownsBootstrap) {
                await bootstrap.focusPreview();
                return;
            }
            this.verifiedComposerPreview = undefined;
            this.composerPreviewLastCheckedAt = 0;
            this.refreshComposerActivityStack();
        }
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

    syncTranscriptComposerQuickActionsVisibility(
        host: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const current = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv
            : this.host.transcriptLiveUi.peekCachedOpenTranscript(summary.id);
        const conv = current ?? {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
        };
        host.classList.toggle(
            'theia-mod-show-quick-actions',
            shouldShowTranscriptEmptyQuickActions(conv, current),
        );
    }

    async onTranscriptComposerAttach(
        project: MobileProjectEntry,
        anchor: HTMLElement,
    ): Promise<void> {
        if (!this.host.pickContextVariable) {
            return;
        }
        const uploadTargetDir = this.resolveComposerUploadTargetDir(project);
        const variables = await this.host.pickContextVariable(
            anchor,
            this.host.stickyComposerContextUi.createTranscriptComposerAttachHandlers(uploadTargetDir),
        );
        if (variables.length === 0) {
            return;
        }
        for (const request of variables) {
            this.host.transcriptComposerContext.push(createComposerContextEntry(request));
        }
        this.remountTranscriptStickyComposer();
    }

    /**
     * Directory that device-file uploads land in. The mobile chat runs against the project cwd
     * without opening it as a Theia workspace, so we bind uploads to the project directory instead
     * of relying on `WorkspaceService.tryGetRoots()` (empty here).
     */
    protected resolveComposerUploadTargetDir(project: MobileProjectEntry): URI | undefined {
        if (project.uri) {
            return project.uri;
        }
        const cwd = this.host.projectsService.getProjectCwd(project);
        return cwd ? new URI().withScheme('file').withPath(cwd) : undefined;
    }

    resolveTranscriptContextUsageTarget(
        summary: QaapAgentConversationSummaryDTO,
    ): {
        readonly summary?: QaapAgentConversationSummaryDTO;
        readonly chatModel?: ChatModel;
        readonly full?: QaapAgentConversationDTO;
    } {
        if (summary.source === 'theia-chat') {
            const chatModel = this.resolveTranscriptTheiaChatModel(summary);
            return chatModel ? { chatModel } : {};
        }
        const live = this.host.conversations?.findSummaryById(summary.id) ?? summary;
        if (this.host.transcriptLastConv?.id === summary.id) {
            const effectiveStatus = resolveTranscriptEffectiveStatus(this.host.transcriptLastConv);
            return {
                summary: { ...live, status: effectiveStatus },
                full: this.host.transcriptLastConv,
            };
        }
        return { summary: live };
    }

    resolveTranscriptTheiaChatModel(summary: QaapAgentConversationSummaryDTO): ChatModel | undefined {
        if (summary.source !== 'theia-chat' || !summary.sessionId || !this.host.chatService) {
            return undefined;
        }
        return this.host.chatService.getSession(summary.sessionId)?.model;
    }

    enqueueTranscriptFollowUp(
        conversationId: string,
        entry: TranscriptFollowUpEntry,
    ): boolean {
        const ok = this.host.transcriptFollowUpQueue.enqueue(conversationId, entry);
        if (!ok) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/transcriptFollowUpQueueFull',
                    'Queue is full ({0} messages). Wait for the agent to finish.',
                    String(MAX_TRANSCRIPT_FOLLOW_UP_QUEUE),
                ),
                { kind: 'warning', duration: 2800 },
            );
            return false;
        }
        const count = this.host.transcriptFollowUpQueue.size(conversationId);
        MobileSnackbar.show(
            nls.localize(
                'qaap/mobileProjects/transcriptFollowUpQueued',
                '{0} message(s) queued — will send when the agent finishes',
                String(count),
            ),
            { kind: 'success', duration: 1600 },
        );
        return true;
    }

    protected resolveComposerActivityFilesForStack(
        _project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO | undefined,
    ): {
        readonly files: StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    } {
        const activityFiles = this.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, summary);
        if (!this.hasComposerFileActivity(conv)) {
            return { files: [] };
        }
        const gitFiles = this.composerActivityGitFilesByConversationId.get(summary.id);
        const selection = selectComposerPillChanges(
            gitFiles,
            this.composerChangesResolvedByConversationId.has(summary.id),
            this.composerCleanTreeByConversationId.has(summary.id),
        );
        // Persist clean/resolved only when the git snapshot confirms there is nothing left. The
        // transcript permanently records agent edits, so a later snapshot invalidation would
        // otherwise fall through to transcript-derived stats and resurrect stale controls.
        if (selection.resolved) {
            this.composerChangesResolvedByConversationId.add(summary.id);
        } else {
            this.composerChangesResolvedByConversationId.delete(summary.id);
        }
        if (selection.clean) {
            this.composerCleanTreeByConversationId.add(summary.id);
        } else {
            this.composerCleanTreeByConversationId.delete(summary.id);
        }
        if (selection.hidden) {
            return { files: [] };
        }
        if (selection.files) {
            return {
                files: selection.files,
                stats: this.resolveChangedFilesStats(selection.files, activityFiles.stats),
            };
        }
        return activityFiles;
    }

    /**
     * True when the agent has edited files in this conversation — evidence from the transcript
     * itself (file-edit tool calls or agent-reported diff stats), NOT `summary.linesAdded`, since
     * the backend stamps repo-wide `git diff` stats on every turn and a tree left dirty by another
     * session would otherwise surface the buttons in conversations that never touched a file.
     * Stays true after Accept/Discard, so the Commit and preview controls persist.
     */
    protected hasComposerFileActivity(conv: QaapAgentConversationDTO | undefined): boolean {
        const transcriptEvidence = this.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, undefined, { allTurns: true });
        return this.hasComposerAgentActivity(transcriptEvidence)
            || this.host.transcriptMessagesUi.hasComposerFileChangeToolCalls(conv);
    }

    /**
     * A premature empty git snapshot during streaming must not permanently latch the tree as
     * clean — that hides the Changes / Commit row even after the agent finishes editing.
     */
    protected clearStaleComposerGitLatches(summaryId: string): void {
        this.composerCleanTreeByConversationId.delete(summaryId);
        this.composerChangesResolvedByConversationId.delete(summaryId);
    }

    protected shouldRefetchComposerGitSnapshot(
        summaryId: string,
        conv: QaapAgentConversationDTO | undefined,
    ): boolean {
        if (!this.composerActivityGitFilesByConversationId.has(summaryId)) {
            return true;
        }
        const cached = this.composerActivityGitFilesByConversationId.get(summaryId);
        if (!cached || cached.length > 0) {
            return false;
        }
        // Empty snapshot: if the resolved or clean latch is set the tree was intentionally
        // cleared by an explicit user action (Accept staged all / Discard cleaned the tree).
        // Do NOT delete + re-fetch here — that creates a gap where the snapshot is undefined
        // while clearStaleComposerGitLatches is still wiping the latches, which lets
        // transcript-derived evidence resurface the Changes pill until the fetch resolves.
        if (this.composerChangesResolvedByConversationId.has(summaryId)
            || this.composerCleanTreeByConversationId.has(summaryId)) {
            return false;
        }
        return this.hasComposerFileActivity(conv);
    }

    /**
     * True when the working tree has something to commit — the git snapshot has ≥1 changed file
     * (staged or unstaged). Falls back to the clean-tree latch while the snapshot is momentarily
     * absent so the Commit button doesn't flicker back after a Discard. Must be read AFTER
     * {@link resolveComposerActivityFilesForStack} updates the latch for this render.
     *
     * NOTE: the caller MUST gate this on {@link hasComposerFileActivity} — without a snapshot AND
     * without a clean latch (a fresh/idle conversation) this returns `true`, so on its own it would
     * surface Commit in a conversation the agent never touched.
     */
    protected hasComposerCommittableChangesFromGit(summary: QaapAgentConversationSummaryDTO): boolean {
        const gitFiles = this.composerActivityGitFilesByConversationId.get(summary.id);
        if (gitFiles) {
            return gitFiles.length > 0;
        }
        return !this.composerCleanTreeByConversationId.has(summary.id);
    }

    protected hasComposerAgentActivity(activityFiles: {
        readonly files: readonly StickyComposerChangedFileView[];
        readonly stats?: { readonly added: number; readonly removed: number };
    }): boolean {
        return hasComposerAgentActivityHelper(activityFiles);
    }

    protected resolveChangedFilesStats(
        files: readonly StickyComposerChangedFileView[],
        fallback?: { readonly added: number; readonly removed: number },
    ): { readonly added: number; readonly removed: number } | undefined {
        return resolveChangedFilesStatsHelper(files, fallback);
    }

    protected resolveComposerWorkspaceRoot(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string | undefined {
        return this.host.projectsService.getProjectCwd(project) ?? summary.cwd;
    }

    protected async fetchWorkspaceChangedFiles(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<StickyComposerChangedFileView[]> {
        const cwd = this.resolveComposerWorkspaceRoot(project, summary);
        if (!cwd) {
            return [];
        }
        const response = await fetch(
            `${QAAP_GIT_REVIEW_API_PATH}/changes?root=${encodeURIComponent(cwd)}`,
            { credentials: 'include' },
        );
        if (!response.ok) {
            throw new Error(`git changes request failed (${response.status})`);
        }
        const body = await response.json() as { files?: QaapGitChangedFile[] };
        return (body.files ?? []).map(file => this.mapGitChangedFileToComposerView(file));
    }

    protected async runComposerGitFileAction(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        endpoint: 'stage' | 'discard',
        files: readonly StickyComposerChangedFileView[],
    ): Promise<void> {
        const cwd = this.resolveComposerWorkspaceRoot(project, summary);
        if (!cwd || files.length === 0) {
            return;
        }
        for (const file of files) {
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ root: cwd, file: file.path }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(body.error ?? `${endpoint} failed (${response.status})`);
            }
        }
    }

    protected async syncComposerGitSnapshot(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<StickyComposerChangedFileView[]> {
        const files = await this.fetchWorkspaceChangedFiles(project, summary);
        this.composerActivityGitFilesByConversationId.set(summary.id, files);
        return files;
    }

    /** Cached git changes for a conversation (used by Files Changed rows when tool diffs are missing). */
    peekComposerGitChangedFiles(conversationId: string): readonly StickyComposerChangedFileView[] | undefined {
        return this.composerActivityGitFilesByConversationId.get(conversationId);
    }

    protected async undoAllComposerChangedFiles(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (this.composerChangedFilesBulkBusy) {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/stickyComposerDiscardAllTitle', 'Discard changes'),
            msg: nls.localize(
                'qaap/mobileProjects/stickyComposerDiscardAllMsg',
                'Discard all pending changes? This cannot be undone.',
            ),
            ok: nls.localize('qaap/mobileProjects/stickyComposerDiscardAllConfirm', 'Discard'),
            cancel: nls.localize('qaap/mobileProjects/parallelCancel', 'Back'),
        }).open();
        if (!confirmed) {
            return;
        }
        this.composerChangedFilesBulkBusy = true;
        this.refreshComposerActivityStack();
        try {
            const files = await this.fetchWorkspaceChangedFiles(project, summary);
            if (files.length === 0) {
                return;
            }
            await this.runComposerGitFileAction(project, summary, 'discard', files);
            await this.syncComposerGitSnapshot(project, summary);
            this.refreshComposerActivityStack();
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/stickyComposerUndoAllDone', 'All changes discarded'),
                { kind: 'success', duration: 1800 },
            );
        } catch {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/stickyComposerUndoAllFailed', 'Could not discard all changes'),
                { kind: 'warning', duration: 2800 },
            );
        } finally {
            this.composerChangedFilesBulkBusy = false;
            this.refreshComposerActivityStack();
        }
    }

    protected async keepAllComposerChangedFiles(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (this.composerChangedFilesBulkBusy) {
            return;
        }
        this.composerChangedFilesBulkBusy = true;
        this.refreshComposerActivityStack();
        try {
            const files = await this.fetchWorkspaceChangedFiles(project, summary);
            if (files.length === 0) {
                return;
            }
            await this.runComposerGitFileAction(project, summary, 'stage', files);
            await this.syncComposerGitSnapshot(project, summary);
            this.refreshComposerActivityStack();
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/stickyComposerKeepAllDone', 'All changes kept'),
                { kind: 'success', duration: 1800 },
            );
        } catch {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/stickyComposerKeepAllFailed', 'Could not keep all changes'),
                { kind: 'warning', duration: 2800 },
            );
        } finally {
            this.composerChangedFilesBulkBusy = false;
            this.refreshComposerActivityStack();
        }
    }

    protected mapGitChangedFileToComposerView(file: QaapGitChangedFile): StickyComposerChangedFileView {
        return mapGitChangedFileToComposerViewHelper(file);
    }

    protected async refreshComposerActivityGitFilesIfNeeded(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO | undefined,
        activityFiles: {
            readonly files: readonly StickyComposerChangedFileView[];
            readonly stats?: { readonly added: number; readonly removed: number };
        },
    ): Promise<void> {
        if (!this.isComposerBackgroundWorkAllowed()) {
            return;
        }
        if (!this.shouldRefetchComposerGitSnapshot(summary.id, conv)) {
            return;
        }
        if (this.composerActivityGitFilesByConversationId.has(summary.id)) {
            this.composerActivityGitFilesByConversationId.delete(summary.id);
        }
        // Skip the repo-wide git snapshot until the agent has actually edited files here.
        // Tool-call evidence alone must count: some agent CLIs (e.g. opencode/QAIQ) report
        // Edit/Write tool calls without parseable paths or diff stats, leaving activityFiles
        // empty even though the agent did change files — same gate as the pill itself.
        if (!this.hasComposerAgentActivity(activityFiles)
            && !this.host.transcriptMessagesUi.hasComposerFileChangeToolCalls(conv)) {
            return;
        }
        const cwd = this.host.projectsService.getProjectCwd(project) ?? summary.cwd;
        if (!cwd) {
            return;
        }
        try {
            const response = await fetch(
                `${QAAP_GIT_REVIEW_API_PATH}/changes?root=${encodeURIComponent(cwd)}`,
                { credentials: 'include' },
            );
            if (!response.ok) {
                return;
            }
            const body = await response.json() as { files?: QaapGitChangedFile[] };
            const files = (body.files ?? []).map(file => this.mapGitChangedFileToComposerView(file));
            // While the agent is still running, an empty snapshot usually means the edit hasn't
            // landed on disk yet — don't latch a false "clean tree" for the Changes row.
            if (files.length === 0 && conv?.status === 'streaming') {
                return;
            }
            this.composerActivityGitFilesByConversationId.set(summary.id, files);
            if (this.host.transcriptComposerSummary?.id !== summary.id) {
                return;
            }
            if (buildStickyComposerChangesPillFingerprint(this.buildTranscriptComposerActivityOptions(project, summary))
                === this.lastComposerChangesPillFingerprint) {
                return;
            }
            this.refreshComposerActivityStack();
        } catch {
            // Git review is optional — composer still shows aggregate diff stats.
        }
    }

    protected buildTranscriptComposerActivityOptions(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): StickyComposerActivityStackOptions {
        const conv = this.host.transcriptLastConv?.id === summary.id ? this.host.transcriptLastConv : undefined;
        const activityFiles = this.resolveComposerActivityFilesForStack(project, summary, conv);
        void this.refreshComposerActivityGitFilesIfNeeded(project, summary, conv, activityFiles);
        const agentWorking = this.isTranscriptStickyComposerAgentWorking();
        // Everything below is gated on the agent having actually edited files in THIS conversation.
        // A fresh/idle conversation has no activity and no git snapshot, so the whole row stays gone.
        const hasFileActivity = this.hasComposerFileActivity(conv);
        const hasCommittableChanges = hasFileActivity && this.hasComposerCommittableChangesFromGit(summary);
        const previewRuntime = this.resolveComposerPreviewRuntime(project);
        const previewCandidate = resolveComposerPreviewCandidate(previewRuntime);
        this.syncComposerPreviewAvailability(project, previewCandidate);
        const verifiedPreviewUrl = this.verifiedComposerPreview?.projectId === project.id
            ? resolveVerifiedComposerPreviewUrl(previewRuntime, this.verifiedComposerPreview.url)
            : undefined;
        return {
            queueEntries: this.host.transcriptFollowUpQueue.peek(summary.id),
            queueExpanded: this.host.transcriptComposerQueueExpanded,
            onQueueExpandedChange: expanded => { this.host.transcriptComposerQueueExpanded = expanded; },
            onQueueEdit: (index, entry) => {
                this.host.transcriptComposerDraft = entry.draft;
                const existingRequests = new Set(this.host.transcriptComposerContext.map(item => item.request));
                const restored = (entry.variables ?? [])
                    .filter(request => !existingRequests.has(request))
                    .map(request => createComposerContextEntry(request));
                this.host.transcriptComposerContext = [...restored, ...this.host.transcriptComposerContext];
                this.host.transcriptFollowUpQueue.removeAt(summary.id, index);
                this.remountTranscriptStickyComposer();
            },
            onQueueSendNow: index => {
                void this.sendQueuedFollowUpNow(project, summary, index);
            },
            onQueueRemove: index => {
                this.host.transcriptFollowUpQueue.removeAt(summary.id, index);
                this.refreshComposerActivityStack();
            },
            changedFiles: activityFiles.files,
            diffStats: activityFiles.stats,
            hasFileActivity,
            hasCommittableChanges,
            filesExpanded: this.peekTranscriptComposerChangedFilesExpanded(summary.id),
            onFilesExpandedChange: expanded => { this.setTranscriptComposerChangedFilesExpanded(summary.id, expanded); },
            agentWorking,
            onReview: () => {
                this.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, summary);
            },
            onRunApp: () => {
                void this.launchComposerDevPreview(project, summary);
            },
            onOpenPreview: verifiedPreviewUrl
                ? () => { void this.openComposerPreview(project.id); }
                : undefined,
            onKeepAll: () => { void this.keepAllComposerChangedFiles(project, summary); },
            onUndoAll: () => { void this.undoAllComposerChangedFiles(project, summary); },
            changedFilesBulkBusy: this.composerChangedFilesBulkBusy,
            onCommitAction: (this.host.commitMessageAi || this.host.quickInputService)
                ? action => { void this.runComposerCommitAction(project, summary, action); }
                : undefined,
            commitBusy: this.composerCommitBusy || this.composerChangedFilesBulkBusy,
        };
    }

    /**
     * Directly launches the dev server via the project bootstrap service and switches to the
     * Preview tab so the user sees the preview loading in the integrated browser — without
     * delegating to the agent. Once the preview URL is verified, the Run app button is replaced
     * by View Preview (existing onOpenPreview wiring).
     */
    protected async launchComposerDevPreview(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const bootstrap = this.host.projectBootstrap;
        if (!bootstrap) {
            return;
        }
        // Clear any stale preview state for this section and switch to the Preview tab so the
        // user sees the loading surface immediately while the dev server starts.
        this.host.beginTranscriptDevPreviewRequest(project, summary);
        this.host.executionSurfaceTabsUi.selectTranscriptTab('preview', project, summary);
        await bootstrap.runDevServer({ conversationId: summary.id });
    }

    protected async submitRunGeneratedAppFollowUp(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const chatHost = this.host.resolveActiveTranscriptChatHost() ?? this.host.transcriptChatHost;
        if (!chatHost) {
            this.host.transcriptComposerDraft = nls.localize(
                'qaap/mobileProjects/runGeneratedAppPrompt',
                'Run the generated app now. Install dependencies if needed, start the dev server, fix any startup errors, and open or report the preview URL.',
            );
            this.remountTranscriptStickyComposer();
            return;
        }
        const pinnedId = this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary);
        await this.submitTranscriptComposerDraft(
            nls.localize(
                'qaap/mobileProjects/runGeneratedAppPrompt',
                'Run the generated app now. Install dependencies if needed, start the dev server, fix any startup errors, and open or report the preview URL.',
            ),
            project,
            summary,
            chatHost,
            {
                resolvedPinnedId: pinnedId,
                showApprovalPolicy: agentSupportsApprovalPolicy(pinnedId),
                isLegacyTheiaChat: summary.source === 'theia-chat',
            },
        );
    }

    /** Same git workflows as the diff-review toolbar, surfaced beside the composer Changes pill. */
    protected async runComposerCommitAction(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        action: QaapGitCommitWorkflowAction,
    ): Promise<void> {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? summary.cwd;
        if (!cwd || this.composerCommitBusy) {
            return;
        }
        this.composerCommitBusy = true;
        this.refreshComposerActivityStack();
        try {
            // The AI writes the commit message automatically from the diff (Cursor-agents style).
            const generated = await this.host.commitMessageAi?.generate(cwd);
            let message = generated?.message;
            if (!message) {
                message = (await this.host.quickInputService?.input({
                    title: nls.localize('qaap/mobileProjects/commitMessageTitle', 'Commit message'),
                    placeHolder: nls.localize('qaap/mobileProjects/commitMessagePlaceholder', 'Describe your changes'),
                    prompt: nls.localize('qaap/mobileProjects/commitMessagePrompt', 'Message for this commit'),
                }))?.trim();
            }
            if (!message) {
                return;
            }
            const needsBranch = action === 'create-branch-commit' || action === 'create-branch-commit-push';
            let branchName: string | undefined;
            if (needsBranch) {
                branchName = this.host.quickInputService
                    ? (await this.host.quickInputService.input({
                        title: nls.localize('qaap/mobileProjects/newBranchTitle', 'Create branch'),
                        value: generated?.branchName,
                        placeHolder: nls.localize('qaap/mobileProjects/newBranchPlaceholder', 'feature/my-change'),
                        prompt: nls.localize('qaap/mobileProjects/newBranchPrompt', 'Name for the new branch'),
                    }))?.trim()
                    : generated?.branchName;
                if (!branchName) {
                    return;
                }
            }
            const pendingGitActionId = this.appendRunningGitActionToTranscript(summary, action);
            const response = await fetch(`${QAAP_GIT_REVIEW_API_PATH}/commit-workflow`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ root: cwd, action, branchName, message }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(body.error ?? `commit workflow failed (${response.status})`);
            }
            const result = await response.json().catch(() => ({})) as {
                branch?: string;
                stat?: { files: number; insertions: number; deletions: number };
            };
            if (action === 'commit-create-pr' && this.host.commands) {
                try {
                    await this.host.commands.executeCommand('pr.pushAndCreate', { repoPath: cwd });
                } catch {
                    await this.host.commands.executeCommand('pr.create', { repoPath: cwd });
                }
            }
            // `git add -A && git commit` leaves the tree clean — hide the Changes pill and the
            // commit buttons right away, then re-verify against the real working tree.
            this.composerActivityGitFilesByConversationId.set(summary.id, []);
            void this.syncComposerGitSnapshot(project, summary)
                .then(() => this.refreshComposerActivityStack())
                .catch(() => undefined);
            MobileSnackbar.show(
                formatCommitFeedback(
                    nls.localize('qaap/mobileProjects/stickyComposerCommitDone', 'Changes committed'),
                    result.branch,
                    result.stat,
                ),
                { kind: 'success', duration: 2400 },
            );
            void this.recordComposerGitActionInTranscript(summary, action, {
                branch: result.branch,
                stat: result.stat,
                status: 'completed',
                replaceMessageId: pendingGitActionId,
            });
        } catch (error) {
            this.markPendingGitActionFailed(summary, action);
            void this.recordComposerGitActionInTranscript(summary, action, {
                status: 'failed',
                replaceMessageId: this.pendingGitActionMessageId,
            });
            MobileSnackbar.show(
                error instanceof Error && error.message
                    ? error.message
                    : nls.localize('qaap/mobileProjects/stickyComposerCommitFailed', 'Commit failed'),
                { kind: 'warning', duration: 3200 },
            );
        } finally {
            this.pendingGitActionMessageId = undefined;
            this.composerCommitBusy = false;
            this.refreshComposerActivityStack();
        }
    }

    protected buildGitActionMetadata(
        action: QaapGitCommitWorkflowAction,
        status: ComposerGitActionDisplayMetadata['status'],
        options: {
            readonly branch?: string;
            readonly stat?: { files: number; insertions: number; deletions: number };
        } = {},
    ): ComposerGitActionDisplayMetadata {
        return {
            action,
            label: this.resolveGitCommitWorkflowLabel(action),
            status,
            ...(options.branch ? { branch: options.branch } : {}),
            ...(options.stat ? {
                files: options.stat.files,
                insertions: options.stat.insertions,
                deletions: options.stat.deletions,
            } : {}),
        };
    }

    protected appendRunningGitActionToTranscript(
        summary: QaapAgentConversationSummaryDTO,
        action: QaapGitCommitWorkflowAction,
    ): string | undefined {
        const messageId = `pending-git-action-${Date.now()}`;
        const metadata = this.buildGitActionMetadata(action, 'running');
        const message: QaapAgentMessageDTO = {
            id: messageId,
            role: 'user',
            content: createComposerGitActionDisplayMarker(metadata),
            createdAt: Date.now(),
        };
        this.pendingGitActionMessageId = messageId;
        const base = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv
            : undefined;
        if (!base) {
            return messageId;
        }
        const next: QaapAgentConversationDTO = {
            ...base,
            updatedAt: Date.now(),
            messages: [...base.messages, message],
        };
        this.applyGitActionTranscriptConversation(summary, next);
        return messageId;
    }

    protected markPendingGitActionFailed(
        summary: QaapAgentConversationSummaryDTO,
        action: QaapGitCommitWorkflowAction,
    ): void {
        const pendingId = this.pendingGitActionMessageId;
        const base = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv
            : undefined;
        if (!pendingId || !base) {
            return;
        }
        const metadata = this.buildGitActionMetadata(action, 'failed');
        const next: QaapAgentConversationDTO = {
            ...base,
            updatedAt: Date.now(),
            messages: base.messages.map(message => message.id === pendingId
                ? { ...message, content: createComposerGitActionDisplayMarker(metadata) }
                : message),
        };
        this.applyGitActionTranscriptConversation(summary, next);
    }

    protected applyGitActionTranscriptConversation(
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,
    ): void {
        if (this.host.transcriptOpenSummary?.id !== summary.id) {
            return;
        }
        this.host.transcriptLastConv = conv;
        this.host.conversations?.cacheDocument(conv);
        const updatedSummary = conversationToSummary(conv);
        this.host.transcriptOpenSummary = updatedSummary;
        if (this.host.transcriptComposerSummary?.id === summary.id) {
            this.host.transcriptComposerSummary = updatedSummary;
        }
        this.host.conversations?.recordSnapshot(updatedSummary);
        const chatHost = this.host.resolveActiveTranscriptChatHost() ?? this.host.transcriptChatHost;
        if (chatHost) {
            this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
        }
    }

    protected resolveGitCommitWorkflowLabel(action: QaapGitCommitWorkflowAction): string {
        return resolveGitCommitWorkflowLabelHelper(action);
    }

    protected async recordComposerGitActionInTranscript(
        summary: QaapAgentConversationSummaryDTO,
        action: QaapGitCommitWorkflowAction,
        options: {
            readonly branch?: string;
            readonly stat?: { files: number; insertions: number; deletions: number };
            readonly status: 'completed' | 'failed';
            readonly replaceMessageId?: string;
        },
    ): Promise<void> {
        try {
            const updated = await recordConversationGitAction(summary.id, this.buildGitActionMetadata(action, options.status, {
                branch: options.branch,
                stat: options.stat,
            }), {
                replaceMessageId: options.replaceMessageId,
            });
            if (!updated || this.host.transcriptOpenSummary?.id !== summary.id) {
                if (options.status === 'completed' && this.host.transcriptLastConv?.id === summary.id && options.replaceMessageId) {
                    const metadata = this.buildGitActionMetadata(action, 'completed', {
                        branch: options.branch,
                        stat: options.stat,
                    });
                    const next: QaapAgentConversationDTO = {
                        ...this.host.transcriptLastConv,
                        updatedAt: Date.now(),
                        messages: this.host.transcriptLastConv.messages.map(message => message.id === options.replaceMessageId
                            ? { ...message, content: createComposerGitActionDisplayMarker(metadata) }
                            : message),
                    };
                    this.applyGitActionTranscriptConversation(summary, next);
                }
                return;
            }
            this.applyGitActionTranscriptConversation(summary, updated);
        } catch {
            if (options.status === 'completed' && this.host.transcriptLastConv?.id === summary.id && options.replaceMessageId) {
                const metadata = this.buildGitActionMetadata(action, 'completed', {
                    branch: options.branch,
                    stat: options.stat,
                });
                const next: QaapAgentConversationDTO = {
                    ...this.host.transcriptLastConv,
                    updatedAt: Date.now(),
                    messages: this.host.transcriptLastConv.messages.map(message => message.id === options.replaceMessageId
                        ? { ...message, content: createComposerGitActionDisplayMarker(metadata) }
                        : message),
                };
                this.applyGitActionTranscriptConversation(summary, next);
            }
        }
    }

    buildTranscriptComposerActivityStack(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): HTMLElement | undefined {
        return renderStickyComposerActivityStack(this.buildTranscriptComposerActivityOptions(project, summary));
    }

    buildTranscriptComposerChangesPill(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): HTMLElement | undefined {
        return renderStickyComposerChangesPill(this.buildTranscriptComposerActivityOptions(project, summary));
    }

    protected buildComposerActivityFingerprint(
        summary: QaapAgentConversationSummaryDTO,
        activityOptions: StickyComposerActivityStackOptions,
        activityFiles: {
            readonly files: readonly StickyComposerChangedFileView[];
            readonly stats?: { readonly added: number; readonly removed: number };
        },
    ): string {
        const pathsKey = activityFiles.files.map(file => file.path).sort().join('\n');
        return [
            this.host.transcriptFollowUpQueue.size(summary.id),
            pathsKey,
            activityFiles.stats?.added ?? 0,
            activityFiles.stats?.removed ?? 0,
            activityOptions.agentWorking ? 1 : 0,
        ].join('|');
    }

    syncComposerActivityFingerprint(
        summary: QaapAgentConversationSummaryDTO,
        project?: MobileProjectEntry,
        activityOptions?: StickyComposerActivityStackOptions,
    ): void {
        const conv = this.host.transcriptLastConv?.id === summary.id ? this.host.transcriptLastConv : undefined;
        const resolvedProject = project ?? this.host.transcriptComposerProject;
        const activityFiles = resolvedProject
            ? this.resolveComposerActivityFilesForStack(resolvedProject, summary, conv)
            : this.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, summary);
        const options = activityOptions
            ?? this.buildTranscriptComposerActivityOptions(resolvedProject ?? this.host.transcriptComposerProject!, summary);
        this.lastComposerActivityFingerprint = this.buildComposerActivityFingerprint(summary, options, activityFiles);
        this.lastComposerChangesPillFingerprint = buildStickyComposerChangesPillFingerprint(options);
        this.lastComposerActivityStackFingerprint = buildStickyComposerActivityStackFingerprint(options);
    }

    refreshComposerActivityStack(): void {
        const host = this.host.transcriptComposerHost;
        const project = this.host.transcriptComposerProject;
        const summary = this.host.transcriptComposerSummary;
        if (!host?.isConnected || !project || !summary) {
            return;
        }
        const wrap = host.querySelector('.theia-mobile-projects-sticky-composer-inner');
        const card = wrap?.querySelector('.theia-mobile-projects-sticky-composer-card.theia-mod-codex');
        if (!wrap || !card) {
            this.remountTranscriptStickyComposer();
            return;
        }
        const activityOptions = this.buildTranscriptComposerActivityOptions(project, summary);
        const pillFingerprint = buildStickyComposerChangesPillFingerprint(activityOptions);
        const changesPill = renderStickyComposerChangesPill(activityOptions);
        // Activity row vs Working/Step-only strip share the same host class — never tear down
        // `theia-mod-working-only` during streaming ticks or Step/Working flicker every SSE.
        const pillHosts = Array.from(
            wrap.querySelectorAll(':scope > .theia-mobile-sticky-composer-changes-pill-host'),
        );
        const existingActivityPill = pillHosts.find(
            host => !host.classList.contains('theia-mod-working-only'),
        );
        const pillsOnlyHost = pillHosts.find(
            host => host.classList.contains('theia-mod-working-only'),
        );
        if (!changesPill) {
            if (existingActivityPill instanceof HTMLElement) {
                parkWorkingControlFromAncestor(existingActivityPill);
                existingActivityPill.remove();
            }
            this.lastComposerChangesPillFingerprint = '';
        } else if (existingActivityPill instanceof HTMLElement) {
            if (pillFingerprint === this.lastComposerChangesPillFingerprint
                || patchStickyComposerChangesPillHost(existingActivityPill, activityOptions)) {
                this.lastComposerChangesPillFingerprint = pillFingerprint;
            } else {
                if (changesPill instanceof HTMLElement) {
                    transferWorkingControlToHost(existingActivityPill, changesPill);
                    transferStepPillToHost(existingActivityPill, changesPill);
                } else {
                    parkWorkingControlFromAncestor(existingActivityPill);
                }
                existingActivityPill.replaceWith(changesPill);
                this.lastComposerChangesPillFingerprint = pillFingerprint;
            }
        } else if (pillsOnlyHost instanceof HTMLElement && changesPill instanceof HTMLElement) {
            transferWorkingControlToHost(pillsOnlyHost, changesPill);
            transferStepPillToHost(pillsOnlyHost, changesPill);
            wrap.insertBefore(changesPill, card);
            pillsOnlyHost.remove();
            this.lastComposerChangesPillFingerprint = pillFingerprint;
        } else {
            wrap.insertBefore(changesPill, card);
            this.lastComposerChangesPillFingerprint = pillFingerprint;
        }
        const stackFingerprint = buildStickyComposerActivityStackFingerprint(activityOptions);
        const stack = renderStickyComposerActivityStack(activityOptions);
        // Queue lives outside the card (sibling above it), not as theia-mod-has-activity lip.
        const existing = wrap.querySelector(':scope > .theia-mobile-sticky-composer-activity-stack');
        card.classList.remove('theia-mod-has-activity');
        card.querySelector(':scope > .theia-mobile-sticky-composer-activity-stack')?.remove();
        card.querySelector(':scope > .theia-mobile-sticky-composer-activity-section.theia-mod-streaming')?.remove();
        if (!stack) {
            existing?.remove();
            this.lastComposerActivityStackFingerprint = '';
        } else if (existing instanceof HTMLElement) {
            if (stackFingerprint === this.lastComposerActivityStackFingerprint
                || patchStickyComposerActivityStack(existing, activityOptions)) {
                this.lastComposerActivityStackFingerprint = stackFingerprint;
            } else {
                existing.replaceWith(stack);
                this.lastComposerActivityStackFingerprint = stackFingerprint;
            }
        } else {
            wrap.insertBefore(stack, card);
            this.lastComposerActivityStackFingerprint = stackFingerprint;
        }
        this.syncComposerActivityFingerprint(summary, project, activityOptions);
        this.syncTranscriptQueuedFollowUpBubbles(summary);
        this.host.updateWorkingPillChrome();
        this.host.composerHeaderUi.updateStickyComposerFabLift();
    }

    /**
     * Paints queued follow-ups as user bubbles at the transcript tail. Riding on the composer
     * refresh (which already runs on enqueue/edit/remove and on every SSE tick) keeps the
     * bubbles in step with the queue and re-mounts them after a full transcript rebuild.
     */
    protected syncTranscriptQueuedFollowUpBubbles(summary: QaapAgentConversationSummaryDTO): void {
        const chatHost = this.host.resolveActiveTranscriptChatHost() ?? this.host.transcriptChatHost;
        syncTranscriptQueuedBubbles(chatHost, this.host.transcriptFollowUpQueue.peek(summary.id));
    }

    refreshTranscriptComposerActivityIfNeeded(conv: QaapAgentConversationDTO): void {
        if (!this.isComposerBackgroundWorkAllowed()) {
            return;
        }
        const summary = this.host.transcriptComposerSummary;
        const project = this.host.transcriptComposerProject;
        if (!summary || summary.id !== conv.id || !project || !this.host.transcriptComposerHost?.isConnected) {
            return;
        }
        const turnSettled = conv.status !== 'streaming';
        if (turnSettled && this.hasComposerFileActivity(conv)) {
            if (this.shouldRefetchComposerGitSnapshot(conv.id, conv)) {
                void this.syncComposerGitSnapshot(project, summary)
                    .then(() => this.refreshComposerActivityStack())
                    .catch(() => undefined);
            }
        }
        const activityOptions = this.buildTranscriptComposerActivityOptions(project, summary);
        const activityFiles = project
            ? this.resolveComposerActivityFilesForStack(project, summary, conv)
            : this.host.transcriptMessagesUi.resolveComposerActivityFiles(conv, summary);
        const fingerprint = this.buildComposerActivityFingerprint(summary, activityOptions, activityFiles);
        const pillFingerprint = buildStickyComposerChangesPillFingerprint(activityOptions);
        if (fingerprint === this.lastComposerActivityFingerprint
            && pillFingerprint === this.lastComposerChangesPillFingerprint) {
            this.host.transcriptComposerSendRefresh?.();
            return;
        }
        const previousFingerprint = this.lastComposerActivityFingerprint;
        this.lastComposerActivityFingerprint = fingerprint;
        this.lastComposerChangesPillFingerprint = pillFingerprint;
        const previousPaths = previousFingerprint.split('|')[1] ?? '';
        const nextPaths = fingerprint.split('|')[1] ?? '';
        if (nextPaths !== previousPaths) {
            // New file paths only — invalidate git snapshot so counts stay accurate.
            this.composerActivityGitFilesByConversationId.delete(conv.id);
            this.clearStaleComposerGitLatches(conv.id);
        }
        this.refreshComposerActivityStack();
        this.host.transcriptComposerSendRefresh?.();
    }

    isTranscriptFollowUpReady(summary: QaapAgentConversationSummaryDTO): boolean {
        if (this.host.transcriptFollowUpFlushInFlight) {
            return false;
        }
        if (this.host.transcriptLastConv?.id === summary.id) {
            return !isTranscriptAgentExecutionBusy(summary, this.host.transcriptLastConv);
        }
        return !isTranscriptAgentExecutionBusy(summary, undefined);
    }

    async flushTranscriptFollowUpQueue(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (!this.isTranscriptFollowUpReady(summary)) {
            return;
        }
        const next = this.host.transcriptFollowUpQueue.shift(summary.id);
        if (!next) {
            return;
        }
        await this.submitQueuedFollowUpEntry(project, summary, next);
    }

    /**
     * Sends a specific queued follow-up immediately. While the agent is still working the
     * message starts its OWN agent run next to the open turn (parallel agents, like Cursor /
     * Claude Code / Codex) — the running turn is never cancelled. When the agent is idle the
     * entry goes into the open conversation as a normal follow-up.
     */
    async sendQueuedFollowUpNow(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        index: number,
    ): Promise<void> {
        const entry = this.host.transcriptFollowUpQueue.takeAt(summary.id, index);
        if (!entry) {
            return;
        }
        if (this.isTranscriptStickyComposerAgentWorking()) {
            await this.dispatchQueuedFollowUpInParallel(project, summary, entry);
            return;
        }
        await this.submitQueuedFollowUpEntry(project, summary, entry);
    }

    /**
     * Starts a queued message as a second agent run inside THIS conversation (in-session
     * multitasking) instead of interrupting the turn in flight: both agents stream into the same
     * transcript, each into its own message. The user bubble paints immediately through the
     * normal submit path, so the send is visible the moment it is dispatched.
     */
    protected async dispatchQueuedFollowUpInParallel(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        entry: TranscriptFollowUpEntry,
    ): Promise<void> {
        // The row already left the queue — repaint before the round-trip so the tap feels instant.
        this.refreshComposerActivityStack();
        if (await this.startIsolatedRunIfRequested(project, entry)) {
            return;
        }
        await this.submitQueuedFollowUpEntry(project, summary, entry, { parallel: true });
    }

    /**
     * Honours the composer's "Run in" destination for a concurrent send. Peer runs share this
     * conversation's working tree, so two agents can collide on the same files; picking "New
     * Worktree" asks for isolation instead — and isolation means a different working tree, which
     * a conversation cannot have (it is bound to one cwd). So an isolated run becomes its own
     * session in a fresh worktree. Returns true when it handled the send.
     */
    protected async startIsolatedRunIfRequested(
        project: MobileProjectEntry,
        entry: TranscriptFollowUpEntry,
    ): Promise<boolean> {
        if (this.host.stickyComposerWorkspaceUi.resolveComposerWorkspaceDestination(project) !== 'worktree') {
            return false;
        }
        await this.host.submitBackgroundAgentTask(project, entry.draft, {
            openConversation: true,
            forceVps: true,
            worktree: true,
            selectedAgentId: entry.selectedAgentId,
            modeId: entry.modeId,
            autoApprove: entry.autoApprove,
            approvalPolicyId: entry.approvalPolicyId,
            agentModel: this.host.transcriptComposerAgentModel,
            variables: entry.variables,
            imagePreviews: entry.imagePreviews,
        });
        return true;
    }

    /**
     * Default path for a message sent while an agent works: start a peer run in this conversation.
     * The only reason to fall back to the queue is the backend's concurrency cap — anything else
     * is a real send failure and stays visible as one.
     */
    protected async startPeerRunOrQueue(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        entry: TranscriptFollowUpEntry,
    ): Promise<boolean> {
        if (await this.startIsolatedRunIfRequested(project, entry)) {
            return true;
        }
        try {
            const submitted = await this.host.submitTranscriptViaBackendConversation(project, summary, entry.draft, {
                selectedAgentId: entry.selectedAgentId,
                modeId: entry.modeId,
                autoApprove: entry.autoApprove,
                approvalPolicyId: entry.approvalPolicyId,
                agentModel: this.host.transcriptComposerAgentModel,
                variables: entry.variables,
                imagePreviews: entry.imagePreviews,
                parallel: true,
            });
            if (!submitted) {
                // Another POST for this conversation was still open (rapid-fire sends): the
                // message never left, and the composer draft is already cleared — queue it.
                return this.queuePeerRunMessage(summary, entry);
            }
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/peerRunStarted',
                    'Message sent — the agent will process it alongside the running task',
                ),
                { duration: 2600 },
            );
            return true;
        } catch (error) {
            if (!isMaxConcurrentRunsError(error)) {
                const detail = error instanceof Error ? error.message : String(error);
                this.host.messageService?.error(nls.localize(
                    'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail,
                ));
                return false;
            }
            // Session is already at the agent limit — hold the message in the queue, where it
            // flushes (or can be dispatched by hand) as soon as one of the runs finishes.
            return this.queuePeerRunMessage(summary, entry);
        }
    }

    /** Parks a concurrent send in the queue and says so, instead of losing it. */
    protected queuePeerRunMessage(
        summary: QaapAgentConversationSummaryDTO,
        entry: TranscriptFollowUpEntry,
    ): boolean {
        if (!this.enqueueTranscriptFollowUp(summary.id, entry)) {
            // Queue is full too — the only case where the message cannot be kept anywhere.
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/peerRunQueueFull',
                'Could not send: this session already has the maximum number of agents and queued messages.',
            ));
            return false;
        }
        this.refreshComposerActivityStack();
        MobileSnackbar.show(
            nls.localize(
                'qaap/mobileProjects/peerRunLimitQueued',
                'Queued — this session is already running the maximum number of agents',
            ),
            { duration: 2600 },
        );
        return true;
    }

    protected async submitQueuedFollowUpEntry(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        entry: TranscriptFollowUpEntry,
        options: { readonly parallel?: boolean } = {},
    ): Promise<void> {
        this.host.transcriptFollowUpFlushInFlight = true;
        try {
            await this.host.submitTranscriptViaBackendConversation(project, summary, entry.draft, {
                selectedAgentId: entry.selectedAgentId,
                modeId: entry.modeId,
                autoApprove: entry.autoApprove,
                approvalPolicyId: entry.approvalPolicyId,
                agentModel: this.host.transcriptComposerAgentModel,
                variables: entry.variables,
                imagePreviews: entry.imagePreviews,
                ...(options.parallel ? { parallel: true } : {}),
            });
        } catch (error) {
            this.host.transcriptFollowUpQueue.unshift(summary.id, entry);
            const detail = error instanceof Error ? error.message : String(error);
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail,
            ));
        } finally {
            this.host.transcriptFollowUpFlushInFlight = false;
            this.remountTranscriptStickyComposer();
        }
    }

    isTranscriptStickyComposerAgentWorking(): boolean {
        const summary = this.host.transcriptComposerSummary;
        if (!summary || !this.host.transcriptComposerHost?.isConnected) {
            return false;
        }
        const conv = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv
            : undefined;
        if (isTranscriptSummaryAgentWorking(summary, conv)) {
            return true;
        }
        if (summary.source === 'theia-chat' && this.host.chatService) {
            const sessionId = summary.sessionId ?? this.host.transcriptTheiaSessionByConversationId.get(summary.id);
            const session = sessionId ? this.host.chatService.getSession(sessionId) : undefined;
            if (session && this.host.chatServiceSummariesUi.isChatSessionWorking(session)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Same cancel path as the sticky-composer Stop button (`onStop` → {@link onCancelConversation}).
     * Used by Working "Stop All" so the open inline session is aborted, not only UI chrome.
     */
    stopOpenComposerAgentLikeComposerStop(): boolean {
        let project = this.host.transcriptComposerProject
            ?? this.host.transcriptOpenProject;
        let summary = this.host.transcriptComposerSummary
            ?? this.host.transcriptOpenSummary;
        if (!project || !summary) {
            return false;
        }
        if (isAgentsHubIdleConversationSummary(summary)) {
            project = this.workHub.resolveShellProject() ?? project;
            summary = this.workHub.resolveShellSummary(project) ?? summary;
            if (isAgentsHubIdleConversationSummary(summary)) {
                return false;
            }
        }
        // Mirror composer Stop: cancel even when status briefly lags behind the Stop affordance.
        if (!this.isTranscriptStickyComposerAgentWorking() && summary.status !== 'streaming') {
            return false;
        }
        this.host.onCancelConversation(project, summary);
        this.host.transcriptComposerSendRefresh?.();
        return true;
    }

    isTranscriptStickyComposerAgentBeamIdle(): boolean {
        return false;
    }

    applyTranscriptComposerPrefsFromConversation(
        conv: QaapAgentConversationDTO,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
            return;
        }
        this.applyTranscriptComposerPrefs(extractConversationComposerPrefs(conv), project, summary, conv.id);
    }

    protected applyTranscriptComposerPrefs(
        prefs: ReturnType<typeof extractConversationComposerPrefs>,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conversationId: string,
    ): void {
        const cwd = this.host.projectsService.getProjectCwd(project) ?? summary.cwd;
        applyConversationComposerPrefs(prefs, cwd, conversationId);
        this.host.transcriptComposerPrefsConvId = conversationId;
        this.host.transcriptComposerPinnedAgentId = prefs.agentId;
        this.host.transcriptComposerAgentModel = prefs.agentModel;
        const modes = resolveStickyComposerModes(prefs.agentId, this.host.chatAgentService);
        this.host.transcriptComposerModeId = reconcileComposerModeId(
            prefs.interactionModeId,
            modes,
            cwd,
        );
        this.host.transcriptComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
            prefs.approvalPolicyId,
            cwd,
        );
        this.host.transcriptComposerToolApprovalRules = prefs.toolApprovalRules;
        this.host.transcriptComposerDraft = readConversationComposerDraft(conversationId);
    }

    resetToProjectComposerDefaults(
        project: MobileProjectEntry,
        defaultAgentId: string = QAAP_COMPOSER_DEFAULT_AGENT_ID,
    ): void {
        const cwd = this.host.projectsService.getProjectCwd(project);
        const runtime = applyProjectComposerDefaults(cwd, defaultAgentId);
        this.host.transcriptComposerPrefsConvId = undefined;
        this.host.transcriptComposerPinnedAgentId = runtime.pinnedAgentId;
        this.host.transcriptComposerAgentModel = runtime.agentModel;
        const modes = resolveStickyComposerModes(runtime.pinnedAgentId, this.host.chatAgentService);
        this.host.transcriptComposerModeId = reconcileComposerModeId(runtime.modeId, modes, cwd);
        this.host.transcriptComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
            runtime.approvalPolicyId,
            cwd,
        );
        this.host.transcriptComposerToolApprovalRules = runtime.toolApprovalRules;
        this.host.transcriptComposerDraft = '';
    }

    async hydrateTranscriptComposerPrefs(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<boolean> {
        if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
            return false;
        }
        if (this.host.transcriptComposerPrefsConvId === summary.id) {
            return false;
        }
        const prefsFromSummary = extractConversationComposerPrefsFromSummary(summary);
        if (prefsFromSummary && (summary.agentModel ?? summary.qaiqModel ?? summary.interactionModeId)) {
            this.applyTranscriptComposerPrefs(prefsFromSummary, project, summary, summary.id);
            return true;
        }
        const conv = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv
            : this.host.conversations?.threadStore.getDocument(summary.id)
            ?? await getConversation(summary.id).catch(() => undefined);
        if (!conv || conv.id !== summary.id) {
            return false;
        }
        this.applyTranscriptComposerPrefsFromConversation(conv, project, summary);
        return true;
    }

    schedulePersistTranscriptComposerDraft(conversationId: string | undefined): void {
        if (!conversationId) {
            return;
        }
        if (this.host.transcriptComposerDraftPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerDraftPersistTimer);
        }
        this.host.transcriptComposerDraftPersistTimer = window.setTimeout(() => {
            this.host.transcriptComposerDraftPersistTimer = undefined;
            writeConversationComposerDraft(conversationId, this.host.transcriptComposerDraft);
        }, 280);
    }

    flushTranscriptComposerDraft(conversationId: string | undefined): void {
        if (this.host.transcriptComposerDraftPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerDraftPersistTimer);
            this.host.transcriptComposerDraftPersistTimer = undefined;
        }
        if (conversationId) {
            writeConversationComposerDraft(conversationId, this.host.transcriptComposerDraft);
        }
    }

    schedulePersistTranscriptComposerPrefs(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
            return;
        }
        if (this.host.transcriptComposerPrefsPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerPrefsPersistTimer);
        }
        this.host.transcriptComposerPrefsPersistTimer = window.setTimeout(() => {
            this.host.transcriptComposerPrefsPersistTimer = undefined;
            void this.persistTranscriptComposerPrefs(project, summary);
        }, 320);
    }

    async flushTranscriptComposerPrefs(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (this.host.transcriptComposerPrefsPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerPrefsPersistTimer);
            this.host.transcriptComposerPrefsPersistTimer = undefined;
        }
        await this.persistTranscriptComposerPrefs(project, summary);
    }

    async persistTranscriptComposerPrefs(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (summary.source === 'theia-chat' || isAgentsHubIdleConversationSummary(summary)) {
            return;
        }
        const agentId = this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary);
        const cwd = this.host.projectsService.getProjectCwd(project) ?? summary.cwd;
        const patch = buildRuntimeComposerPersistPatch(agentId, cwd, {
            agentModel: this.host.transcriptComposerAgentModel,
            modeId: this.host.transcriptComposerModeId,
            approvalPolicyId: this.host.transcriptComposerApprovalPolicyId,
            toolApprovalRules: reconcileAgentToolApprovalRules(
                this.host.transcriptComposerApprovalPolicyId,
                cwd,
                this.host.transcriptComposerToolApprovalRules,
            ),
        });
        if (Object.keys(patch).length === 0) {
            return;
        }
        try {
            const updated = await updateConversation(summary.id, patch);
            this.host.transcriptComposerPrefsConvId = updated.id;
            if (this.host.transcriptLastConv?.id === updated.id) {
                this.host.transcriptLastConv = updated;
            }
            const updatedSummary = conversationToSummary(updated);
            this.host.conversations?.recordSnapshot(updatedSummary);
            if (this.host.transcriptOpenSummary?.id === summary.id) {
                this.host.transcriptOpenSummary = updatedSummary;
            }
        } catch {
            /* best-effort — composer still works for the current runtime */
        }
    }

    protected async ensureTranscriptComposerPrefsForMount(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (isAgentsHubIdleConversationSummary(summary)) {
            this.host.transcriptComposerAgentModel = undefined;
            // The idle summary id is a shared constant across all projects (not per-conversation), so its
            // draft is persisted per project rather than through the per-conversation draft storage below.
            this.host.transcriptComposerDraft = readProjectComposerDraft(project.id, this.host.transcriptComposerDraft);
            return;
        }
        if (summary.source === 'theia-chat') {
            this.host.transcriptComposerAgentModel = undefined;
            return;
        }
        if (this.host.transcriptLastConv?.id === summary.id
            && this.host.transcriptComposerPrefsConvId !== summary.id) {
            this.applyTranscriptComposerPrefsFromConversation(this.host.transcriptLastConv, project, summary);
            return;
        }
        const cachedDocument = this.host.conversations?.threadStore.getDocument(summary.id);
        if (cachedDocument && this.host.transcriptComposerPrefsConvId !== summary.id) {
            this.applyTranscriptComposerPrefsFromConversation(cachedDocument, project, summary);
            return;
        }
        if (this.host.transcriptComposerPrefsConvId === summary.id) {
            return;
        }
        await this.hydrateTranscriptComposerPrefs(project, summary);
    }

    mountTranscriptStickyComposer(
        host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        chatHost: HTMLElement,
    ): void {
        void this.mountTranscriptStickyComposerAsync(host, project, summary, chatHost);
    }

    protected async mountTranscriptStickyComposerAsync(
        host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        chatHost: HTMLElement,
    ): Promise<void> {
        const focusEligibleBeforeMount = isIdleComposerFocusStealable(document.activeElement, undefined);
        const cwd = this.host.projectsService.getProjectCwd(project) ?? summary.cwd;
        warmAgentTurnPath(cwd, {
            warmLiveTransport: () => this.host.conversations?.warmLiveTransport(),
        });
        const mountKey = `${project.id}|${summary.id}`;
        const composerStable = this.host.transcriptComposerMountKey === mountKey
            && this.host.transcriptComposerHost === host
            && host.childElementCount > 0;
        if (composerStable) {
            this.syncTranscriptComposerQuickActionsVisibility(host, summary);
            this.host.transcriptComposerSendRefresh?.();
            this.refreshComposerActivityStack();
            return;
        }
        this.host.transcriptComposerMountKey = mountKey;
        this.host.transcriptComposerHost = host;
        this.host.transcriptComposerProject = project;
        this.host.transcriptComposerSummary = summary;
        this.host.transcriptComposerSendRefresh = undefined;
        await this.ensureTranscriptComposerPrefsForMount(project, summary);
        if (this.host.transcriptComposerHost !== host
            || this.host.transcriptComposerSummary?.id !== summary.id) {
            return;
        }
        // Conversations share the project's working tree — a git snapshot cached while another
        // session was open can be stale (e.g. committed meanwhile). Refetch per (re)mount so the
        // Changes pill + commit button reflect this conversation's current pending changes.
        // Latches (resolved/clean) are intentionally preserved across mounts: they prevent a brief
        // flash of the Changes pill between the mount and the first fresh git fetch completing.
        // The latches are updated naturally by selectComposerPillChanges once the fetch returns.
        this.composerActivityGitFilesByConversationId.delete(summary.id);
        this.host.stickyComposerContextUsageDispose.dispose();
        // Park the Working expand shell before wipe so transcript remounts cannot destroy it.
        parkWorkingControlFromAncestor(host);
        host.replaceChildren();
        this.syncTranscriptComposerQuickActionsVisibility(host, summary);
        const shell = document.createElement('div');
        shell.className = 'theia-mobile-projects-sticky-composer';
        shell.append(this.workHub.createAgentsHubQuickActionsBlock());
        const isLegacyTheiaChat = summary.source === 'theia-chat';
        const pinnedId = this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary);
        const modes = resolveStickyComposerModes(pinnedId, this.host.chatAgentService);
        this.host.transcriptComposerModeId = reconcileComposerModeId(
            this.host.transcriptComposerModeId,
            modes,
            cwd,
        );
        this.host.transcriptComposerCapabilityLevel = reconcileModelCapabilityLevel(
            this.host.transcriptComposerCapabilityLevel,
            cwd,
        );
        const showApprovalPolicy = !isLegacyTheiaChat && agentSupportsApprovalPolicy(pinnedId);
        let capabilityTriggerRefresh: (() => void) | undefined;
        if (showApprovalPolicy) {
            this.host.transcriptComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
                this.host.transcriptComposerApprovalPolicyId,
                cwd,
            );
            this.host.transcriptComposerToolApprovalRules = reconcileAgentToolApprovalRules(
                this.host.transcriptComposerApprovalPolicyId,
                cwd,
                this.host.transcriptComposerToolApprovalRules,
            );
        } else {
            this.host.transcriptComposerApprovalPolicyId = undefined;
            this.host.transcriptComposerToolApprovalRules = undefined;
        }
        const activityOptions = this.buildTranscriptComposerActivityOptions(project, summary);
        const column = this.host.stickyComposerColumnUi.buildStickyComposerColumn({
            project,
            composerCwd: cwd,
            surface: 'task',
            agentLocked: isLegacyTheiaChat,
            activityStack: renderStickyComposerActivityStack(activityOptions),
            changesPill: renderStickyComposerChangesPill(activityOptions),
            getContext: () => this.host.transcriptComposerContext,
            clearContext: () => {
                disposeComposerContextEntries(this.host.transcriptComposerContext);
                this.host.transcriptComposerContext = [];
                this.remountTranscriptStickyComposer();
            },
            removeContextItem: index => {
                const entry = this.host.transcriptComposerContext[index];
                revokeComposerContextPreview(entry);
                this.host.transcriptComposerContext.splice(index, 1);
                this.host.handleComposerContextItemRemoved(entry);
                this.remountTranscriptStickyComposer();
            },
            formatContextChip: item => this.host.stickyComposerContextUi.formatComposerContextEntry(item),
            filesExpanded: this.host.transcriptComposerFilesExpanded,
            onFilesExpandedChange: expanded => { this.host.transcriptComposerFilesExpanded = expanded; },
            getDraft: () => this.host.transcriptComposerDraft,
            setDraft: value => {
                this.host.transcriptComposerDraft = value;
                if (isAgentsHubIdleConversationSummary(summary)) {
                    // Shared idle summary id — persist per project instead of per conversation.
                    writeProjectComposerDraft(project.id, value);
                } else {
                    this.schedulePersistTranscriptComposerDraft(summary.id);
                }
            },
            resolveAgentLabel: () => this.host.transcriptComposerUi.resolveTranscriptComposerAgentLabel(),
            resolveAgentId: () => this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
            resolveAgentModel: () => this.host.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                cwd,
            ),
            modes,
            resolveModeLabel: () => resolveComposerModeLabel(modes, this.host.transcriptComposerModeId),
            resolveModeId: () => this.host.transcriptComposerModeId,
            onOpenModeSheet: modes.length > 1
                ? anchor => { this.host.transcriptComposerUi.openTranscriptComposerModeSheet(project, summary, modes, anchor); }
                : undefined,
            approvalPolicyId: showApprovalPolicy ? this.host.transcriptComposerApprovalPolicyId : undefined,
            onOpenApprovalPolicySheet: showApprovalPolicy
                ? anchor => {
                    this.host.transcriptComposerUi.openTranscriptComposerApprovalPolicySheet(
                        project,
                        summary,
                        this.host.transcriptComposerUi.resolveTranscriptComposerAgentLabel(),
                        anchor,
                    );
                }
                : undefined,
            canSubmit: true,
            onImprovePrompt: this.host.composerPromptImprover
                ? createStickyComposerImprovePromptHandler({
                    improver: this.host.composerPromptImprover,
                    resolveAgentId: () => this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                    resolveAgentModel: () => readStoredAgentModel(
                        cwd,
                        this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                    ),
                    resolveCwd: () => cwd,
                })
                : undefined,
            isAgentWorking: () => this.isTranscriptStickyComposerAgentWorking(),
            isAgentBeamIdle: () => this.isTranscriptStickyComposerAgentBeamIdle(),
            onStop: () => {
                // Re-resolve the target when the mount closure captured the idle placeholder
                // (a freshly-delegated task, or a new-chat that replaced idle→real after mount):
                // the closure summary would be `__qaap_agents_hub_idle__`, so a bare cancel hit a
                // conversation id the backend doesn't have and the Stop button did nothing. When
                // the closure already holds a REAL conversation, keep it — never re-resolve to the
                // shell's currently-selected project and cancel a different project's stream.
                let stopProject = project;
                let stopSummary = summary;
                if (isAgentsHubIdleConversationSummary(summary)) {
                    stopProject = this.workHub.resolveShellProject() ?? project;
                    stopSummary = this.workHub.resolveShellSummary(stopProject) ?? summary;
                }
                void this.host.onCancelConversation(stopProject, stopSummary);
            },
            onSendControlMounted: refresh => { this.host.transcriptComposerSendRefresh = refresh; },
            onAttach: anchor => { void this.onTranscriptComposerAttach(project, anchor); },
            onOpenAgentSheet: isLegacyTheiaChat
                ? () => { /* Legacy Theia chat is not agent-switchable */ }
                : anchor => { this.host.transcriptComposerUi.openTranscriptComposerAgentSheet(project, summary, anchor); },
            sendLabel: this.isTranscriptStickyComposerAgentWorking()
                ? nls.localize('qaap/mobileProjects/transcriptQueue', 'Queue')
                : nls.localize('qaap/mobileProjects/transcriptSend', 'Send'),
            onSubmit: draft => {
                if (hasPendingComposerContextEntries(this.host.transcriptComposerContext)) {
                    this.host.stickyComposerContextUi.notifyPendingComposerAttachments();
                    return;
                }
                // Re-resolve the idle-composer target at SUBMIT time. The mount
                // closure can hold a stale project captured during boot — e.g.
                // the ephemeral workspace-container entry fabricated before the
                // projects list loaded — and an agent turn must never inherit
                // that cwd from the closure (observed live: the chip showed the
                // real project while the created conversation targeted the
                // multi-repo container).
                let submitProject = project;
                let submitSummary = summary;
                if (isAgentsHubIdleConversationSummary(summary)) {
                    const fresh = this.workHub.resolveShellProject();
                    if (fresh && fresh.id !== project.id) {
                        submitProject = fresh;
                        submitSummary = this.workHub.resolveShellSummary(fresh) ?? summary;
                    }
                }
                void this.submitTranscriptComposerDraft(draft, submitProject, submitSummary, chatHost, {
                    resolvedPinnedId: this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(submitProject, submitSummary),
                    showApprovalPolicy,
                    isLegacyTheiaChat,
                });
            },
            getMentionOptions: () => this.host.stickyComposerContextUi.resolveComposerMentionOptions(this.host.transcriptComposerBackendAgents, false),
            getVariableOptions: this.host.getComposerVariables
                ? () => this.host.stickyComposerContextUi.resolveComposerVariableOptions()
                : undefined,
            getSkillOptions: this.host.getComposerSkills
                ? () => this.host.stickyComposerContextUi.resolveComposerSkillOptions()
                : undefined,
            getSlashMenuSections: () => this.host.stickyComposerContextUi.resolveComposerSlashMenuSections(),
            onSlashAction: (actionId, prompt) => this.host.stickyComposerRenderUi.handleStickyComposerSlashAction(actionId, prompt),
            getInstalledMcpServerSlugs: () => this.host.stickyComposerRenderUi.resolveInstalledMcpServerSlugs(),
            onInstallMcpPlugin: pluginId => this.host.stickyComposerRenderUi.handleInstallMcpPlugin(pluginId),
            onRemoveMcpServer: slug => this.host.stickyComposerRenderUi.handleRemoveMcpServer(slug),
            onBrowseMcpMarketplace: () => this.host.stickyComposerRenderUi.handleBrowseMcpMarketplace(),
            getSkillNames: this.host.getComposerSkills
                ? () => this.host.getComposerSkills!().map(skill => skill.name)
                : undefined,
            inputPlaceholder: isAgentsHubIdleConversationSummary(summary)
                ? nls.localize('qaap/mobileProjects/stickyComposerNewTask', 'Delegate a task…')
                : isLegacyTheiaChat
                    ? nls.localize('qaap/mobileProjects/transcriptLegacyTheiaPlaceholder', 'Start a new QAIQ session…')
                    : nls.localize('qaap/mobileProjects/transcriptTaskPlaceholder', 'Follow up on this task…'),
            resolveCapabilityLevel: () => this.host.transcriptComposerCapabilityLevel
                ?? reconcileModelCapabilityLevel(undefined, cwd),
            onOpenCapabilityPopover: !isLegacyTheiaChat
                ? anchor => {
                    this.host.stickyComposerSheetsUi.openStickyComposerModelCapabilityPopover({
                        anchor,
                        cwd,
                        transcriptOverlay: !this.host.agentsHubShellActive,
                        resolveLevel: () => this.host.transcriptComposerCapabilityLevel
                            ?? reconcileModelCapabilityLevel(undefined, cwd),
                        assignLevel: level => { this.host.transcriptComposerCapabilityLevel = level; },
                        onCommit: () => capabilityTriggerRefresh?.(),
                    });
                }
                : undefined,
            onCapabilityTriggerMounted: !isLegacyTheiaChat
                ? refresh => { capabilityTriggerRefresh = refresh; }
                : undefined,
            onContextUsageBadgeMounted: badge => {
                this.host.stickyComposerContextUsageDispose = this.host.stickyComposerRenderUi.mountStickyComposerContextUsage(
                    badge,
                    () => this.resolveTranscriptContextUsageTarget(summary),
                );
            },
            onOpenContextUsageSheet: anchor => {
                this.host.stickyComposerSheetsUi.openStickyComposerContextUsageSheet(
                    () => {
                        const target = this.resolveTranscriptContextUsageTarget(summary);
                        if (target?.chatModel) {
                            return resolveChatModelContextUsageBreakdown(target.chatModel);
                        }
                        return resolveVpsContextUsageBreakdown(target?.summary, target?.full);
                    },
                    !this.host.agentsHubShellActive,
                    anchor,
                );
            },
            transcriptOverlay: !this.host.agentsHubShellActive,
        });
        const modeHint = describeComposerInteractionMode(this.host.transcriptComposerModeId);
        if (modeHint) {
            const modeBanner = document.createElement('div');
            modeBanner.className = 'theia-mobile-sticky-composer-mode-banner';
            modeBanner.textContent = modeHint;
            shell.append(modeBanner);
        }
        if (isLegacyTheiaChat) {
            const legacyBanner = document.createElement('div');
            legacyBanner.className = 'theia-mobile-sticky-composer-legacy-banner';
            legacyBanner.textContent = nls.localize(
                'qaap/mobileProjects/transcriptLegacyTheiaBanner',
                'Legacy local chat — replies start a new QAIQ session in the cloud.',
            );
            shell.append(legacyBanner);
        }
        shell.append(column);
        host.append(shell);
        const isIdleComposer = isAgentsHubIdleConversationSummary(summary);
        this.agentsHubIdleComposerMounted = isIdleComposer;
        // Autofocus deterministically AFTER the frontend reaches 'ready' — the
        // boot sequence remounts the composer and shuffles focus (xterm's
        // hidden helper textarea, shell activation) at unpredictable times, so
        // timing heuristics lose. Every idle mount during the boot window
        // re-arms this; the ready-await plus the focus check at focus time
        // ensure exactly one deliberate focus that nothing later steals back.
        if (isIdleComposer && focusEligibleBeforeMount && Date.now() < this.idleComposerAutofocusDeadline) {
            void (this.host.whenFrontendReady?.() ?? Promise.resolve()).then(() => {
                window.requestAnimationFrame(() => {
                    const textarea = host.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input');
                    if (!textarea || !textarea.isConnected || textarea.disabled) {
                        return;
                    }
                    if (!isIdleComposerFocusStealable(document.activeElement, textarea)) {
                        return;
                    }
                    textarea.focus();
                    // Late boot stragglers can still steal this focus back to
                    // <body> moments later — defend it for a short window.
                    this.scheduleIdleComposerFocusRetention(textarea);
                });
            });
        }
        this.syncTranscriptComposerQuickActionsVisibility(host, summary);
        this.host.updateWorkingPillChrome();
        this.syncComposerActivityFingerprint(summary, project);
        if (this.host.transcriptLastConv?.id === summary.id) {
            this.host.transcriptLiveUi.syncTranscriptPendingApproval(this.host.transcriptLastConv);
        }
    }

    protected async submitTranscriptComposerDraft(
        draft: string,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        chatHost: HTMLElement,
        options: {
            readonly resolvedPinnedId: string;
            readonly showApprovalPolicy: boolean;
            readonly isLegacyTheiaChat: boolean;
        },
    ): Promise<void> {
        const contextSnapshot = [...this.host.transcriptComposerContext];
        const selectedAgentId = resolveExplicitAgentForSubmit(draft, {
            pinnedChatAgentId: options.resolvedPinnedId,
        }) ?? options.resolvedPinnedId;
        const requests = composerContextRequests(contextSnapshot);
        const variables = requests.length > 0 ? requests : undefined;
        const imagePreviews = await collectComposerImagePreviews(
            contextSnapshot,
            this.host.resolveAttachmentPreview,
        );
        const modeId = this.host.transcriptComposerModeId;
        const autoApprove = resolveComposerAutoApprove(
            options.showApprovalPolicy,
            this.host.transcriptComposerApprovalPolicyId,
            summary.cwd,
        );
        this.host.transcriptComposerContext = [];
        const commitComposerSubmission = (): void => {
            disposeComposerContextEntries(contextSnapshot);
        };
        const restoreComposerSubmission = (): void => {
            const existingIds = new Set(this.host.transcriptComposerContext.map(entry => entry.id));
            this.host.transcriptComposerContext = [
                ...contextSnapshot.filter(entry => !existingIds.has(entry.id)),
                ...this.host.transcriptComposerContext,
            ];
            this.host.transcriptComposerDraft = mergeFailedComposerDraft(
                draft,
                this.host.transcriptComposerDraft,
            );
            if (isAgentsHubIdleConversationSummary(summary)) {
                writeProjectComposerDraft(project.id, this.host.transcriptComposerDraft);
            } else {
                writeConversationComposerDraft(summary.id, this.host.transcriptComposerDraft);
            }
        };
        const clearComposerDraft = (): void => {
            if (this.host.transcriptComposerDraftPersistTimer !== undefined) {
                window.clearTimeout(this.host.transcriptComposerDraftPersistTimer);
                this.host.transcriptComposerDraftPersistTimer = undefined;
            }
            if (isAgentsHubIdleConversationSummary(summary)) {
                // Shared idle summary id — clear the project-scoped draft instead of the (unrelated) per-conversation one.
                writeProjectComposerDraft(project.id, '');
            } else {
                clearConversationComposerDraft(summary.id);
            }
            this.host.transcriptComposerDraft = '';
        };
        if (this.isTranscriptStickyComposerAgentWorking() && !isAgentsHubIdleConversationSummary(summary)) {
            // Sending while an agent works starts ANOTHER agent beside it (in-session
            // multitasking) rather than waiting in line. The queue is now the overflow path:
            // it only catches the message once the session holds the backend's run limit.
            const entry: TranscriptFollowUpEntry = {
                draft,
                selectedAgentId,
                modeId,
                autoApprove,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    this.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
                variables,
                imagePreviews,
            };
            clearComposerDraft();
            const input = this.host.transcriptComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-input');
            // Column submit clears the textarea; re-dispatch input so the syntax mirror refreshes too.
            input?.dispatchEvent(new Event('input', { bubbles: true }));
            this.host.transcriptComposerSendRefresh?.();
            try {
                if (await this.startPeerRunOrQueue(project, summary, entry)) {
                    commitComposerSubmission();
                } else {
                    restoreComposerSubmission();
                    this.remountTranscriptStickyComposer();
                }
            } catch (error) {
                restoreComposerSubmission();
                const detail = error instanceof Error ? error.message : String(error);
                this.host.messageService?.error(nls.localize(
                    'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail,
                ));
                this.remountTranscriptStickyComposer();
            }
            return;
        }
        clearComposerDraft();
        if (isAgentsHubIdleConversationSummary(summary)) {
            const activeChatHost = this.resolveComposerTranscriptChatHost(chatHost);
            if (activeChatHost) {
                this.workHub.renderIdleSubmitOptimistic(activeChatHost, summary, draft, selectedAgentId, imagePreviews);
            }
            this.host.transcriptComposerSendRefresh?.();
            try {
                await this.host.submitBackgroundAgentTask(project, draft, {
                    openConversation: true,
                    forceVps: true,
                    selectedAgentId,
                    modeId,
                    variables,
                    autoApprove,
                    worktree: this.host.stickyComposerWorkspaceUi.resolveComposerWorkspaceDestination(project) === 'worktree',
                    approvalPolicyId: reconcileAgentApprovalPolicyId(
                        this.host.transcriptComposerApprovalPolicyId,
                        summary.cwd,
                    ),
                    agentModel: this.host.transcriptComposerAgentModel,
                    imagePreviews,
                });
                commitComposerSubmission();
            } catch {
                restoreComposerSubmission();
                /* submitBackgroundAgentTask surfaces errors */
            } finally {
                if (this.host.transcriptComposerHost?.isConnected) {
                    this.remountTranscriptStickyComposer();
                } else {
                    this.host.stickyComposerRenderUi.renderStickyComposer();
                }
            }
            return;
        }
        const activeChatHost = this.resolveComposerTranscriptChatHost(chatHost);
        if (activeChatHost && !options.isLegacyTheiaChat) {
            this.workHub.renderIdleSubmitOptimistic(activeChatHost, summary, draft, selectedAgentId, imagePreviews);
        }
        try {
            if (options.isLegacyTheiaChat) {
                await this.host.submitBackgroundAgentTask(project, draft, {
                    openConversation: true,
                    forceVps: true,
                    selectedAgentId: QAAP_PRIMARY_AGENT_ID,
                    modeId,
                    variables,
                    autoApprove,
                    approvalPolicyId: reconcileAgentApprovalPolicyId(
                        this.host.transcriptComposerApprovalPolicyId,
                        summary.cwd,
                    ),
                    imagePreviews,
                });
                commitComposerSubmission();
            } else {
                const submitted = await this.host.submitTranscriptViaBackendConversation(project, summary, draft, {
                    selectedAgentId,
                    modeId,
                    variables,
                    autoApprove,
                    approvalPolicyId: reconcileAgentApprovalPolicyId(
                        this.host.transcriptComposerApprovalPolicyId,
                        summary.cwd,
                    ),
                    agentModel: this.host.transcriptComposerAgentModel,
                    imagePreviews,
                });
                if (!submitted) {
                    restoreComposerSubmission();
                    this.host.messageService?.warn(nls.localize(
                        'qaap/mobileProjects/transcriptSendInFlight',
                        'Another message is still being sent. Your draft and attachments were restored.',
                    ));
                    return;
                }
                commitComposerSubmission();
            }
        } catch (error) {
            restoreComposerSubmission();
            if (isMaxConcurrentRunsError(error)) {
                // The conversation already has the maximum number of concurrent agent runs.
                // Show a friendly message instead of a generic error — the user can wait for
                // one of the running tasks to finish and then resend.
                this.host.messageService?.warn(nls.localize(
                    'qaap/mobileProjects/maxConcurrentRuns',
                    'This task already has the maximum number of agents running. Wait for one to finish, then resend.',
                ));
            } else {
                const detail = error instanceof Error ? error.message : String(error);
                this.host.messageService?.error(nls.localize(
                    'qaap/mobileProjects/transcriptSendFailed', 'Could not send: {0}', detail
                ));
            }
        } finally {
            this.remountTranscriptStickyComposer();
        }
    }

    remountTranscriptStickyComposer(): void {
        const host = this.host.transcriptComposerHost;
        const project = this.host.transcriptComposerProject;
        const summary = this.host.transcriptComposerSummary;
        const chatHost = this.resolveComposerTranscriptChatHost(this.host.transcriptChatHost);
        if (!host?.isConnected || !project || !summary) {
            return;
        }
        this.host.transcriptComposerMountKey = undefined;
        this.mountTranscriptStickyComposer(host, project, summary, chatHost ?? host);
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import type { QaapGitHistoryCommit } from '../common/qaap-git-review';
import { setMobileActiveTranscriptChrome } from './mobile-projects-open';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import { TranscriptFollowUpQueue } from '../common/qaap-transcript-follow-up-queue';
import { ensureTranscriptSurfaceCss } from './ensure-transcript-surface-css';
import type { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import type { MobileProjectChatViewWidget } from './mobile-project-ai-chat-input-widget';
import { disposeComposerContextEntries, type StickyComposerContextEntry } from '../common/qaap-composer-context-entry';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';

interface VerifyCheckResult {
    readonly check: { readonly label: string; readonly command: string };
    readonly state: string;
}

/** Panel surface for opening and closing the full-screen transcript sheet overlay. */
export interface MobileProjectsTranscriptSheetHost {
    replacingTranscriptSheet: boolean;
    transcriptSheet: HTMLElement | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptChatInputHost: HTMLElement | undefined;
    transcriptComposerSizeDispose: Disposable;
    transcriptTabStrip: HTMLElement | undefined;
    transcriptReviewHost: HTMLElement | undefined;
    transcriptPreviewHost: HTMLElement | undefined;
    transcriptFilesHost: HTMLElement | undefined;
    transcriptTerminalHost: HTMLElement | undefined;
    transcriptTerminalToolbar: HTMLElement | undefined;
    transcriptTerminalSlider: HTMLElement | undefined;
    transcriptTerminalDots: HTMLElement | undefined;
    verifyResults: VerifyCheckResult[];
    verifyChecksCwd: string | undefined;
    verifyChecksLoading: boolean;
    verifyRunning: boolean;
    verifyAutoAttempts: number;
    transcriptHistoryPanelOpen: boolean;
    transcriptHistoryCommits: QaapGitHistoryCommit[];
    transcriptHistoryBranch: string | undefined;
    /** Human-readable load failure for the history list. */
    transcriptHistoryError: string | undefined;
    transcriptHistoryQuery: string;
    transcriptHistoryAuthorFilter: string | undefined;
    transcriptHistoryBranchFilter: string | undefined;
    transcriptHistoryRoot: string | undefined;
    transcriptHistoryLoading: boolean;
    transcriptLastStatus: string | undefined;
    transcriptOpenSummaryId: string | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptLastFingerprint: string | undefined;
    transcriptComposerPrefsConvId: string | undefined;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerMountKey: string | undefined;
    transcriptComposerProject: MobileProjectEntry | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptComposerContext: StickyComposerContextEntry[];
    transcriptComposerPinnedAgentId: string | undefined;
    transcriptComposerAgentModel: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel | undefined;
    transcriptComposerModeId: string | undefined;
    transcriptComposerApprovalPolicyId: import('../common/qaap-sticky-composer-approval-policy').QaapAgentApprovalPolicyId | undefined;
    transcriptComposerDraft: string;
    transcriptComposerDraftPersistTimer: number | undefined;
    transcriptComposerPrefsPersistTimer: number | undefined;
    transcriptFollowUpFlushInFlight: boolean;
    transcriptFollowUpQueue: TranscriptFollowUpQueue;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptLastSseDeltaAt: number | undefined;
    transcriptLastStreamProgressAt: number | undefined;
    transcriptHeaderSubtitle: HTMLElement | undefined;
    transcriptPreviewRequestRunning: boolean;
    transcriptPreviewRequestPending: boolean;
    transcriptChatInputWidget: AIChatInputWidget | undefined;
    transcriptChatViewWidget: MobileProjectChatViewWidget | undefined;
    transcriptSheetDispose: Disposable;
    transcriptUserScrollPinDispose: Disposable;
    transcriptTheiaSessionByConversationId: Map<string, string>;
    transcriptUi: MobileProjectsTranscriptUi;
    transcriptComposerUi: MobileProjectsTranscriptComposerUi;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    transcriptLiveUi: MobileProjectsTranscriptLiveUi;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;
    agentsHubInlineActive: boolean;
    conversations?: import('./mobile-projects-conversations').MobileProjectsConversations;
    visible: boolean;
    delegate: {
        onEnterActiveTranscript?(): void;
        onExitActiveTranscript?(): void;
    };

    closeExecutionTabOverflowMenu(): void;
    closeParallelSheet(): void;
    detachTranscriptReviewWidget(): void;
    disposeTranscriptEmbeddedPreview(): void;
    detachTranscriptWorkspaceSurfacesFromSheet(): void;
}

/** Full-screen transcript sheet overlay: open, dismiss bindings, and teardown. */
export class MobileProjectsTranscriptSheetUi {

    constructor(
        protected readonly host: MobileProjectsTranscriptSheetHost,
        protected readonly workHub: WorkHubTranscriptBridge,
    ) { }

    createTranscriptSheetSurfaceHosts(): {
        reviewHost: HTMLElement;
        previewHost: HTMLElement;
        filesHost: HTMLElement;
        terminalHost: HTMLElement;
    } {
        const reviewHost = document.createElement('div');
        reviewHost.className = 'theia-mobile-transcript-review';
        reviewHost.hidden = true;
        const previewHost = document.createElement('div');
        previewHost.className = 'theia-mobile-transcript-preview';
        previewHost.hidden = true;
        const filesHost = document.createElement('div');
        filesHost.className = 'theia-mobile-transcript-files-host';
        filesHost.hidden = true;
        const terminalHost = document.createElement('div');
        terminalHost.className = 'theia-mobile-transcript-terminal-host';
        terminalHost.hidden = true;
        return { reviewHost, previewHost, filesHost, terminalHost };
    }

    async openTranscriptSheet(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        await ensureTranscriptSurfaceCss();
        if (this.workHub.isAgentsHubLanding() && !this.workHub.isProjectDetailView()) {
            await this.workHub.openInlineTranscript(project, summary);
            return;
        }
        if (this.host.transcriptSheet?.isConnected
            && this.host.transcriptChatHost
            && this.host.transcriptChatInputHost) {
            this.switchMountedTranscriptSheet(project, summary, this.host.transcriptChatHost, this.host.transcriptChatInputHost);
            return;
        }
        const previousProject = this.host.transcriptOpenProject;
        const previousSummary = this.host.transcriptOpenSummary;
        if (previousProject && previousSummary && previousSummary.id !== summary.id) {
            this.host.transcriptStickyComposerUi.flushTranscriptComposerDraft(previousSummary.id);
            void this.host.transcriptStickyComposerUi.flushTranscriptComposerPrefs(previousProject, previousSummary);
        }
        this.host.replacingTranscriptSheet = true;
        this.closeTranscriptSheet();
        this.host.replacingTranscriptSheet = false;
        // Opening a conversation is an explicit navigation action: start it in Chat.
        this.host.executionSurfaceTabsUi.setExecutionSurfaceTab?.(project, 'messages');
        this.host.delegate.onEnterActiveTranscript?.();
        const root = document.createElement('div');
        root.className = 'theia-mobile-agent-log theia-mobile-agent-transcript-root theia-mod-visible';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-agent-log-backdrop';
        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-agent-log-sheet theia-mod-transcript';
        const header = document.createElement('header');
        header.className = 'theia-mobile-agent-log-header';
        const headerTitle = this.host.transcriptHeaderUi.resolveTranscriptHeaderTitle(project, summary);
        const { back, tabStrip } = this.host.executionSurfaceTabsUi.mountTranscriptExecutionHeader(header, project, summary, headerTitle);

        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        chatHost.hidden = false;

        const chatInputHost = document.createElement('div');
        chatInputHost.className = 'theia-mobile-agent-transcript-chat-input';
        chatInputHost.hidden = false;

        const { reviewHost, previewHost, filesHost, terminalHost } = this.createTranscriptSheetSurfaceHosts();

        sheet.append(header, chatHost, reviewHost, previewHost, filesHost, terminalHost, chatInputHost);
        root.append(backdrop, sheet);
        document.body.append(root);
        this.host.transcriptSheet = root;
        this.host.transcriptChatHost = chatHost;
        this.host.transcriptChatInputHost = chatInputHost;
        this.observeTranscriptComposerSize(root, chatInputHost);
        this.host.transcriptTabStrip = tabStrip;
        this.host.transcriptReviewHost = reviewHost;
        this.host.transcriptPreviewHost = previewHost;
        this.host.transcriptFilesHost = filesHost;
        this.host.transcriptTerminalHost = terminalHost;
        this.host.transcriptTerminalToolbar = undefined;
        this.host.transcriptTerminalSlider = undefined;
        this.host.transcriptTerminalDots = undefined;
        this.host.verifyResults = [];
        this.host.verifyChecksCwd = undefined;
        this.host.verifyChecksLoading = false;
        this.host.verifyRunning = false;
        this.host.verifyAutoAttempts = 0;
        this.host.transcriptHistoryPanelOpen = false;
        this.host.transcriptHistoryCommits = [];
        this.host.transcriptHistoryBranch = undefined;
        this.host.transcriptHistoryError = undefined;
        this.host.transcriptHistoryQuery = '';
        this.host.transcriptHistoryAuthorFilter = undefined;
        this.host.transcriptHistoryBranchFilter = undefined;
        this.host.transcriptHistoryRoot = undefined;
        this.host.transcriptHistoryLoading = false;
        this.host.transcriptLastStatus = summary.status;
        this.host.transcriptOpenSummaryId = summary.id;
        this.host.transcriptOpenSummary = summary;
        this.host.transcriptOpenProject = project;
        this.host.transcriptLastFingerprint = undefined;
        if (this.host.visible) {
            this.workHub.refreshHubChrome();
            this.host.executionSurfaceTabsUi.syncHeaderExecutionTabStrip();
        }
        this.bindTranscriptSheetDismiss(back, backdrop);

        this.host.transcriptLiveUi.scheduleTranscriptConversationRefresh(project, summary, chatHost);
        if (!this.host.transcriptLiveUi.applyCachedTranscriptOnOpen(summary, chatHost)) {
            this.host.transcriptLiveUi.renderOpenTranscriptPlaceholder(chatHost, summary);
        }
        this.host.conversations?.prefetchDocument(summary.id);
        this.host.transcriptComposerPrefsConvId = undefined;
        this.host.transcriptComposerAgentModel = undefined;
        void this.host.transcriptComposerUi.refreshTranscriptComposerAgents(project);
        this.host.transcriptStickyComposerUi.mountTranscriptStickyComposer(chatInputHost, project, summary, chatHost);
        this.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab(
            this.host.executionSurfaceTabsUi.executionSurfaceTabForProject?.(project) ?? 'messages',
        );
        // Mount all tabs so they're available when switching views.
        // 'review' (Changes) is merged into the 'files' tab — no separate pre-mount.
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'messages');
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'preview');
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'files');
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'terminal');
    }

    protected switchMountedTranscriptSheet(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        chatHost: HTMLElement,
        chatInputHost: HTMLElement,
    ): void {
        const previousProject = this.host.transcriptOpenProject;
        const previousSummary = this.host.transcriptOpenSummary;
        const conversationChanged = previousSummary?.id !== summary.id;
        if (previousProject && previousSummary && conversationChanged) {
            this.host.transcriptStickyComposerUi.flushTranscriptComposerDraft(previousSummary.id);
            void this.host.transcriptStickyComposerUi.flushTranscriptComposerPrefs(previousProject, previousSummary);
        }
        if (conversationChanged) {
            this.prepareMountedTranscriptSheetForSwitch();
            // Selecting another conversation is an explicit navigation action: reset only this
            // project's surface to Chat. Re-opening the same conversation must preserve Files.
            this.host.executionSurfaceTabsUi.setExecutionSurfaceTab?.(project, 'messages');
            if (this.host.transcriptSheet) {
                this.observeTranscriptComposerSize(this.host.transcriptSheet, chatInputHost);
            }
            const header = this.host.transcriptSheet?.querySelector<HTMLElement>('.theia-mobile-agent-log-header');
            if (header) {
                header.replaceChildren();
                const headerTitle = this.host.transcriptHeaderUi.resolveTranscriptHeaderTitle(project, summary);
                const { back, tabStrip } = this.host.executionSurfaceTabsUi.mountTranscriptExecutionHeader(header, project, summary, headerTitle);
                this.host.transcriptTabStrip = tabStrip;
                const backdrop = this.host.transcriptSheet?.querySelector<HTMLElement>('.theia-mobile-agent-log-backdrop');
                if (backdrop) {
                    this.host.transcriptSheetDispose.dispose();
                    this.host.transcriptSheetDispose = Disposable.NULL;
                    this.bindTranscriptSheetDismiss(back, backdrop);
                }
            }
        }
        this.host.delegate.onEnterActiveTranscript?.();
        this.host.transcriptLastStatus = summary.status;
        this.host.transcriptOpenSummaryId = summary.id;
        this.host.transcriptOpenSummary = summary;
        this.host.transcriptOpenProject = project;
        this.host.transcriptComposerSummary = summary;
        this.host.transcriptChatHost = chatHost;
        this.host.transcriptChatInputHost = chatInputHost;
        if (this.host.visible) {
            this.workHub.refreshHubChrome();
            this.host.executionSurfaceTabsUi.syncHeaderExecutionTabStrip();
        }
        this.host.transcriptLiveUi.scheduleTranscriptConversationRefresh(project, summary, chatHost);
        if (!this.host.transcriptLiveUi.applyCachedTranscriptOnOpen(summary, chatHost)
            && this.host.transcriptLastConv?.id !== summary.id) {
            this.host.transcriptLiveUi.renderOpenTranscriptPlaceholder(chatHost, summary);
        }
        if (conversationChanged) {
            this.host.transcriptComposerPrefsConvId = undefined;
            this.host.transcriptComposerAgentModel = undefined;
            void this.host.transcriptComposerUi.refreshTranscriptComposerAgents(project);
            this.host.transcriptStickyComposerUi.mountTranscriptStickyComposer(chatInputHost, project, summary, chatHost);
        }
        const activeTab = this.host.executionSurfaceTabsUi.executionSurfaceTabForProject?.(project) ?? 'messages';
        this.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab(activeTab);
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'messages');
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'preview');
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'files');
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, 'terminal');
        this.host.conversations?.prefetchDocument(summary.id);
    }

    protected prepareMountedTranscriptSheetForSwitch(): void {
        this.host.executionSurfaceTabsUi.closeExecutionTabOverflowMenu();
        this.host.closeParallelSheet();
        this.host.transcriptComposerUi.closeTranscriptComposerSheets();
        this.host.transcriptComposerHost = undefined;
        this.host.transcriptComposerMountKey = undefined;
        this.host.transcriptComposerProject = undefined;
        this.host.transcriptComposerSummary = undefined;
        disposeComposerContextEntries(this.host.transcriptComposerContext);
        this.host.transcriptComposerContext = [];
        this.host.transcriptComposerPinnedAgentId = undefined;
        this.host.transcriptComposerAgentModel = undefined;
        this.host.transcriptComposerModeId = undefined;
        this.host.transcriptComposerApprovalPolicyId = undefined;
        this.host.transcriptComposerPrefsConvId = undefined;
        this.host.transcriptComposerDraft = '';
        if (this.host.transcriptComposerDraftPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerDraftPersistTimer);
            this.host.transcriptComposerDraftPersistTimer = undefined;
        }
        if (this.host.transcriptComposerPrefsPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerPrefsPersistTimer);
            this.host.transcriptComposerPrefsPersistTimer = undefined;
        }
        if (this.host.transcriptOpenSummaryId) {
            this.host.transcriptFollowUpQueue.clear(this.host.transcriptOpenSummaryId);
        }
        this.host.transcriptFollowUpFlushInFlight = false;
        this.host.transcriptLiveUi.stopTranscriptLiveWatch();
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLastConv = undefined;
        this.host.transcriptLastSseDeltaAt = undefined;
        this.host.transcriptLiveUi.clearTranscriptSemanticProgressClock();
        this.host.transcriptHeaderSubtitle = undefined;
        this.host.detachTranscriptReviewWidget();
        this.host.disposeTranscriptEmbeddedPreview();
        this.host.detachTranscriptWorkspaceSurfacesFromSheet();
        this.host.transcriptTerminalToolbar = undefined;
        this.host.transcriptTerminalSlider = undefined;
        this.host.transcriptTerminalDots = undefined;
        this.host.transcriptPreviewRequestRunning = false;
        this.host.transcriptPreviewRequestPending = false;
        this.host.verifyResults = [];
        this.host.verifyChecksCwd = undefined;
        this.host.verifyChecksLoading = false;
        this.host.verifyRunning = false;
        this.host.verifyAutoAttempts = 0;
        this.host.transcriptHistoryPanelOpen = false;
        this.host.transcriptHistoryCommits = [];
        this.host.transcriptHistoryBranch = undefined;
        this.host.transcriptHistoryError = undefined;
        this.host.transcriptHistoryQuery = '';
        this.host.transcriptHistoryAuthorFilter = undefined;
        this.host.transcriptHistoryBranchFilter = undefined;
        this.host.transcriptHistoryRoot = undefined;
        this.host.transcriptHistoryLoading = false;
        this.host.transcriptComposerSizeDispose.dispose();
        this.host.transcriptComposerSizeDispose = Disposable.NULL;
        this.host.transcriptUserScrollPinDispose.dispose();
        this.host.transcriptUserScrollPinDispose = Disposable.NULL;
        this.host.transcriptUi.disposeList();
        this.host.transcriptChatInputHost?.replaceChildren();
        this.host.transcriptReviewHost?.replaceChildren();
        this.host.transcriptPreviewHost?.replaceChildren();
        this.host.transcriptFilesHost?.replaceChildren();
        this.host.transcriptTerminalHost?.replaceChildren();
    }

    bindTranscriptSheetDismiss(back: HTMLButtonElement, backdrop: HTMLElement): void {
        const dismiss = (ev?: Event): void => {
            ev?.preventDefault();
            ev?.stopPropagation();
            const project = this.host.transcriptOpenProject;
            if (project && this.host.executionSurfaceTabsUi.navigateExecutionSurfaceBack(project)) {
                return;
            }
            this.closeTranscriptSheet();
        };
        // Dismiss on click only — closing on pointerdown removes the overlay before the
        // synthesized click fires, so the tap can land on the workbench back/account controls.
        back.addEventListener('click', dismiss);
        backdrop.addEventListener('click', dismiss);
        const onKeyDown = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') {
                dismiss(ev);
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        const previousDispose = this.host.transcriptSheetDispose;
        this.host.transcriptSheetDispose = Disposable.create(() => {
            previousDispose.dispose();
            back.removeEventListener('click', dismiss);
            backdrop.removeEventListener('click', dismiss);
            document.removeEventListener('keydown', onKeyDown, true);
        });
    }

    summaryToTranscriptPlaceholder(summary: QaapAgentConversationSummaryDTO): QaapAgentConversationDTO {
        return {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            // Empty shell only — never invent a message from lastMessagePreview (truncated list chrome).
            messages: [],
        };
    }

    closeTranscriptSheet(): void {
        const closingProject = this.host.transcriptOpenProject;
        closingProject && this.host.executionSurfaceTabsUi.setExecutionSurfaceTab?.(closingProject, 'messages');
        this.host.executionSurfaceTabsUi.closeExecutionTabOverflowMenu();
        this.host.closeParallelSheet();
        this.host.transcriptComposerUi.closeTranscriptComposerSheets();
        this.host.transcriptComposerHost = undefined;
        this.host.transcriptComposerMountKey = undefined;
        this.host.transcriptComposerProject = undefined;
        this.host.transcriptComposerSummary = undefined;
        disposeComposerContextEntries(this.host.transcriptComposerContext);
        this.host.transcriptComposerContext = [];
        this.host.transcriptComposerPinnedAgentId = undefined;
        this.host.transcriptComposerAgentModel = undefined;
        this.host.transcriptComposerModeId = undefined;
        this.host.transcriptComposerApprovalPolicyId = undefined;
        this.host.transcriptComposerPrefsConvId = undefined;
        this.host.transcriptComposerDraft = '';
        if (this.host.transcriptComposerDraftPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerDraftPersistTimer);
            this.host.transcriptComposerDraftPersistTimer = undefined;
        }
        if (this.host.transcriptComposerPrefsPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerPrefsPersistTimer);
            this.host.transcriptComposerPrefsPersistTimer = undefined;
        }
        if (this.host.transcriptOpenSummaryId) {
            this.host.transcriptFollowUpQueue.clear(this.host.transcriptOpenSummaryId);
        }
        this.host.transcriptFollowUpFlushInFlight = false;

        const wasAgentsHubInline = this.host.agentsHubInlineActive;
        const preserveAgentsShell = wasAgentsHubInline && this.workHub.isAgentsHubLanding();
        if (preserveAgentsShell) {
            this.workHub.closeAgentsHubSession();
            if (!this.host.transcriptSheet) {
                return;
            }
        } else if (wasAgentsHubInline && !this.workHub.isAgentsHubLanding()) {
            this.workHub.teardownAgentsHubShell();
        }

        const sheet = this.host.transcriptSheet;
        const sheetWasOnBody = sheet?.parentElement === document.body;
        this.host.transcriptSheet = undefined;
        this.host.transcriptOpenSummaryId = undefined;
        this.host.transcriptOpenSummary = undefined;
        this.host.transcriptOpenProject = undefined;
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLastConv = undefined;
        this.host.transcriptLastSseDeltaAt = undefined;
        this.host.transcriptLiveUi.clearTranscriptSemanticProgressClock();
        this.host.transcriptChatHost = undefined;
        this.host.transcriptChatInputHost = undefined;
        this.host.transcriptTabStrip = undefined;
        this.host.transcriptHeaderSubtitle = undefined;
        this.host.detachTranscriptReviewWidget();
        this.host.transcriptReviewHost = undefined;
        this.host.transcriptPreviewHost = undefined;
        this.host.disposeTranscriptEmbeddedPreview();
        this.host.detachTranscriptWorkspaceSurfacesFromSheet();
        this.host.transcriptFilesHost = undefined;
        this.host.transcriptTerminalHost = undefined;
        this.host.transcriptTerminalToolbar = undefined;
        this.host.transcriptTerminalSlider = undefined;
        this.host.transcriptTerminalDots = undefined;
        this.host.transcriptPreviewRequestRunning = false;
        this.host.transcriptPreviewRequestPending = false;
        this.host.verifyResults = [];
        this.host.verifyChecksCwd = undefined;
        this.host.verifyChecksLoading = false;
        this.host.verifyRunning = false;
        this.host.verifyAutoAttempts = 0;
        this.host.transcriptLastStatus = undefined;
        if (this.host.visible) {
            this.workHub.refreshHubChrome();
        }

        this.host.transcriptLiveUi.stopTranscriptLiveWatch();
        this.host.transcriptComposerSizeDispose.dispose();
        this.host.transcriptComposerSizeDispose = Disposable.NULL;
        this.host.transcriptUserScrollPinDispose.dispose();
        this.host.transcriptUserScrollPinDispose = Disposable.NULL;
        this.host.transcriptUi.disposeList();
        this.host.transcriptSheetDispose.dispose();
        this.host.transcriptSheetDispose = Disposable.NULL;
        this.host.transcriptTheiaSessionByConversationId.clear();

        sheet?.remove();
        if (sheetWasOnBody) {
            if (!this.host.replacingTranscriptSheet) {
                setMobileActiveTranscriptChrome(false);
                this.host.delegate.onExitActiveTranscript?.();
            }
            this.workHub.refreshHubBottomBar();
        } else if (wasAgentsHubInline && !this.host.replacingTranscriptSheet) {
            this.workHub.refreshHubBottomBar();
        }

        const inputWidget = this.host.transcriptChatInputWidget;
        const viewWidget = this.host.transcriptChatViewWidget;
        this.host.transcriptChatInputWidget = undefined;
        this.host.transcriptChatViewWidget = undefined;
        if (!inputWidget && !viewWidget) {
            return;
        }
        window.setTimeout(() => {
            if (inputWidget && !inputWidget.isDisposed) {
                inputWidget.dispose();
            }
            if (viewWidget && !viewWidget.isDisposed) {
                viewWidget.dispose();
            }
        }, 0);
    }

    /**
     * Publishes composer height on the sheet root (`--qaap-transcript-composer-height`) for
     * edge-fade / layout consumers. Scroll clearance is geometric (composer is a flex sibling).
     *
     * Also publishes `--qaap-composer-pill-strip-height`: the height of the changes/pill
     * strip row (`.theia-mobile-sticky-composer-changes-pill-host`) nested in the composer,
     * 0 when absent or hidden. Empty-chat padding uses this to avoid a dead zone above the
     * composer when the pill strip is showing.
     */
    protected observeTranscriptComposerSize(root: HTMLElement, composer: HTMLElement): void {
        this.host.transcriptComposerSizeDispose.dispose();
        const pillHostSelector = '.theia-mobile-sticky-composer-changes-pill-host';
        const apply = () => {
            const height = composer.hidden ? 0 : Math.round(composer.getBoundingClientRect().height);
            root.style.setProperty('--qaap-transcript-composer-height', `${height}px`);
            const pillHost = composer.querySelector<HTMLElement>(pillHostSelector);
            const pillHeight = pillHost && !pillHost.hidden ? Math.round(pillHost.getBoundingClientRect().height) : 0;
            root.style.setProperty('--qaap-composer-pill-strip-height', `${pillHeight}px`);
        };
        apply();
        if (typeof ResizeObserver === 'undefined') {
            this.host.transcriptComposerSizeDispose = Disposable.NULL;
            return;
        }
        const observer = new ResizeObserver(() => apply());
        observer.observe(composer);
        const pillHost = composer.querySelector<HTMLElement>(pillHostSelector);
        if (pillHost) {
            observer.observe(pillHost);
        }
        this.host.transcriptComposerSizeDispose = Disposable.create(() => observer.disconnect());
    }
}

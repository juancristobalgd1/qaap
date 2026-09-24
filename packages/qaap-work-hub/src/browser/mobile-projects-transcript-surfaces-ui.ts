// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { MessageService } from '@theia/core/lib/common/message-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    type EmbeddedAgentPreviewChrome,
} from '@theia/qaap-adapters/lib/browser/qaap-agent-preview-chrome';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapPreviewInspectorDeps } from '@theia/qaap-adapters/lib/browser/qaap-preview-inline-inspector';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import { type QaapAgentConversationDTO, type QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { type QaapAgentApprovalPolicyId } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import type { ExecutionSurfaceTabId } from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import type { QaapProjectBootstrapService } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import type { QaapMonorepoAppCandidate } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-types';
import {
    normalizeQaapPreviewConversationId,
    type QaapPreviewIdentity,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import type { QaapDiffReviewWidget } from '@theia/qaap-diff-review/lib/browser/qaap-diff-review-widget';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import {
    type TranscriptFilesViewMode,
    type TranscriptFilesViewServices,
} from '@theia/qaap-transcript/lib/browser/qaap-transcript-files-view';
import {
    type TranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from '@theia/qaap-transcript/lib/browser/qaap-transcript-terminal-view';
import {
    TranscriptWorkspaceSurfacesCache,
    type TranscriptWorkspaceSurfaceKey,
} from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-workspace-surfaces-cache';
import type { MobileProjectsTranscriptHistoryUi } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-history-ui';
import type { MobileProjectsTranscriptComposerUi } from '@theia/qaap-composer/lib/browser/mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptHeaderUi } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-header-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptMessagesUi } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from '@theia/qaap-composer/lib/browser/mobile-projects-transcript-sticky-composer-ui';
import type { MobileProjectsTranscriptVerifyHost } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-verify-ui';
import {
    pathsEqual as pathsEqualHelper,
    resolveTranscriptTerminalTabTitle as resolveTranscriptTerminalTabTitleHelper,
} from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-surfaces-helpers';
import { applyTranscriptPreviewRunButtonStateExtracted, createTranscriptPreviewRunButtonExtracted, hideHeaderFilesMoreButtonExtracted, hideHeaderViewModeSwitchExtracted, isTranscriptPreviewStoppableExtracted, isTranscriptPreviewWaitingExtracted, refreshTranscriptPreviewTabProbeExtracted, scheduleTranscriptPreviewTabProbeExtracted, stopTranscriptPreviewExtracted, stopTranscriptPreviewTabProbeExtracted, switchTranscriptPreviewAppExtracted, syncHeaderFilesMoreButtonExtracted, syncHeaderPreviewAppSwitchButtonExtracted, syncHeaderPreviewRunButtonExtracted, syncHeaderViewModeSwitchExtracted, updateTranscriptPreviewReadyOverlayExtracted } from './mobile-projects-transcript-surfaces-ui-activity';
import { adoptReadyTranscriptPreviewExtracted, requestTranscriptPreviewExtracted } from './mobile-projects-transcript-surfaces-ui-diff';
import { closeTranscriptTerminalTabExtracted, createTranscriptTerminalSlideExtracted, detachTranscriptFilesFromHostExtracted, detachTranscriptTerminalFromHostExtracted, ensureTranscriptTerminalChromeExtracted, ensureTranscriptTerminalTabExtracted, launchAgentTuiInTranscriptTerminalExtracted, mountFreshTranscriptTerminalSlideExtracted, persistTranscriptTerminalWorkspaceExtracted, renderTranscriptTerminalDotsExtracted, renderTranscriptTerminalSlidesExtracted, restoreTranscriptTerminalSlidesExtracted, showTranscriptTerminalErrorExtracted, syncTranscriptTerminalResizeObserverExtracted, toPersistedTerminalWorkspaceExtracted } from './mobile-projects-transcript-surfaces-ui-live-status';
import { bootstrapAppliesToProjectExtracted, bootstrapPreviewUrlForProjectExtracted, closeTranscriptPreviewAppPickerExtracted, ensurePreviewProjectContextExtracted, executionFilesHostExtracted, executionPreviewHostExtracted, executionSurfaceHostExtracted, executionTerminalHostExtracted, matchesActivePreviewSummaryExtracted, mountProjectDetailSurfaceTabExtracted, pickTranscriptPreviewAppExtracted, previewRuntimeForExtracted, setLastSyncedPreviewUrlExtracted, setMountedPreviewUrlExtracted, setProbeReadyPreviewUrlExtracted, transcriptConversationMetaExtracted, updateTranscriptHeaderExtracted } from './mobile-projects-transcript-surfaces-ui-render';
import { claimTranscriptPreviewExecutionExtracted, clearTranscriptEmptyPreviewChromeExtracted, detachTranscriptReviewWidgetExtracted, disposePreviewForConversationExtracted, disposeTranscriptEmbeddedPreviewExtracted, disposeTranscriptTerminalSlidesForConversationExtracted, getOrCreateOffscreenPreviewHostExtracted, getTranscriptEmbeddedPreviewUrlExtracted, mountTranscriptEmbeddedPreviewExtracted, mountTranscriptReviewWidgetExtracted, resolvePreviewAnnotationScopeExtracted, resolveTranscriptPreviewIdentityExtracted, submitTranscriptReviewFeedbackExtracted, suspendTranscriptPreviewIframeExtracted, wireTranscriptPreviewAnnotationScopeExtracted } from './mobile-projects-transcript-surfaces-ui-streaming';
import { beginTranscriptDevPreviewRequestExtracted, discoverProjectDevPreviewUrlExtracted, disposeTranscriptTerminalSlidesExtracted, prepareTranscriptTerminalsForPageUnloadExtracted, previewUrlMatchesProjectExtracted, refreshTranscriptPreviewProjectExtracted, resolveTranscriptPreviewUrlExtracted, syncTranscriptPreviewFromConversationExtracted } from './mobile-projects-transcript-surfaces-ui-thought-brief';
import { adoptReconciledProjectPreviewUrlExtracted, clearMismatchedProjectPreviewUrlExtracted, discoverAndMountTranscriptPreviewIfReadyExtracted, fetchCurrentProjectClaimUrlExtracted, reconcileSupersededProjectPreviewUrlExtracted, renderPreviewTabExtracted, scheduleTranscriptPreviewIdentityWatchExtracted, shouldKeepTranscriptPreviewTabProbeExtracted, stopTranscriptPreviewIdentityWatchExtracted, tryMountProjectScopedPreviewExtracted, tryMountVerifiedTranscriptPreviewExtracted, verifyMountedTranscriptPreviewIdentityExtracted } from './mobile-projects-transcript-surfaces-ui-timeline';
import { annotateEmptyPreviewWhenNotRunnableExtracted, cancelPreviewAgentTurnExtracted, ensureTranscriptFilesTabExtracted, ensureTranscriptPreviewServingExtracted, mountTranscriptEmptyPreviewExtracted, recoverTranscriptPreviewUrlExtracted, resolveProjectScopedWorkspaceKeyExtracted, resolveRunnableTranscriptProjectRootExtracted, resolveTranscriptProjectCwdExtracted, resolveTranscriptWorkspaceKeyExtracted, revealTranscriptFileExtracted, revealTranscriptReviewFileExtracted } from './mobile-projects-transcript-surfaces-ui-tool-pills';

export type TranscriptTab = ExecutionSurfaceTabId;

export interface TranscriptTerminalSliderState {
    surfaces: TranscriptTerminalSurface[];
    activeIndex: number;
    suppressAutoCreate?: boolean;
}

export interface ConversationPreviewRuntimeState {
    mountedUrl?: string;
    probeReadyUrl?: string;
    lastSyncedUrl?: string;
}

/**
 * Cadence of the mounted-identity supersession watch. Chained dev runs (retry, second tab,
 * backend restart) retire the claim the iframe is mounted on; nothing else probes once mounted,
 * so without this watch the surface shows the proxy's 403 page until a full reload.
 */
export const TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS = 8_000;

/** Panel surface for Plan, Changes, Preview, Files, and Terminal execution tabs. */
export interface MobileProjectsTranscriptSurfacesHost {
    transcriptSheet: HTMLElement | undefined;
    agentsHubShellActive: boolean;
    transcriptPreviewHost: HTMLElement | undefined;
    transcriptFilesHost: HTMLElement | undefined;
    transcriptTerminalHost: HTMLElement | undefined;
    transcriptReviewHost: HTMLElement | undefined;
    transcriptReviewDiffHost: HTMLElement | undefined;
    transcriptReviewChecksHost: HTMLElement | undefined;
    transcriptHeaderSubtitle: HTMLElement | undefined;
    transcriptOpenSummaryId: string | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptEmbeddedPreview: EmbeddedAgentPreviewChrome | undefined;
    transcriptPreviewRequestRunning: boolean;
    transcriptPreviewRequestPending: boolean;
    transcriptPreviewSuppressedByUser: boolean;
    readonly transcriptPreviewRecoveryRequests: Set<string>;
    transcriptHistoryPanelOpen: boolean;
    transcriptHistoryPanelHeightPx: number | undefined;
    transcriptHistoryRoot: string | undefined;
    transcriptHistoryLoading: boolean;
    transcriptFilesAttachedKey: TranscriptWorkspaceSurfaceKey | undefined;
    readonly transcriptWorkspaceSurfaces: TranscriptWorkspaceSurfacesCache;
    readonly transcriptTerminalSlidesByWorkspace: Map<TranscriptWorkspaceSurfaceKey, TranscriptTerminalSliderState>;
    transcriptTerminalToolbar: HTMLElement | undefined;
    transcriptTerminalSlider: HTMLElement | undefined;
    transcriptTerminalDots: HTMLElement | undefined;
    transcriptTerminalPinnedMode: string | undefined;
    transcriptTerminalResizeObserver: ResizeObserver | undefined;
    transcriptComposerModeId: string | undefined;
    transcriptComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    transcriptScheduleRefresh: (() => void) | undefined;
    projectDetailSurfaceTargets: {
        chatHost: HTMLElement;
        reviewHost: HTMLElement;
        previewHost: HTMLElement;
        filesHost: HTMLElement;
        terminalHost: HTMLElement;
    } | undefined;
    projects: MobileProjectEntry[];
    preparedCwdByProjectId: Map<string, string>;
    projectsService: MobileProjectsService;
    diffReviewWidget: QaapDiffReviewWidget | undefined;
    createDiffReviewWidget: (() => Promise<QaapDiffReviewWidget>) | undefined;
    createTranscriptFilesViewServices: (() => TranscriptFilesViewServices | undefined) | undefined;
    createTranscriptTerminalViewServices: (() => TranscriptTerminalViewServices | undefined) | undefined;
    messageService: MessageService | undefined;
    previewClipboard: ClipboardService;
    previewSurfaceRegistry: QaapPreviewSurfaceRegistry | undefined;
    previewInspectorDeps: QaapPreviewInspectorDeps | undefined;
    transcriptMessagesUi: MobileProjectsTranscriptMessagesUi;
    transcriptComposerUi: MobileProjectsTranscriptComposerUi;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerDraft: string;
    verifyChecksLoading: boolean;
    verifyRunning: boolean;
    verifyResults: MobileProjectsTranscriptVerifyHost['verifyResults'];
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;
    headerPreviewRunHost: HTMLElement;
    headerFilesMoreHost: HTMLElement;
    headerViewModeSwitchHost: HTMLElement;
    root: HTMLElement;

    renderChecksSection(
        host: HTMLElement | undefined,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        options?: { readonly embedded?: boolean },
    ): void;
    attachDiffReviewWidget(host: HTMLElement): void;
    detachDiffReviewWidgetFromHost(): void;
    selectTranscriptTab(tab: TranscriptTab, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    submitTranscriptViaBackendConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        message: string,
        options: {
            selectedAgentId?: string;
            modeId?: string;
            approvalPolicyId?: QaapAgentApprovalPolicyId;
        },
    ): Promise<void>;
    resolveTranscriptComposerPinnedAgentId(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string | undefined;
    refreshTranscriptChecksViews(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    setAutoVerifyEnabled(cwd: string | undefined, on: boolean): void;
    onResumePreview?(project: MobileProjectEntry): void | Promise<void>;
    projectBootstrap?: QaapProjectBootstrapService;
    resolveAnnotationComposerSession(): AnnotationComposerSessionControls | undefined;
    /** Same cancel path as the sticky-composer Stop control. */
    onCancelConversation?(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    cancelOpenTranscriptStream?(): void;
    transcriptComposerSendRefresh?: (() => void) | undefined;
}

/** Execution-surface tab content: plan, review, preview, files, and terminal. */
export class MobileProjectsTranscriptSurfacesUi {
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public readonly transcriptPreviewEnsureRequests = new Set<string>();
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public transcriptPreviewProbeTimer: number | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public transcriptPreviewIdentityWatchTimer: number | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public readonly previewRuntimeByConversationId = new Map<string, ConversationPreviewRuntimeState>();
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public readonly embeddedPreviewByConversationScopeId = new Map<string, EmbeddedAgentPreviewChrome>();
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public offscreenPreviewHostElement: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public transcriptPreviewProjectId: string | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public transcriptPreviewConversationScopeId: string | undefined;
    /** Bumped on Stop / new Play so in-flight ensureTranscriptDevPreview callbacks are ignored. */
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public previewLaunchGeneration = 0;
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public transcriptPreviewAppPicker: HTMLElement | undefined;
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public transcriptPreviewAppPickerCancel: (() => void) | undefined;

    constructor(
        /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
        public readonly host: MobileProjectsTranscriptSurfacesHost,
        /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
        public readonly transcriptHistoryUi: MobileProjectsTranscriptHistoryUi,
    ) { }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public previewScopeId(summary?: Pick<QaapAgentConversationSummaryDTO, 'id'>): string {
        return normalizeQaapPreviewConversationId(summary?.id ?? this.host.transcriptOpenSummaryId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public pickTranscriptPreviewApp(apps: readonly QaapMonorepoAppCandidate[],): Promise<QaapMonorepoAppCandidate | undefined> {
        return pickTranscriptPreviewAppExtracted(this, apps);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public closeTranscriptPreviewAppPicker(): void {
        closeTranscriptPreviewAppPickerExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public previewRuntimeFor(conversationScopeId: string): ConversationPreviewRuntimeState {
        return previewRuntimeForExtracted(this, conversationScopeId);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public mountedPreviewUrl(conversationScopeId: string): string | undefined {
        return this.previewRuntimeFor(conversationScopeId).mountedUrl;
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public setMountedPreviewUrl(conversationScopeId: string, url: string | undefined): void {
        setMountedPreviewUrlExtracted(this, conversationScopeId, url);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public probeReadyPreviewUrl(conversationScopeId: string): string | undefined {
        return this.previewRuntimeFor(conversationScopeId).probeReadyUrl;
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public setProbeReadyPreviewUrl(conversationScopeId: string, url: string | undefined): void {
        setProbeReadyPreviewUrlExtracted(this, conversationScopeId, url);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public lastSyncedPreviewUrl(conversationScopeId: string): string | undefined {
        return this.previewRuntimeFor(conversationScopeId).lastSyncedUrl;
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public setLastSyncedPreviewUrl(conversationScopeId: string, url: string | undefined): void {
        setLastSyncedPreviewUrlExtracted(this, conversationScopeId, url);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public clearPreviewRuntimeForConversation(conversationScopeId: string): void {
        this.previewRuntimeByConversationId.delete(conversationScopeId);
    }

    /** Hub expanded a different project card — tear down the shared iframe chrome. */
    onHubProjectExpanded(project: MobileProjectEntry): void {
        this.ensurePreviewProjectContext(project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public matchesActivePreviewSummary(summary: QaapAgentConversationSummaryDTO): boolean {
        return matchesActivePreviewSummaryExtracted(this, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public pathsEqual(left: string | undefined, right: string | undefined): boolean {
        return pathsEqualHelper(left, right);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public bootstrapAppliesToProject(project: MobileProjectEntry): boolean {
        return bootstrapAppliesToProjectExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public bootstrapPreviewUrlForProject(project: MobileProjectEntry): string | undefined {
        return bootstrapPreviewUrlForProjectExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public ensurePreviewProjectContext(project: MobileProjectEntry): void {
        ensurePreviewProjectContextExtracted(this, project);
    }

    mountProjectDetailSurfaceTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, tab: TranscriptTab,): void {
        mountProjectDetailSurfaceTabExtracted(this, project, summary, tab);
    }

    executionSurfaceHost(transcriptHost: HTMLElement | undefined, projectDetailHost: HTMLElement | undefined,): HTMLElement | undefined {
        return executionSurfaceHostExtracted(this, transcriptHost, projectDetailHost);
    }

    executionPreviewHost(): HTMLElement | undefined {
        return executionPreviewHostExtracted(this);
    }

    executionFilesHost(): HTMLElement | undefined {
        return executionFilesHostExtracted(this);
    }

    executionTerminalHost(): HTMLElement | undefined {
        return executionTerminalHostExtracted(this);
    }

    transcriptConversationMeta(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): string {
        return transcriptConversationMetaExtracted(this, project, summary);
    }

    updateTranscriptHeader(project: MobileProjectEntry, summary = this.host.transcriptOpenSummary,): void {
        updateTranscriptHeaderExtracted(this, project, summary);
    }

    async mountTranscriptReviewWidget(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return mountTranscriptReviewWidgetExtracted(this, project, summary);
    }

    async submitTranscriptReviewFeedback(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, message: string,): Promise<void> {
        return submitTranscriptReviewFeedbackExtracted(this, project, summary, message);
    }

    detachTranscriptReviewWidget(): void {
        detachTranscriptReviewWidgetExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public getOrCreateOffscreenPreviewHost(): HTMLElement {
        return getOrCreateOffscreenPreviewHostExtracted(this);
    }

    disposeTranscriptEmbeddedPreview(conversationScopeId?: string): void {
        disposeTranscriptEmbeddedPreviewExtracted(this, conversationScopeId);
    }

    disposePreviewForConversation(summary: Pick<QaapAgentConversationSummaryDTO, 'id'>): void {
        disposePreviewForConversationExtracted(this, summary);
    }

    disposeTranscriptTerminalSlidesForConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        disposeTranscriptTerminalSlidesForConversationExtracted(this, project, summary);
    }

    suspendTranscriptPreviewIframe(): void {
        suspendTranscriptPreviewIframeExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public clearTranscriptEmptyPreviewChrome(): void {
        clearTranscriptEmptyPreviewChromeExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public getTranscriptEmbeddedPreviewUrl(): string | undefined {
        return getTranscriptEmbeddedPreviewUrlExtracted(this);
    }

    mountTranscriptEmbeddedPreview(host: HTMLElement, previewUrl: string, project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO,): void {
        mountTranscriptEmbeddedPreviewExtracted(this, host, previewUrl, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public wireTranscriptPreviewAnnotationScope(project: MobileProjectEntry, previewUrl: string): void {
        wireTranscriptPreviewAnnotationScopeExtracted(this, project, previewUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public resolvePreviewAnnotationScope(project: MobileProjectEntry, previewUrl: string): {
        previewId: string;
        workspaceId: string;
        threadId: string;
        previewUrl: string;
        route: string;
        viewportMode: 'desktop' | 'mobile';
        viewportWidth: number;
        viewportHeight: number;
    } {
        return resolvePreviewAnnotationScopeExtracted(this, project, previewUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public resolveTranscriptPreviewIdentity(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO | undefined,): QaapPreviewIdentity {
        return resolveTranscriptPreviewIdentityExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async claimTranscriptPreviewExecution(_project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, port: number, fallbackUrl: string,): Promise<string | undefined> {
        return claimTranscriptPreviewExecutionExtracted(this, _project, summary, port, fallbackUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async tryMountVerifiedTranscriptPreview(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, latestProject: MobileProjectEntry, candidateUrl: string,): Promise<void> {
        return tryMountVerifiedTranscriptPreviewExtracted(this, host, project, summary, latestProject, candidateUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public shouldKeepTranscriptPreviewTabProbe(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO,): boolean {
        return shouldKeepTranscriptPreviewTabProbeExtracted(this, project, summary, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async discoverAndMountTranscriptPreviewIfReady(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return discoverAndMountTranscriptPreviewIfReadyExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async fetchCurrentProjectClaimUrl(project: MobileProjectEntry): Promise<string | undefined> {
        return fetchCurrentProjectClaimUrlExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async reconcileSupersededProjectPreviewUrl(project: MobileProjectEntry, staleUrl: string,): Promise<string | undefined> {
        return reconcileSupersededProjectPreviewUrlExtracted(this, project, staleUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public adoptReconciledProjectPreviewUrl(project: MobileProjectEntry, previewUrl: string): MobileProjectEntry {
        return adoptReconciledProjectPreviewUrlExtracted(this, project, previewUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public stopTranscriptPreviewIdentityWatch(): void {
        stopTranscriptPreviewIdentityWatchExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public scheduleTranscriptPreviewIdentityWatch(project: MobileProjectEntry): void {
        scheduleTranscriptPreviewIdentityWatchExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async verifyMountedTranscriptPreviewIdentity(project: MobileProjectEntry): Promise<void> {
        return verifyMountedTranscriptPreviewIdentityExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public clearMismatchedProjectPreviewUrl(project: MobileProjectEntry, _previewUrl: string,): MobileProjectEntry {
        return clearMismatchedProjectPreviewUrlExtracted(this, project, _previewUrl);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async tryMountProjectScopedPreview(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, latestProject: MobileProjectEntry, candidateUrl: string,): Promise<void> {
        return tryMountProjectScopedPreviewExtracted(this, host, project, summary, latestProject, candidateUrl);
    }

    renderPreviewTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        renderPreviewTabExtracted(this, project, summary);
    }

    stopTranscriptPreviewTabProbe(): void {
        stopTranscriptPreviewTabProbeExtracted(this);
    }

    scheduleTranscriptPreviewTabProbe(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,): void {
        scheduleTranscriptPreviewTabProbeExtracted(this, project, summary, conv);
    }

    async refreshTranscriptPreviewTabProbe(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return refreshTranscriptPreviewTabProbeExtracted(this, project, summary);
    }

    updateTranscriptPreviewReadyOverlay(previewUrl: string): void {
        updateTranscriptPreviewReadyOverlayExtracted(this, previewUrl);
    }

    isTranscriptPreviewWaiting(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv, project: MobileProjectEntry | undefined = this.host.transcriptOpenProject,): boolean {
        return isTranscriptPreviewWaitingExtracted(this, conv, project);
    }

    syncHeaderPreviewRunButton(project: MobileProjectEntry | undefined = this.host.transcriptOpenProject, summary: QaapAgentConversationSummaryDTO | undefined = this.host.transcriptOpenSummary, conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,): void {
        syncHeaderPreviewRunButtonExtracted(this, project, summary, conv);
    }

    /** Hide the header play control — only when leaving Preview or tearing down the shell. */
    hideHeaderPreviewRunButton(): void {
        this.host.headerPreviewRunHost.hidden = true;
    }

    syncHeaderFilesMoreButton(project: MobileProjectEntry | undefined = this.host.transcriptOpenProject, summary: QaapAgentConversationSummaryDTO | undefined = this.host.transcriptOpenSummary,): void {
        syncHeaderFilesMoreButtonExtracted(this, project, summary);
    }

    hideHeaderFilesMoreButton(): void {
        hideHeaderFilesMoreButtonExtracted(this);
    }

    syncHeaderViewModeSwitch(project: MobileProjectEntry | undefined = this.host.transcriptOpenProject, summary: QaapAgentConversationSummaryDTO | undefined = this.host.transcriptOpenSummary,): void {
        syncHeaderViewModeSwitchExtracted(this, project, summary);
    }

    hideHeaderViewModeSwitch(): void {
        hideHeaderViewModeSwitchExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public createTranscriptPreviewRunButton(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): HTMLButtonElement {
        return createTranscriptPreviewRunButtonExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public syncHeaderPreviewAppSwitchButton(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        syncHeaderPreviewAppSwitchButtonExtracted(this, host, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async switchTranscriptPreviewApp(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return switchTranscriptPreviewAppExtracted(this, project, summary);
    }

    updateTranscriptPreviewRunButtonState(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        this.syncHeaderPreviewRunButton(this.host.transcriptOpenProject, this.host.transcriptOpenSummary, conv);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public isTranscriptPreviewStoppable(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv, project: MobileProjectEntry | undefined = this.host.transcriptOpenProject,): boolean {
        return isTranscriptPreviewStoppableExtracted(this, conv, project);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public applyTranscriptPreviewRunButtonState(button: HTMLButtonElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,): void {
        applyTranscriptPreviewRunButtonStateExtracted(this, button, project, summary, conv);
    }

    stopTranscriptPreview(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        stopTranscriptPreviewExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public cancelPreviewAgentTurn(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        cancelPreviewAgentTurnExtracted(this, project, summary);
    }

    recoverTranscriptPreviewUrl(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        recoverTranscriptPreviewUrlExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public ensureTranscriptPreviewServing(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, previewUrl: string, options: { readonly allowBootstrap?: boolean } = {},): void {
        ensureTranscriptPreviewServingExtracted(this, project, summary, previewUrl, options);
    }

    /** True while the user is typing in the mounted preview's URL field. */
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public isTranscriptPreviewUrlFieldActive(): boolean {
        const input = this.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mini-browser-url-field input');
        return !!input && input === document.activeElement;
    }

    mountTranscriptEmptyPreview(host: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        mountTranscriptEmptyPreviewExtracted(this, host, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public annotateEmptyPreviewWhenNotRunnable(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        annotateEmptyPreviewWhenNotRunnableExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public resolveRunnableTranscriptProjectRoot(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): string | undefined {
        return resolveRunnableTranscriptProjectRootExtracted(this, project, summary);
    }

    resolveTranscriptProjectCwd(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): string | undefined {
        return resolveTranscriptProjectCwdExtracted(this, project, summary);
    }

    resolveTranscriptWorkspaceKey(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): TranscriptWorkspaceSurfaceKey | undefined {
        return resolveTranscriptWorkspaceKeyExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public resolveProjectScopedWorkspaceKey(project: MobileProjectEntry, resolvedPath: string, conversationId?: string,): TranscriptWorkspaceSurfaceKey {
        return resolveProjectScopedWorkspaceKeyExtracted(this, project, resolvedPath, conversationId);
    }

    ensureTranscriptFilesTab(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        requestedMode?: TranscriptFilesViewMode,
    ): void {
        ensureTranscriptFilesTabExtracted(this, project, summary, requestedMode);
    }

    async revealTranscriptFile(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, filePath: string,): Promise<void> {
        return revealTranscriptFileExtracted(this, project, summary, filePath);
    }

    async revealTranscriptReviewFile(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, filePath: string,): Promise<void> {
        return revealTranscriptReviewFileExtracted(this, project, summary, filePath);
    }

    async ensureTranscriptTerminalTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return ensureTranscriptTerminalTabExtracted(this, project, summary);
    }

    ensureTranscriptTerminalChrome(host: HTMLElement, workspaceKey: TranscriptWorkspaceSurfaceKey, cwd: string, services: TranscriptTerminalViewServices, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        ensureTranscriptTerminalChromeExtracted(this, host, workspaceKey, cwd, services, project, summary);
    }

    async createTranscriptTerminalSlide(workspaceKey: TranscriptWorkspaceSurfaceKey, cwd: string, services: TranscriptTerminalViewServices, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, activateNewest = false,): Promise<void> {
        return createTranscriptTerminalSlideExtracted(this, workspaceKey, cwd, services, project, summary, activateNewest);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async mountFreshTranscriptTerminalSlide(workspaceKey: TranscriptWorkspaceSurfaceKey, cwd: string, services: TranscriptTerminalViewServices, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, activateNewest: boolean,): Promise<void> {
        return mountFreshTranscriptTerminalSlideExtracted(this, workspaceKey, cwd, services, project, summary, activateNewest);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public showTranscriptTerminalError(host: HTMLElement, services: TranscriptTerminalViewServices, error: unknown,): void {
        showTranscriptTerminalErrorExtracted(this, host, services, error);
    }

    async launchAgentTuiInTranscriptTerminal(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, agentId: string, options?: { readonly login?: boolean },): Promise<void> {
        return launchAgentTuiInTranscriptTerminalExtracted(this, project, summary, agentId, options);
    }

    renderTranscriptTerminalSlides(workspaceKey: TranscriptWorkspaceSurfaceKey): void {
        renderTranscriptTerminalSlidesExtracted(this, workspaceKey);
    }

    syncTranscriptTerminalResizeObserver(slider: HTMLElement | undefined, terminal: TerminalWidget | undefined,): void {
        syncTranscriptTerminalResizeObserverExtracted(this, slider, terminal);
    }

    renderTranscriptTerminalDots(workspaceKey: TranscriptWorkspaceSurfaceKey): void {
        renderTranscriptTerminalDotsExtracted(this, workspaceKey);
    }

    resolveTranscriptTerminalTabTitle(surface: TranscriptTerminalSurface, index: number): string {
        return resolveTranscriptTerminalTabTitleHelper(surface, index);
    }

    closeTranscriptTerminalTab(workspaceKey: TranscriptWorkspaceSurfaceKey, index: number): void {
        closeTranscriptTerminalTabExtracted(this, workspaceKey, index);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async restoreTranscriptTerminalSlides(workspaceKey: TranscriptWorkspaceSurfaceKey, cwd: string, services: TranscriptTerminalViewServices,): Promise<void> {
        return restoreTranscriptTerminalSlidesExtracted(this, workspaceKey, cwd, services);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public async persistTranscriptTerminalWorkspace(workspaceKey: TranscriptWorkspaceSurfaceKey): Promise<void> {
        return persistTranscriptTerminalWorkspaceExtracted(this, workspaceKey);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public toPersistedTerminalWorkspace(state: TranscriptTerminalSliderState | undefined,): TranscriptTerminalPersistedWorkspace | undefined {
        return toPersistedTerminalWorkspaceExtracted(this, state);
    }

    detachTranscriptFilesFromHost(): void {
        detachTranscriptFilesFromHostExtracted(this);
    }

    detachTranscriptTerminalFromHost(): void {
        detachTranscriptTerminalFromHostExtracted(this);
    }

    detachTranscriptWorkspaceSurfacesFromSheet(): void {
        this.detachTranscriptFilesFromHost();
        this.detachTranscriptTerminalFromHost();
    }

    disposeTranscriptTerminalSlides(workspaceKey?: TranscriptWorkspaceSurfaceKey): void {
        disposeTranscriptTerminalSlidesExtracted(this, workspaceKey);
    }

    prepareTranscriptTerminalsForPageUnload(): void {
        prepareTranscriptTerminalsForPageUnloadExtracted(this);
    }

    async syncTranscriptPreviewFromConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO,): Promise<void> {
        return syncTranscriptPreviewFromConversationExtracted(this, project, summary, conv);
    }

    async refreshTranscriptPreviewProject(project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO): Promise<MobileProjectEntry> {
        return refreshTranscriptPreviewProjectExtracted(this, project, summary);
    }

    async previewUrlMatchesProject(previewUrl: string, project: MobileProjectEntry): Promise<boolean> {
        return previewUrlMatchesProjectExtracted(this, previewUrl, project);
    }

    async discoverProjectDevPreviewUrl(project: MobileProjectEntry): Promise<string | undefined> {
        return discoverProjectDevPreviewUrlExtracted(this, project);
    }

    beginTranscriptDevPreviewRequest(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        beginTranscriptDevPreviewRequestExtracted(this, project, summary);
    }

    stageTranscriptPreviewReadyUrl(conversationScopeId: string, readyUrl: string): void {
        this.setProbeReadyPreviewUrl(conversationScopeId, readyUrl);
    }

    /** Preview URL of the bootstrap-managed dev server, when it is up for this project. */
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public bootstrapRunningPreviewUrl(project: MobileProjectEntry): string | undefined {
        return this.bootstrapPreviewUrlForProject(project);
    }

    /** True while the bootstrap is installing / starting / serving the dev server. */
    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public isProjectBootstrapPreviewActive(): boolean {
        const phase = this.host.projectBootstrap?.phase;
        return phase === 'installing' || phase === 'starting' || phase === 'running';
    }

    resolveTranscriptPreviewUrl(project: MobileProjectEntry, conv: QaapAgentConversationDTO | undefined,): string | undefined {
        return resolveTranscriptPreviewUrlExtracted(this, project, conv);
    }

    async requestTranscriptPreview(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, options?: { readonly revealPreviewTab?: boolean; readonly deferPreviewTabUntilReady?: boolean; readonly allowAgentFallback?: boolean; },): Promise<void> {
        return requestTranscriptPreviewExtracted(this, project, summary, options);
    }

    /** @internal Used by the extracted mobile-projects-transcript-surfaces-ui-* modules. */
    public adoptReadyTranscriptPreview(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, readyUrl: string,): MobileProjectEntry {
        return adoptReadyTranscriptPreviewExtracted(this, project, summary, readyUrl);
    }
}

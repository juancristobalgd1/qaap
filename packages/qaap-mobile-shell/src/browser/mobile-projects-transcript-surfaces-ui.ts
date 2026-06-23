// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import {
    mountEmbeddedAgentPreviewChrome,
    type EmbeddedAgentPreviewChrome,
} from '@theia/qaap-adapters/lib/browser/qaap-agent-preview-chrome';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapPreviewInspectorDeps } from '@theia/qaap-adapters/lib/browser/qaap-preview-inline-inspector';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId, type QaapAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { resolveTranscriptWorkspaceCwd } from '../common/qaap-transcript-workspace-cwd';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import {
    conversationMayAutoOpenTranscriptPreview,
    conversationShouldWatchDevPreview,
    findTranscriptPreviewUrlFromConversation,
    previewPageTitleMatchesProjectName,
    resolveReadyTranscriptPreviewUrlFromProbe,
} from '../common/qaap-transcript-preview-offer';
import { probeQaapDevPreviewPort, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';
import { ensureTranscriptDevPreview, extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import {
    mountTranscriptFilesView,
    type TranscriptFilesViewServices,
} from './qaap-transcript-files-view';
import {
    createTranscriptTerminalStagingHost,
    createTranscriptTerminalSurface,
    scheduleTranscriptTerminalResize,
    type TranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from './qaap-transcript-terminal-view';
import {
    normalizeTranscriptWorkspaceKey,
    TranscriptWorkspaceSurfacesCache,
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';
import type { MobileProjectsTranscriptHistoryUi } from './mobile-projects-transcript-history-ui';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';

type TranscriptTab = ExecutionSurfaceTabId;

interface TranscriptTerminalSliderState {
    surfaces: TranscriptTerminalSurface[];
    activeIndex: number;
}

interface ProjectPreviewRuntimeState {
    mountedUrl?: string;
    probeReadyUrl?: string;
    lastSyncedUrl?: string;
}

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
    transcriptTerminalResizeObserver: ResizeObserver | undefined;
    transcriptComposerModeId: string | undefined;
    transcriptComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    transcriptScheduleRefresh: (() => void) | undefined;
    projectDetailSurfaceTargets: {
        chatHost: HTMLElement;
        planHost: HTMLElement;
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
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;

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
}

/** Execution-surface tab content: plan, review, preview, files, and terminal. */
export class MobileProjectsTranscriptSurfacesUi {

    protected readonly transcriptPreviewEnsureRequests = new Set<string>();
    protected transcriptPreviewProbeTimer: number | undefined;
    protected readonly previewRuntimeByProjectId = new Map<string, ProjectPreviewRuntimeState>();
    protected transcriptPreviewProjectId: string | undefined;

    constructor(
        protected readonly host: MobileProjectsTranscriptSurfacesHost,
        protected readonly transcriptHistoryUi: MobileProjectsTranscriptHistoryUi,
    ) { }

    protected previewRuntimeFor(projectId: string): ProjectPreviewRuntimeState {
        let state = this.previewRuntimeByProjectId.get(projectId);
        if (!state) {
            state = {};
            this.previewRuntimeByProjectId.set(projectId, state);
        }
        return state;
    }

    protected mountedPreviewUrl(projectId: string): string | undefined {
        return this.previewRuntimeFor(projectId).mountedUrl;
    }

    protected setMountedPreviewUrl(projectId: string, url: string | undefined): void {
        const state = this.previewRuntimeFor(projectId);
        if (url === undefined) {
            delete state.mountedUrl;
        } else {
            state.mountedUrl = url;
        }
    }

    protected probeReadyPreviewUrl(projectId: string): string | undefined {
        return this.previewRuntimeFor(projectId).probeReadyUrl;
    }

    protected setProbeReadyPreviewUrl(projectId: string, url: string | undefined): void {
        const state = this.previewRuntimeFor(projectId);
        if (url === undefined) {
            delete state.probeReadyUrl;
        } else {
            state.probeReadyUrl = normalizePreviewUrlForSameOrigin(url);
        }
    }

    protected lastSyncedPreviewUrl(projectId: string): string | undefined {
        return this.previewRuntimeFor(projectId).lastSyncedUrl;
    }

    protected setLastSyncedPreviewUrl(projectId: string, url: string | undefined): void {
        const state = this.previewRuntimeFor(projectId);
        if (url === undefined) {
            delete state.lastSyncedUrl;
        } else {
            state.lastSyncedUrl = url;
        }
    }

    protected clearPreviewRuntimeForProject(projectId: string): void {
        this.previewRuntimeByProjectId.delete(projectId);
    }

    /** Hub expanded a different project card — tear down the shared iframe chrome. */
    onHubProjectExpanded(project: MobileProjectEntry): void {
        this.ensurePreviewProjectContext(project);
    }

    /** Open transcript, or the Agents hub idle shell when no session is selected yet. */
    protected matchesActivePreviewSummary(summary: QaapAgentConversationSummaryDTO): boolean {
        if (this.host.transcriptOpenSummaryId === summary.id) {
            return true;
        }
        return this.host.agentsHubShellActive
            && !this.host.transcriptOpenSummaryId
            && isAgentsHubIdleConversationSummary(summary);
    }

    protected pathsEqual(left: string | undefined, right: string | undefined): boolean {
        if (!left || !right) {
            return false;
        }
        const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return normalize(left) === normalize(right);
    }

    /** Bootstrap dev server belongs to the workspace root of this hub project card. */
    protected bootstrapAppliesToProject(project: MobileProjectEntry): boolean {
        const bootstrap = this.host.projectBootstrap;
        if (!bootstrap?.descriptor) {
            return project.isCurrent === true;
        }
        const projectCwd = this.host.projectsService.getProjectCwd(project)
            ?? this.host.preparedCwdByProjectId.get(project.id);
        const bootstrapRoot = FileUri.fsPath(bootstrap.descriptor.rootUri);
        if (projectCwd) {
            return this.pathsEqual(projectCwd, bootstrapRoot);
        }
        return project.isCurrent === true;
    }

    protected bootstrapPreviewUrlForProject(project: MobileProjectEntry): string | undefined {
        const bootstrap = this.host.projectBootstrap;
        if (!bootstrap || bootstrap.phase !== 'running' || !bootstrap.previewUrl) {
            return undefined;
        }
        if (!this.bootstrapAppliesToProject(project)) {
            return undefined;
        }
        return normalizePreviewUrlForSameOrigin(bootstrap.previewUrl);
    }

    /** Drop cached iframe state when the user switches hub projects on the Preview tab. */
    protected ensurePreviewProjectContext(project: MobileProjectEntry): void {
        if (this.transcriptPreviewProjectId === project.id) {
            return;
        }
        this.transcriptPreviewProjectId = project.id;
        this.stopTranscriptPreviewTabProbe();
        this.disposeTranscriptEmbeddedPreview();
    }

    mountProjectDetailSurfaceTab(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        tab: TranscriptTab,
    ): void {
        switch (tab) {
            case 'plan':
                this.renderPlanTab(this.host.projectDetailSurfaceTargets?.planHost, undefined);
                break;
            case 'review':
                void this.mountProjectDetailReviewWidget(project);
                break;
            case 'preview':
                this.renderPreviewTab(project, summary);
                break;
            case 'files':
                this.ensureTranscriptFilesTab(project, summary);
                break;
            case 'terminal':
                void this.ensureTranscriptTerminalTab(project, summary);
                break;
            default:
                break;
        }
    }

    async mountProjectDetailReviewWidget(project: MobileProjectEntry): Promise<void> {
        const host = this.host.projectDetailSurfaceTargets?.reviewHost;
        if (!host || !this.host.createDiffReviewWidget) {
            return;
        }
        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            host.replaceChildren();
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-review-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/reviewUnavailable',
                'Review is unavailable for this conversation (no workspace path).',
            );
            host.append(note);
            return;
        }
        host.replaceChildren();
        const diffHost = document.createElement('div');
        diffHost.className = 'theia-mobile-transcript-review-diff-host';
        host.append(diffHost);
        const rootUri = project.uri?.toString() ?? `file://${cwd}`;
        if (!this.host.diffReviewWidget) {
            this.host.diffReviewWidget = await this.host.createDiffReviewWidget();
        }
        if (!host.isConnected) {
            return;
        }
        this.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
        this.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
        this.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async () => { /* project-level — use composer below */ });
        this.host.attachDiffReviewWidget(diffHost);
        this.host.diffReviewWidget.setRepositoryContext({
            rootUri,
            rootFsPath: cwd,
            isActiveWorkspace: project.isCurrent,
        });
    }

    /** Prefer transcript sheet hosts while the modal is open — project detail may still exist underneath. */
    executionSurfaceHost(
        transcriptHost: HTMLElement | undefined,
        projectDetailHost: HTMLElement | undefined,
    ): HTMLElement | undefined {
        if ((this.host.transcriptSheet || this.host.agentsHubShellActive) && transcriptHost) {
            return transcriptHost;
        }
        return projectDetailHost ?? transcriptHost;
    }

    executionPreviewHost(): HTMLElement | undefined {
        return this.executionSurfaceHost(
            this.host.transcriptPreviewHost,
            this.host.projectDetailSurfaceTargets?.previewHost,
        );
    }

    executionFilesHost(): HTMLElement | undefined {
        return this.executionSurfaceHost(
            this.host.transcriptFilesHost,
            this.host.projectDetailSurfaceTargets?.filesHost,
        );
    }

    executionTerminalHost(): HTMLElement | undefined {
        return this.executionSurfaceHost(
            this.host.transcriptTerminalHost,
            this.host.projectDetailSurfaceTargets?.terminalHost,
        );
    }

    renderPlanTab(host: HTMLElement | undefined, conv: QaapAgentConversationDTO | undefined): void {
        if (!host) {
            return;
        }
        host.replaceChildren();
        const segments = this.latestAgentSegments(conv);
        if (!segments || segments.length === 0) {
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-plan-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/planEmpty',
                'Plan appears here as soon as the agent starts thinking or using tools.',
            );
            host.append(note);
            return;
        }

        const items = this.host.transcriptMessagesUi.resolveTranscriptActivityItems(segments);
        if (items.length === 0) {
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-plan-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/planNoActivity',
                'No structured activity has been reported for this turn yet.',
            );
            host.append(note);
            return;
        }

        const done = items.filter(item => item.state === 'success').length;
        const ratio = Math.max(0, Math.min(1, done / Math.max(items.length, 1)));
        const head = document.createElement('div');
        head.className = 'theia-mobile-transcript-plan-head';
        const label = document.createElement('span');
        label.className = 'theia-mobile-transcript-plan-label';
        label.textContent = nls.localize('qaap/mobileProjects/planLabel', 'Execution plan');
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-transcript-review-checks-stat';
        stat.textContent = nls.localize(
            'qaap/mobileProjects/planProgress',
            '{0}/{1}',
            String(done),
            String(items.length),
        );
        head.append(label, stat);

        const progress = document.createElement('div');
        progress.className = 'theia-mobile-transcript-plan-prog';
        const bar = document.createElement('i');
        bar.style.width = `${Math.round(ratio * 100)}%`;
        progress.append(bar);

        const timeline = this.host.transcriptMessagesUi.createTranscriptActivityTimeline(segments, {
            variant: 'plan',
            maxVisibleItems: 0,
        });
        if (timeline) {
            timeline.classList.add('theia-mobile-transcript-plan-trace');
        }

        host.append(head, progress);
        if (timeline) {
            host.append(timeline);
        }
    }

    latestAgentSegments(conv: QaapAgentConversationDTO | undefined): QaapAgentMessageSegmentDTO[] | undefined {
        if (!conv) {
            return undefined;
        }
        for (let i = conv.messages.length - 1; i >= 0; i--) {
            const msg = conv.messages[i];
            if (msg.role !== 'agent') {
                continue;
            }
            const segments = this.host.transcriptMessagesUi.resolveTranscriptAgentSegments(conv, msg);
            if (segments && segments.length > 0) {
                return segments;
            }
        }
        return undefined;
    }

    transcriptConversationMeta(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string {
        const agentLabel = summary.agentId ? `@${summary.agentId.replace(/^@/, '')}` : '';
        return agentLabel ? `${project.name} · ${agentLabel}` : project.name;
    }

    updateTranscriptHeader(
        project: MobileProjectEntry,
        summary = this.host.transcriptOpenSummary,
    ): void {
        const titleEl = this.host.transcriptSheet?.querySelector('.theia-mobile-agent-log-header h2');
        const subtitle = this.host.transcriptHeaderSubtitle;
        if (!titleEl || !subtitle) {
            return;
        }
        titleEl.textContent = summary
            ? this.host.transcriptHeaderUi.resolveTranscriptHeaderTitle(project, summary)
            : project.name;
        subtitle.hidden = false;
        this.host.transcriptHeaderUi.renderActiveChatHeaderSubtitle(subtitle, project, summary);
    }

    async mountTranscriptReviewWidget(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const host = this.host.transcriptReviewHost;
        if (!host || !this.host.createDiffReviewWidget) {
            return;
        }
        const cwd = summary.cwd ?? this.host.projectsService.getProjectCwd(project);
        if (!cwd) {
            host.replaceChildren();
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-review-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/reviewUnavailable',
                'Review is unavailable for this conversation (no workspace path).',
            );
            host.append(note);
            return;
        }
        host.replaceChildren();
        const diffHost = document.createElement('div');
        diffHost.className = 'theia-mobile-transcript-review-diff-host';
        const historyResizeHandle = document.createElement('div');
        historyResizeHandle.className = 'theia-mobile-transcript-history-resize';
        historyResizeHandle.setAttribute('role', 'separator');
        historyResizeHandle.setAttribute('aria-orientation', 'horizontal');
        historyResizeHandle.setAttribute('aria-label', nls.localize('qaap/mobileProjects/historyResizePanel', 'Resize history panel'));
        historyResizeHandle.hidden = !this.host.transcriptHistoryPanelOpen;
        const historyPanel = document.createElement('div');
        historyPanel.className = 'theia-mobile-transcript-history-panel';
        historyPanel.hidden = !this.host.transcriptHistoryPanelOpen;
        if (this.host.transcriptHistoryPanelHeightPx !== undefined) {
            historyPanel.style.setProperty('--qaap-transcript-history-height', `${this.host.transcriptHistoryPanelHeightPx}px`);
        }
        const dock = document.createElement('div');
        dock.className = 'theia-mobile-transcript-changes-dock';
        const dockControls = document.createElement('div');
        dockControls.className = 'theia-mobile-transcript-changes-controls';
        const checksHost = document.createElement('div');
        checksHost.className = 'theia-mobile-transcript-review-checks';
        const historyToggleHost = document.createElement('div');
        historyToggleHost.className = 'theia-mobile-transcript-history-toggle-host';
        dockControls.append(checksHost, historyToggleHost);
        dock.append(dockControls);
        host.append(diffHost, historyResizeHandle, historyPanel, dock);
        this.host.transcriptReviewDiffHost = diffHost;
        this.host.transcriptReviewChecksHost = checksHost;
        this.host.transcriptHistoryRoot = cwd;
        this.transcriptHistoryUi.installTranscriptHistoryResize(historyResizeHandle, historyPanel);

        const rootUri = project.uri?.toString() ?? `file://${cwd}`;
        if (!this.host.diffReviewWidget) {
            this.host.diffReviewWidget = await this.host.createDiffReviewWidget();
        }
        if (this.host.transcriptReviewHost !== host || !diffHost.isConnected) {
            return;
        }
        this.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
        this.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
        this.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async message => {
            await this.submitTranscriptReviewFeedback(project, summary, message);
        });
        this.host.attachDiffReviewWidget(diffHost);
        this.host.diffReviewWidget.setRepositoryContext({
            rootUri,
            rootFsPath: cwd,
            isActiveWorkspace: project.isCurrent,
        });
        this.host.renderChecksSection(checksHost, project, summary, { embedded: true });
        this.transcriptHistoryUi.renderTranscriptHistoryToggle(historyToggleHost, historyPanel, historyResizeHandle, cwd);
        this.transcriptHistoryUi.renderTranscriptHistoryPanel(historyPanel, cwd);
    }

    async submitTranscriptReviewFeedback(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        message: string,
    ): Promise<void> {
        const chatHost = this.host.transcriptChatHost;
        if (!chatHost) {
            return;
        }
        try {
            await this.host.submitTranscriptViaBackendConversation(project, summary, message, {
                selectedAgentId: this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                modeId: this.host.transcriptComposerModeId,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    this.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
            });
            this.host.executionSurfaceTabsUi.selectTranscriptTab('messages', project, summary);
        } catch (error) {
            this.host.messageService?.error(error instanceof Error ? error.message : String(error));
        }
    }

    detachTranscriptReviewWidget(): void {
        if (!this.host.diffReviewWidget?.isAttached || !this.host.transcriptReviewDiffHost) {
            return;
        }
        if (this.host.transcriptReviewDiffHost.contains(this.host.diffReviewWidget.node)) {
            this.host.detachDiffReviewWidgetFromHost();
            this.host.diffReviewWidget.node.classList.remove('theia-mobile-transcript-diff-embed');
            this.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(undefined);
            this.host.diffReviewWidget.setReviewStatsChangeHandler(undefined);
        }
        this.host.transcriptReviewDiffHost = undefined;
        this.host.transcriptReviewChecksHost = undefined;
        this.host.transcriptHistoryRoot = undefined;
        this.host.transcriptHistoryLoading = false;
    }

    disposeTranscriptEmbeddedPreview(): void {
        this.host.transcriptEmbeddedPreview?.dispose();
        this.host.transcriptEmbeddedPreview = undefined;
        if (this.transcriptPreviewProjectId) {
            this.setMountedPreviewUrl(this.transcriptPreviewProjectId, undefined);
        }
    }

    /**
     * Tear down the preview iframe when another execution tab is active so embedded
     * dev servers (e.g. Vite HMR) stop running in a hidden `display:none` host.
     * Keeps the last preview URL staged for a fast remount when Preview is opened again.
     */
    suspendTranscriptPreviewIframe(): void {
        const chrome = this.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return;
        }
        const projectId = this.transcriptPreviewProjectId;
        const isEmptyPlaceholder = chrome.root.classList.contains('theia-mod-empty-preview');
        const stagedUrl = (projectId ? this.mountedPreviewUrl(projectId) : undefined)
            ?? this.getTranscriptEmbeddedPreviewUrl();
        chrome.dispose();
        this.host.transcriptEmbeddedPreview = undefined;
        this.executionPreviewHost()?.replaceChildren();
        if (!projectId) {
            return;
        }
        if (isEmptyPlaceholder) {
            this.setMountedPreviewUrl(projectId, undefined);
            return;
        }
        if (stagedUrl) {
            this.setProbeReadyPreviewUrl(projectId, stagedUrl);
        }
    }

    protected clearTranscriptEmptyPreviewChrome(): void {
        const root = this.host.transcriptEmbeddedPreview?.root;
        if (!root?.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        root.classList.remove('theia-mod-empty-preview');
        root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
    }

    protected getTranscriptEmbeddedPreviewUrl(): string | undefined {
        const chrome = this.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return undefined;
        }
        const input = chrome.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
        const raw = input?.value?.trim();
        return raw ? normalizePreviewUrlForSameOrigin(raw) : undefined;
    }

    mountTranscriptEmbeddedPreview(host: HTMLElement, previewUrl: string, project: MobileProjectEntry): void {
        const normalized = normalizePreviewUrlForSameOrigin(previewUrl);
        this.transcriptPreviewProjectId = project.id;
        if (this.host.transcriptEmbeddedPreview) {
            this.clearTranscriptEmptyPreviewChrome();
            const root = this.host.transcriptEmbeddedPreview.root;
            const current = this.getTranscriptEmbeddedPreviewUrl();
            if (current === normalized
                && this.transcriptPreviewProjectId === project.id
                && root.isConnected
                && host.contains(root)
                && !root.classList.contains('theia-mod-empty-preview')) {
                this.setMountedPreviewUrl(project.id, normalized);
                return;
            }
            this.host.transcriptEmbeddedPreview.setUrl(normalized);
            this.setMountedPreviewUrl(project.id, normalized);
            if (!host.contains(root)) {
                host.append(root);
            }
            return;
        }
        this.host.transcriptEmbeddedPreview = mountEmbeddedAgentPreviewChrome(host, {
            url: normalized,
            messageService: this.host.messageService,
            clipboard: this.host.previewClipboard,
            previewSurfaces: this.host.previewSurfaceRegistry,
            inspectorDeps: this.host.previewInspectorDeps,
            notify: (message, kind) => {
                MobileSnackbar.show(message, { kind: kind === 'warn' ? 'warning' : 'success' });
            },
            openExternal: target => {
                window.open(target, '_blank', 'noopener,noreferrer');
            },
        });
        this.setMountedPreviewUrl(project.id, normalized);
    }

    protected async tryMountVerifiedTranscriptPreview(
        host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        latestProject: MobileProjectEntry,
        candidateUrl: string,
    ): Promise<void> {
        const port = extractDevPreviewPortFromUrl(candidateUrl);
        if (port === undefined) {
            if (!this.matchesActivePreviewSummary(summary) || !host.isConnected) {
                return;
            }
            this.mountTranscriptEmbeddedPreview(host, candidateUrl, latestProject);
            return;
        }
        const probe = await probeQaapDevPreviewPort(port);
        if (!this.matchesActivePreviewSummary(summary)
            || !host.isConnected
            || this.transcriptPreviewProjectId !== project.id) {
            return;
        }
        if (!probe.ready) {
            const conv = this.host.transcriptLastConv;
            const canKeepEmptyPreview = this.host.transcriptEmbeddedPreview?.root.isConnected === true
                && host.contains(this.host.transcriptEmbeddedPreview.root)
                && this.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview');
            if (!canKeepEmptyPreview) {
                this.disposeTranscriptEmbeddedPreview();
                host.replaceChildren();
                this.mountTranscriptEmptyPreview(host, project, summary);
            } else {
                this.updateTranscriptPreviewRunButtonState(conv);
            }
            this.scheduleTranscriptPreviewTabProbe(project, summary, conv);
            return;
        }

        this.stopTranscriptPreviewTabProbe();
        const readyUrl = normalizePreviewUrlForSameOrigin(probe.previewUrl);
        if (!await this.previewUrlMatchesProject(readyUrl, latestProject)) {
            const cleared = this.clearMismatchedProjectPreviewUrl(latestProject, readyUrl);
            if (this.transcriptPreviewProjectId === project.id && host.isConnected) {
                this.disposeTranscriptEmbeddedPreview();
                host.replaceChildren();
                this.mountTranscriptEmptyPreview(host, cleared, summary);
                void this.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
            }
            return;
        }
        if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            this.stageTranscriptPreviewReadyUrl(project.id, readyUrl);
            if (latestProject.previewUrl !== readyUrl) {
                const updatedProject = { ...latestProject, previewUrl: readyUrl };
                this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
                    ? updatedProject
                    : candidate);
                if (this.host.transcriptOpenProject?.id === updatedProject.id) {
                    this.host.transcriptOpenProject = updatedProject;
                }
                void this.host.projectsService.recordProjectPreviewUrl(updatedProject, readyUrl).catch(() => undefined);
            }
            return;
        }
        if (this.mountedPreviewUrl(project.id) === readyUrl
            && this.transcriptPreviewProjectId === project.id
            && this.host.transcriptEmbeddedPreview?.root.isConnected === true
            && host.contains(this.host.transcriptEmbeddedPreview.root)
            && !this.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview')) {
            return;
        }

        this.setMountedPreviewUrl(project.id, readyUrl);
        this.setProbeReadyPreviewUrl(project.id, readyUrl);
        const allowBootstrap = this.host.transcriptPreviewRequestPending;
        this.host.transcriptPreviewRequestPending = false;
        this.host.transcriptPreviewRequestRunning = false;
        if (allowBootstrap) {
            void this.ensureTranscriptPreviewServing(project, summary, readyUrl, { allowBootstrap: true });
        }
        if (latestProject.previewUrl !== readyUrl) {
            const updatedProject = { ...latestProject, previewUrl: readyUrl };
            this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
                ? updatedProject
                : candidate);
            if (this.host.transcriptOpenProject?.id === updatedProject.id) {
                this.host.transcriptOpenProject = updatedProject;
            }
            void this.host.projectsService.recordProjectPreviewUrl(updatedProject, readyUrl).catch(() => undefined);
        }
        const hadEmptyPreview = this.host.transcriptEmbeddedPreview?.root.classList.contains('theia-mod-empty-preview') === true;
        if (hadEmptyPreview
            || !this.host.transcriptEmbeddedPreview?.root.isConnected
            || !host.contains(this.host.transcriptEmbeddedPreview.root)) {
            this.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
        }
        this.mountTranscriptEmbeddedPreview(host, readyUrl, latestProject);
    }

    protected shouldKeepTranscriptPreviewTabProbe(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,
    ): boolean {
        if (!this.matchesActivePreviewSummary(summary)) {
            return false;
        }
        if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview'
            && this.isTranscriptPreviewWaiting(conv, project)) {
            return true;
        }
        return conv.status === 'streaming'
            && (conversationShouldWatchDevPreview(conv, window.location.origin)
                || this.host.transcriptPreviewRequestPending);
    }

    protected async discoverAndMountTranscriptPreviewIfReady(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const conv = this.host.transcriptLastConv;
        const host = this.executionPreviewHost();
        if (!conv || !host?.isConnected || !this.matchesActivePreviewSummary(summary)) {
            return;
        }
        if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            return;
        }
        if (!this.isTranscriptPreviewWaiting(conv, project)) {
            return;
        }
        const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const existing = this.resolveTranscriptPreviewUrl(latestProject, conv);
        if (existing) {
            void this.tryMountProjectScopedPreview(host, project, summary, latestProject, existing);
            return;
        }
        const bootstrapUrl = this.host.projectBootstrap?.phase === 'running'
            ? this.bootstrapPreviewUrlForProject(latestProject)
            : undefined;
        if (bootstrapUrl) {
            void this.tryMountProjectScopedPreview(
                host,
                project,
                summary,
                latestProject,
                normalizePreviewUrlForSameOrigin(bootstrapUrl),
            );
            return;
        }
        const discovered = await this.discoverProjectDevPreviewUrl(latestProject);
        if (!discovered || !host.isConnected || !this.matchesActivePreviewSummary(summary)) {
            return;
        }
        const updatedProject = { ...latestProject, previewUrl: discovered };
        this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
            ? updatedProject
            : candidate);
        void this.tryMountProjectScopedPreview(host, project, summary, updatedProject, discovered);
    }

    protected clearMismatchedProjectPreviewUrl(
        project: MobileProjectEntry,
        _previewUrl: string,
    ): MobileProjectEntry {
        const cleared = { ...project, previewUrl: undefined };
        this.host.projects = this.host.projects.map(candidate => candidate.id === cleared.id
            ? cleared
            : candidate);
        if (this.host.transcriptOpenProject?.id === cleared.id) {
            this.host.transcriptOpenProject = cleared;
        }
        this.clearPreviewRuntimeForProject(project.id);
        return cleared;
    }

    protected async tryMountProjectScopedPreview(
        host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        latestProject: MobileProjectEntry,
        candidateUrl: string,
    ): Promise<void> {
        if (this.transcriptPreviewProjectId !== project.id || !host.isConnected) {
            return;
        }
        if (!await this.previewUrlMatchesProject(candidateUrl, latestProject)) {
            const cleared = this.clearMismatchedProjectPreviewUrl(latestProject, candidateUrl);
            if (this.transcriptPreviewProjectId !== project.id || !host.isConnected) {
                return;
            }
            this.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
            this.mountTranscriptEmptyPreview(host, cleared, summary);
            void this.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
            return;
        }
        const port = extractDevPreviewPortFromUrl(candidateUrl);
        if (port === undefined) {
            if (this.matchesActivePreviewSummary(summary)) {
                this.mountTranscriptEmbeddedPreview(host, candidateUrl, latestProject);
            }
            return;
        }
        void this.tryMountVerifiedTranscriptPreview(host, project, summary, latestProject, candidateUrl);
    }

    renderPreviewTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        const host = this.executionPreviewHost();
        if (!host) {
            return;
        }
        this.ensurePreviewProjectContext(project);

        const conv = this.host.transcriptLastConv;
        const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const candidateUrl = this.resolveTranscriptPreviewUrl(latestProject, conv);
        if (candidateUrl) {
            void this.tryMountProjectScopedPreview(host, project, summary, latestProject, candidateUrl);
            return;
        }

        void this.refreshTranscriptPreviewProject(latestProject, summary).then(refreshed => {
            if (this.transcriptPreviewProjectId !== project.id || !host.isConnected) {
                return;
            }
            if (this.host.executionSurfaceTabsUi.activeExecutionTab(refreshed) !== 'preview') {
                return;
            }
            const hydratedUrl = this.resolveTranscriptPreviewUrl(refreshed, this.host.transcriptLastConv);
            if (!hydratedUrl) {
                return;
            }
            this.host.projects = this.host.projects.map(candidate => candidate.id === refreshed.id
                ? refreshed
                : candidate);
            this.renderPreviewTab(refreshed, summary);
        });

        this.setMountedPreviewUrl(project.id, undefined);
        this.setLastSyncedPreviewUrl(project.id, undefined);

        const waitingForPreview = this.isTranscriptPreviewWaiting(conv, project);
        if (waitingForPreview) {
            this.recoverTranscriptPreviewUrl(project, summary);
            void this.discoverAndMountTranscriptPreviewIfReady(project, summary);
        }

        const canKeepEmptyPreview = this.host.transcriptEmbeddedPreview?.root.isConnected === true
            && host.contains(this.host.transcriptEmbeddedPreview.root)
            && this.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview');
        if (canKeepEmptyPreview) {
            this.updateTranscriptPreviewRunButtonState(conv);
            const probeReadyUrl = this.probeReadyPreviewUrl(project.id);
            if (probeReadyUrl) {
                this.updateTranscriptPreviewReadyOverlay(probeReadyUrl);
            }
            this.scheduleTranscriptPreviewTabProbe(project, summary);
            return;
        }

        this.disposeTranscriptEmbeddedPreview();
        host.replaceChildren();
        this.mountTranscriptEmptyPreview(host, project, summary);
        this.scheduleTranscriptPreviewTabProbe(project, summary);
    }

    stopTranscriptPreviewTabProbe(): void {
        if (this.transcriptPreviewProbeTimer !== undefined) {
            window.clearTimeout(this.transcriptPreviewProbeTimer);
            this.transcriptPreviewProbeTimer = undefined;
        }
    }

    scheduleTranscriptPreviewTabProbe(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
    ): void {
        this.stopTranscriptPreviewTabProbe();
        if (!conv || !this.shouldKeepTranscriptPreviewTabProbe(project, summary, conv)) {
            return;
        }
        this.transcriptPreviewProbeTimer = window.setTimeout(() => {
            this.transcriptPreviewProbeTimer = undefined;
            void this.refreshTranscriptPreviewTabProbe(project, summary);
        }, 900);
    }

    async refreshTranscriptPreviewTabProbe(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const conv = this.host.transcriptLastConv;
        if (!conv || !this.matchesActivePreviewSummary(summary)) {
            return;
        }
        try {
            const readyUrl = await resolveReadyTranscriptPreviewUrlFromProbe(
                conv,
                port => probeQaapDevPreviewPort(port),
                window.location.origin,
            );
            const normalized = readyUrl ? normalizePreviewUrlForSameOrigin(readyUrl) : undefined;
            if (normalized && await this.previewUrlMatchesProject(normalized, project)) {
                this.setProbeReadyPreviewUrl(project.id, normalized);
                const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
                const updatedProject = { ...latestProject, previewUrl: normalized };
                this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
                    ? updatedProject
                    : candidate);
                this.host.transcriptOpenProject = this.host.transcriptOpenProject?.id === updatedProject.id
                    ? updatedProject
                    : this.host.transcriptOpenProject;
                void this.host.projectsService.recordProjectPreviewUrl(updatedProject, normalized).catch(() => undefined);
                if (!conversationMayAutoOpenTranscriptPreview(conv)) {
                    this.stageTranscriptPreviewReadyUrl(project.id, normalized);
                } else if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
                    const host = this.executionPreviewHost();
                    if (host) {
                        void this.tryMountProjectScopedPreview(host, project, summary, updatedProject, normalized);
                    }
                } else {
                    void this.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(normalized);
                }
            } else if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
                this.updateTranscriptPreviewRunButtonState(conv);
                void this.discoverAndMountTranscriptPreviewIfReady(project, summary);
            }
        } catch {
            /* best-effort */
        } finally {
            if (this.shouldKeepTranscriptPreviewTabProbe(project, summary, conv)) {
                this.scheduleTranscriptPreviewTabProbe(project, summary, conv);
            }
        }
    }

    updateTranscriptPreviewReadyOverlay(previewUrl: string): void {
        const host = this.host.transcriptEmbeddedPreview?.root;
        const overlay = host?.querySelector('.theia-mobile-transcript-preview-empty-overlay');
        if (!overlay || !host?.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        let ready = overlay.querySelector('.theia-mobile-transcript-preview-ready') as HTMLElement | null;
        if (!ready) {
            ready = document.createElement('div');
            ready.className = 'theia-mobile-transcript-preview-ready';
            const title = document.createElement('div');
            title.className = 'theia-mobile-transcript-preview-ready-title';
            title.textContent = nls.localize('qaap/projectBootstrap/previewReady', 'Preview ready');
            const hint = document.createElement('p');
            hint.className = 'theia-mobile-transcript-preview-ready-hint';
            hint.textContent = nls.localize(
                'qaap/mobileProjects/previewReadyHint',
                'The dev server is running. Open it in the in-IDE browser preview.',
            );
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'theia-mobile-transcript-preview-ready-open';
            open.textContent = nls.localize('qaap/mobileProjects/openPreview', 'Open preview');
            open.addEventListener('click', () => {
                void this.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(previewUrl);
            });
            ready.append(title, hint, open);
            overlay.append(ready);
        }
        const openButton = ready.querySelector('.theia-mobile-transcript-preview-ready-open');
        if (openButton instanceof HTMLButtonElement) {
            openButton.onclick = () => {
                void this.host.transcriptMessagesUi.openTranscriptPreviewUrlFromLink(previewUrl);
            };
        }
    }

    isTranscriptPreviewWaiting(
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
        project: MobileProjectEntry | undefined = this.host.transcriptOpenProject,
    ): boolean {
        if (this.host.transcriptPreviewRequestRunning || this.host.transcriptPreviewRequestPending) {
            return true;
        }
        // A bootstrap install/dev run outlives the agent turn; keep waiting (and probing) until
        // its preview is actually mounted instead of falling back to the idle play button.
        if (this.isProjectBootstrapPreviewActive()
            && project
            && !this.mountedPreviewUrl(project.id)) {
            return true;
        }
        return conv?.status === 'streaming'
            && conversationShouldWatchDevPreview(conv, window.location.origin);
    }

    findTranscriptPreviewRunButton(): HTMLButtonElement | undefined {
        const button = this.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mobile-transcript-preview-run');
        return button instanceof HTMLButtonElement ? button : undefined;
    }

    updateTranscriptPreviewRunButtonState(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        const button = this.findTranscriptPreviewRunButton();
        if (!button) {
            return;
        }
        const loading = this.isTranscriptPreviewWaiting(conv);
        button.disabled = loading;
        button.classList.toggle('theia-mod-loading', loading);
        const label = loading
            ? nls.localize('qaap/mobileProjects/previewLoading', 'Cargando...')
            : nls.localize('qaap/mobileProjects/previewButton', 'Vista previa');
        button.title = label;
        button.setAttribute('aria-label', label);
        if (loading) {
            button.setAttribute('aria-busy', 'true');
        } else {
            button.removeAttribute('aria-busy');
        }
    }

    recoverTranscriptPreviewUrl(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        if (this.host.transcriptPreviewRecoveryRequests.has(summary.id)) {
            return;
        }
        this.host.transcriptPreviewRecoveryRequests.add(summary.id);
        void this.refreshTranscriptPreviewProject(project, summary).then(latestProject => {
            const conv = this.host.transcriptLastConv;
            const previewUrl = latestProject.previewUrl ?? this.resolveTranscriptPreviewUrl(latestProject, conv);
            if (previewUrl) {
                void this.ensureTranscriptPreviewServing(latestProject, summary, previewUrl);
            }
            if (!previewUrl || !this.matchesActivePreviewSummary(summary) || this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
                return;
            }
            this.host.projects = this.host.projects.map(candidate => candidate.id === latestProject.id
                ? { ...latestProject, previewUrl }
                : candidate);
            this.renderPreviewTab(latestProject, summary);
        }).finally(() => {
            this.host.transcriptPreviewRecoveryRequests.delete(summary.id);
        });
    }

    protected ensureTranscriptPreviewServing(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        previewUrl: string,
        options: { readonly allowBootstrap?: boolean } = {},
    ): void {
        const bootstrap = this.host.projectBootstrap;
        if (!bootstrap) {
            return;
        }
        const allowBootstrap = options.allowBootstrap === true;
        const requestKey = `${summary.id}:${previewUrl}:${allowBootstrap ? 'bootstrap' : 'wait'}`;
        if (this.transcriptPreviewEnsureRequests.has(requestKey)) {
            return;
        }
        const port = extractDevPreviewPortFromUrl(previewUrl);
        this.transcriptPreviewEnsureRequests.add(requestKey);
        void (async () => {
            if (port !== undefined) {
                const probe = await probeQaapDevPreviewPort(port);
                if (probe.ready) {
                    return;
                }
                if (!allowBootstrap) {
                    await waitForQaapDevPreviewPort(port, {
                        maxAttempts: 60,
                        intervalMs: 500,
                    });
                    return;
                }
            }
            if (!allowBootstrap) {
                return;
            }
            const readyUrl = await ensureTranscriptDevPreview(bootstrap, {
                previewUrlHint: previewUrl,
                portHint: port,
                conversation: this.host.transcriptLastConv?.id === summary.id
                    ? this.host.transcriptLastConv
                    : undefined,
            });
            if (!readyUrl || !this.matchesActivePreviewSummary(summary)) {
                return;
            }
            if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
                return;
            }
            const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
            this.host.projects = this.host.projects.map(candidate => candidate.id === latestProject.id
                ? { ...candidate, previewUrl: readyUrl }
                : candidate);
            void this.host.projectsService.recordProjectPreviewUrl({ ...latestProject, previewUrl: readyUrl }, readyUrl);
            this.host.transcriptPreviewRequestPending = false;
            this.host.transcriptPreviewRequestRunning = false;
            this.renderPreviewTab({ ...latestProject, previewUrl: readyUrl }, summary);
        })().finally(() => {
            this.transcriptPreviewEnsureRequests.delete(requestKey);
        });
    }

    mountTranscriptEmptyPreview(
        host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const removeEmptyState = (): void => {
            this.host.transcriptEmbeddedPreview?.root.classList.remove('theia-mod-empty-preview');
            this.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
        };
        this.host.transcriptEmbeddedPreview = mountEmbeddedAgentPreviewChrome(host, {
            url: 'about:blank',
            messageService: this.host.messageService,
            clipboard: this.host.previewClipboard,
            previewSurfaces: this.host.previewSurfaceRegistry,
            inspectorDeps: this.host.previewInspectorDeps,
            onNavigate: removeEmptyState,
            notify: (message, kind) => {
                MobileSnackbar.show(message, { kind: kind === 'warn' ? 'warning' : 'success' });
            },
            openExternal: target => {
                window.open(target, '_blank', 'noopener,noreferrer');
            },
        });
        this.host.transcriptEmbeddedPreview.root.classList.add('theia-mod-empty-preview');
        const input = this.host.transcriptEmbeddedPreview.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
        if (input) {
            input.value = '';
            input.placeholder = nls.localize('qaap/mobileProjects/previewUrlPlaceholder', 'Ingresa una URL');
        }
        const content = this.host.transcriptEmbeddedPreview.root.querySelector<HTMLElement>('.qaap-preview-content-area');
        if (!content) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'theia-mobile-transcript-preview-empty-overlay';
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-transcript-preview-empty';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-transcript-preview-run';
        const ring = document.createElement('span');
        ring.className = 'theia-mobile-transcript-preview-run-ring';
        ring.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('i');
        icon.className = 'codicon codicon-play';
        icon.setAttribute('aria-hidden', 'true');
        btn.append(ring, icon);
        btn.addEventListener('click', () => { void this.requestTranscriptPreview(project, summary); });
        wrap.append(btn);
        overlay.append(wrap);
        content.append(overlay);
        this.updateTranscriptPreviewRunButtonState();
    }

    /**
     * Workspace path for transcript Files/Terminal.
     * Hub project URI locally; on the VPS, {@link QaapAgentConversationSummaryDTO.cwd} wins for agent tasks.
     */
    resolveTranscriptProjectCwd(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string | undefined {
        return resolveTranscriptWorkspaceCwd({
            summary,
            projectCwd: this.host.projectsService.getProjectCwd(project),
            preparedCwd: this.host.preparedCwdByProjectId.get(project.id),
        });
    }

    resolveTranscriptWorkspaceKey(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): TranscriptWorkspaceSurfaceKey | undefined {
        const cwd = this.resolveTranscriptProjectCwd(project, summary);
        if (!cwd) {
            return undefined;
        }
        const terminalServices = this.host.createTranscriptTerminalViewServices?.();
        const resolved = terminalServices ? terminalServices.resolveCwd(cwd) : cwd;
        return this.resolveProjectScopedWorkspaceKey(project, resolved);
    }

    protected resolveProjectScopedWorkspaceKey(
        project: MobileProjectEntry,
        resolvedPath: string,
    ): TranscriptWorkspaceSurfaceKey {
        const workspaceKey = normalizeTranscriptWorkspaceKey(resolvedPath);
        const projectKey = project.id.trim() || project.uri?.toString() || project.name || 'unknown-project';
        return `project:${encodeURIComponent(projectKey)}:${workspaceKey}`;
    }

    ensureTranscriptFilesTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        const host = this.executionFilesHost();
        if (!host) {
            return;
        }
        const workspaceKey = this.resolveTranscriptWorkspaceKey(project, summary);
        if (!workspaceKey && project.github && this.host.projectsService) {
            void this.host.projectsService.prepareProjectCwd(project).then(prepared => {
                if (!prepared || !this.executionFilesHost()?.isConnected || this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'files') {
                    return;
                }
                this.host.preparedCwdByProjectId.set(project.id, prepared);
                this.ensureTranscriptFilesTab(project, summary);
            });
        }
        if (!workspaceKey) {
            this.detachTranscriptFilesFromHost();
            host.replaceChildren();
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-files-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/filesUnavailable',
                'Files are unavailable for this conversation (no workspace path).',
            );
            host.append(note);
            return;
        }
        if (this.host.transcriptFilesAttachedKey === workspaceKey && host.querySelector('.theia-mobile-transcript-files')) {
            return;
        }
        this.detachTranscriptFilesFromHost();
        const cwd = this.resolveTranscriptProjectCwd(project, summary);
        const services = this.host.createTranscriptFilesViewServices?.();
        if (!cwd || !services) {
            return;
        }
        const wrappedServices: TranscriptFilesViewServices = {
            ...services,
            renderMarkdownPreview: services.renderMarkdownPreview
                ? (resourcePath, markdown) => services.renderMarkdownPreview!(
                    resourcePath,
                    this.host.transcriptMessagesUi.cleanTranscriptDisplayText(markdown),
                )
                : undefined,
        };
        let mount = this.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey);
        if (!mount) {
            const stash = document.createElement('div');
            stash.className = 'theia-mobile-transcript-files-staging';
            stash.hidden = true;
            stash.setAttribute('aria-hidden', 'true');
            document.body.append(stash);
            mount = mountTranscriptFilesView(stash, cwd, wrappedServices);
            this.host.transcriptWorkspaceSurfaces.setFiles(workspaceKey, mount);
        }
        host.replaceChildren();
        host.append(mount.root);
        this.host.transcriptFilesAttachedKey = workspaceKey;
        mount.root.querySelector<HTMLElement>('.theia-mobile-transcript-files-preview-body')
            ?.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
    }

    async revealTranscriptFile(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        filePath: string,
    ): Promise<void> {
        const trimmed = filePath.trim();
        if (!trimmed) {
            return;
        }
        this.host.executionSurfaceTabsUi.selectTranscriptTab('files', project, summary);
        this.ensureTranscriptFilesTab(project, summary);
        const workspaceKey = this.resolveTranscriptWorkspaceKey(project, summary);
        if (!workspaceKey) {
            return;
        }
        const mount = this.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey);
        if (!mount?.revealFilePath) {
            return;
        }
        try {
            await mount.revealFilePath(trimmed);
        } catch (error) {
            console.warn('[qaap-mobile-shell] Failed to reveal transcript file in Files preview:', error);
            this.host.messageService?.error(
                nls.localize('qaap/mobileProjects/transcriptOpenFileFailed', 'Could not open {0}', trimmed),
            );
        }
    }

    async revealTranscriptReviewFile(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        filePath: string,
    ): Promise<void> {
        const trimmed = filePath.trim();
        if (!trimmed) {
            return;
        }
        this.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, summary);
        await this.mountTranscriptReviewWidget(project, summary);
        if (!this.host.diffReviewWidget?.focusTranscriptReviewFile(trimmed)) {
            console.warn('[qaap-mobile-shell] Review file not found in diff list:', trimmed);
        }
    }

    async ensureTranscriptTerminalTab(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        const host = this.executionTerminalHost();
        if (!host) {
            return;
        }
        const workspaceKey = this.resolveTranscriptWorkspaceKey(project, summary);
        if (!workspaceKey && project.github && this.host.projectsService) {
            void this.host.projectsService.prepareProjectCwd(project).then(prepared => {
                if (!prepared || !this.executionTerminalHost()?.isConnected || this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'terminal') {
                    return;
                }
                this.host.preparedCwdByProjectId.set(project.id, prepared);
                void this.ensureTranscriptTerminalTab(project, summary);
            });
        }
        if (!workspaceKey) {
            this.detachTranscriptTerminalFromHost();
            host.replaceChildren();
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-terminal-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/terminalUnavailable',
                'Terminal is unavailable for this conversation (no workspace path).',
            );
            host.append(note);
            return;
        }
        const cwd = this.resolveTranscriptProjectCwd(project, summary);
        const services = this.host.createTranscriptTerminalViewServices?.();
        if (!cwd || !services) {
            return;
        }
        if (!host.isConnected) {
            return;
        }

        this.ensureTranscriptTerminalChrome(host, workspaceKey, cwd, services, project, summary);
        let state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        if (!state) {
            state = { surfaces: [], activeIndex: 0 };
            this.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
            await this.restoreTranscriptTerminalSlides(workspaceKey, cwd, services);
            state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        }
        if (!state) {
            state = { surfaces: [], activeIndex: 0 };
            this.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
        }
        if (state.surfaces.length === 0) {
            await this.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary);
            state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        }
        if (state && state.surfaces.length > 0) {
            this.renderTranscriptTerminalSlides(workspaceKey);
        }
    }

    ensureTranscriptTerminalChrome(
        host: HTMLElement,
        workspaceKey: TranscriptWorkspaceSurfaceKey,
        cwd: string,
        services: TranscriptTerminalViewServices,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        if (this.host.transcriptTerminalSlider?.parentElement === host
            && this.host.transcriptTerminalToolbar?.parentElement === host
            && this.host.transcriptTerminalDots?.parentElement === this.host.transcriptTerminalToolbar) {
            return;
        }
        host.classList.add('theia-mobile-transcript-terminal');
        host.replaceChildren();

        const toolbar = document.createElement('div');
        toolbar.className = 'theia-mobile-transcript-terminal-toolbar';
        const switcher = document.createElement('div');
        switcher.className = 'theia-mobile-transcript-terminal-switcher';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'theia-mobile-transcript-terminal-add codicon codicon-add';
        addBtn.title = services.localize('qaap/mobileProjects/transcriptTerminalNew', 'New terminal');
        addBtn.setAttribute('aria-label', addBtn.title);
        addBtn.addEventListener('click', () => {
            void this.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary, true);
        });
        toolbar.append(switcher, addBtn);

        const slider = document.createElement('div');
        slider.className = 'theia-mobile-transcript-terminal-slider';
        host.append(toolbar, slider);
        this.host.transcriptTerminalToolbar = toolbar;
        this.host.transcriptTerminalSlider = slider;
        this.host.transcriptTerminalDots = switcher;
    }

    async createTranscriptTerminalSlide(
        workspaceKey: TranscriptWorkspaceSurfaceKey,
        cwd: string,
        services: TranscriptTerminalViewServices,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        activateNewest = false,
    ): Promise<void> {
        const host = this.executionTerminalHost();
        if (!host?.isConnected) {
            return;
        }
        try {
            const staging = createTranscriptTerminalStagingHost();
            const surface = await createTranscriptTerminalSurface(staging, cwd, services);
            const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey) ?? { surfaces: [], activeIndex: 0 };
            state.surfaces.push(surface);
            state.activeIndex = activateNewest ? state.surfaces.length - 1 : Math.max(0, state.activeIndex);
            this.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
            void this.persistTranscriptTerminalWorkspace(workspaceKey);
            if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'terminal'
                && this.resolveTranscriptWorkspaceKey(project, summary) === workspaceKey) {
                this.renderTranscriptTerminalSlides(workspaceKey);
            }
        } catch (error) {
            if (!host.isConnected) {
                return;
            }
            const slider = this.host.transcriptTerminalSlider;
            if (slider) {
                slider.replaceChildren();
            }
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-terminal-error';
            const message = error instanceof Error ? error.message : String(error);
            note.textContent = services.localize(
                'qaap/mobileProjects/transcriptTerminalFailed',
                'Could not start the terminal: {0}',
                message,
            );
            slider?.append(note);
            console.error('[qaap-mobile-shell] transcript terminal failed', error);
        }
    }

    renderTranscriptTerminalSlides(workspaceKey: TranscriptWorkspaceSurfaceKey): void {
        const slider = this.host.transcriptTerminalSlider;
        const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        if (!slider || !state) {
            return;
        }
        slider.replaceChildren();
        const active = state.surfaces[state.activeIndex];
        if (active) {
            const slide = document.createElement('div');
            slide.className = 'theia-mobile-transcript-terminal-slide theia-mod-active';
            slide.dataset.index = String(state.activeIndex);
            slide.append(active.mountHost);
            slider.append(slide);
            scheduleTranscriptTerminalResize(active.terminal);
            this.syncTranscriptTerminalResizeObserver(slider, active.terminal);
        } else {
            this.syncTranscriptTerminalResizeObserver(undefined, undefined);
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-transcript-terminal-note';
            empty.textContent = nls.localize(
                'qaap/mobileProjects/transcriptTerminalEmpty',
                'No terminals open. Create one with +.',
            );
            slider.append(empty);
        }
        this.renderTranscriptTerminalDots(workspaceKey);
    }

    syncTranscriptTerminalResizeObserver(
        slider: HTMLElement | undefined,
        terminal: TerminalWidget | undefined,
    ): void {
        this.host.transcriptTerminalResizeObserver?.disconnect();
        this.host.transcriptTerminalResizeObserver = undefined;
        if (!slider || !terminal || typeof ResizeObserver === 'undefined') {
            return;
        }
        this.host.transcriptTerminalResizeObserver = new ResizeObserver(() => {
            if (terminal.isAttached && !slider.hidden) {
                scheduleTranscriptTerminalResize(terminal);
            }
        });
        const resizeTargets = [
            slider.parentElement,
            slider,
            terminal.node.parentElement,
            terminal.node,
            terminal.node.querySelector<HTMLElement>('.terminal-container'),
            terminal.node.querySelector<HTMLElement>('.xterm'),
        ];
        for (const target of resizeTargets) {
            if (target) {
                this.host.transcriptTerminalResizeObserver.observe(target);
            }
        }
    }

    renderTranscriptTerminalDots(workspaceKey: TranscriptWorkspaceSurfaceKey): void {
        const dots = this.host.transcriptTerminalDots;
        const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        if (!dots || !state) {
            return;
        }
        dots.replaceChildren();
        state.surfaces.forEach((surface, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'theia-mobile-transcript-terminal-tab';
            tab.classList.toggle('theia-mod-active', index === state.activeIndex);
            const title = this.resolveTranscriptTerminalTabTitle(surface, index);
            tab.title = title;
            tab.setAttribute('aria-label', title);
            tab.addEventListener('click', () => {
                state.activeIndex = index;
                void this.persistTranscriptTerminalWorkspace(workspaceKey);
                this.renderTranscriptTerminalSlides(workspaceKey);
                this.renderTranscriptTerminalDots(workspaceKey);
            });

            const icon = document.createElement('span');
            icon.className = 'theia-mobile-transcript-terminal-tab-icon codicon codicon-terminal';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-transcript-terminal-tab-label';
            label.textContent = title;
            tab.append(icon, label);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'theia-mobile-transcript-terminal-tab-close codicon codicon-close';
            close.title = nls.localize('qaap/mobileProjects/transcriptTerminalClose', 'Close terminal');
            close.setAttribute('aria-label', close.title);
            close.addEventListener('click', event => {
                event.stopPropagation();
                this.closeTranscriptTerminalTab(workspaceKey, index);
            });
            tab.append(close);

            dots.append(tab);
        });
    }

    resolveTranscriptTerminalTabTitle(surface: TranscriptTerminalSurface, index: number): string {
        const title = surface.terminal.title.label?.trim();
        if (title) {
            return title;
        }
        return nls.localize('qaap/mobileProjects/transcriptTerminalIndex', 'Terminal {0}', String(index + 1));
    }

    closeTranscriptTerminalTab(workspaceKey: TranscriptWorkspaceSurfaceKey, index: number): void {
        const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        if (!state) {
            return;
        }
        const [removed] = state.surfaces.splice(index, 1);
        removed?.dispose.dispose();
        if (state.surfaces.length === 0) {
            state.activeIndex = 0;
        } else if (state.activeIndex >= state.surfaces.length) {
            state.activeIndex = state.surfaces.length - 1;
        }
        this.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
        void this.persistTranscriptTerminalWorkspace(workspaceKey);
        this.renderTranscriptTerminalSlides(workspaceKey);
    }

    protected async restoreTranscriptTerminalSlides(
        workspaceKey: TranscriptWorkspaceSurfaceKey,
        cwd: string,
        services: TranscriptTerminalViewServices,
    ): Promise<void> {
        const persisted = await services.loadWorkspaceState(workspaceKey);
        if (!persisted || persisted.terminals.length === 0) {
            return;
        }
        const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey) ?? { surfaces: [], activeIndex: 0 };
        if (state.surfaces.length > 0) {
            return;
        }
        for (const terminalState of persisted.terminals) {
            try {
                const staging = createTranscriptTerminalStagingHost();
                const surface = await createTranscriptTerminalSurface(staging, cwd, services, terminalState);
                state.surfaces.push(surface);
            } catch (error) {
                console.warn('[qaap-mobile-shell] failed to restore WorkHub terminal', error);
            }
        }
        state.activeIndex = Math.min(
            Math.max(0, persisted.activeIndex),
            Math.max(0, state.surfaces.length - 1),
        );
        this.host.transcriptTerminalSlidesByWorkspace.set(workspaceKey, state);
        void this.persistTranscriptTerminalWorkspace(workspaceKey);
    }

    protected async persistTranscriptTerminalWorkspace(workspaceKey: TranscriptWorkspaceSurfaceKey): Promise<void> {
        const services = this.host.createTranscriptTerminalViewServices?.();
        if (!services) {
            return;
        }
        const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        const persisted = this.toPersistedTerminalWorkspace(state);
        await services.saveWorkspaceState(workspaceKey, persisted);
    }

    protected toPersistedTerminalWorkspace(
        state: TranscriptTerminalSliderState | undefined,
    ): TranscriptTerminalPersistedWorkspace | undefined {
        if (!state || state.surfaces.length === 0) {
            return undefined;
        }
        const terminals = state.surfaces
            .map(surface => ({
                terminalId: surface.terminal.terminalId,
                titleLabel: surface.terminal.title.label,
            }))
            .filter(terminal => Number.isInteger(terminal.terminalId) && terminal.terminalId >= 0);
        if (terminals.length === 0) {
            return undefined;
        }
        return {
            activeIndex: Math.min(Math.max(0, state.activeIndex), terminals.length - 1),
            terminals,
        };
    }

    detachTranscriptFilesFromHost(): void {
        const host = this.executionFilesHost();
        if (host) {
            host.querySelector('.theia-mobile-transcript-files')?.remove();
            host.querySelector('.theia-mobile-transcript-files-note')?.remove();
        }
        this.host.transcriptFilesAttachedKey = undefined;
    }

    detachTranscriptTerminalFromHost(): void {
        this.syncTranscriptTerminalResizeObserver(undefined, undefined);
        const host = this.executionTerminalHost();
        if (host) {
            host.replaceChildren();
            host.classList.remove('theia-mobile-transcript-terminal');
        }
        this.host.transcriptTerminalToolbar = undefined;
        this.host.transcriptTerminalSlider = undefined;
        this.host.transcriptTerminalDots = undefined;
    }

    detachTranscriptWorkspaceSurfacesFromSheet(): void {
        this.detachTranscriptFilesFromHost();
        this.detachTranscriptTerminalFromHost();
    }

    disposeTranscriptTerminalSlides(workspaceKey?: TranscriptWorkspaceSurfaceKey): void {
        if (workspaceKey) {
            const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
            if (state) {
                for (const surface of state.surfaces) {
                    surface.dispose.dispose();
                }
            }
            this.host.transcriptTerminalSlidesByWorkspace.delete(workspaceKey);
            return;
        }
        for (const state of this.host.transcriptTerminalSlidesByWorkspace.values()) {
            for (const surface of state.surfaces) {
                surface.dispose.dispose();
            }
        }
        this.host.transcriptTerminalSlidesByWorkspace.clear();
    }

    createTranscriptPreviewLoading(_conv: QaapAgentConversationDTO | undefined): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-transcript-preview-loading';
        wrap.setAttribute('role', 'status');
        wrap.setAttribute('aria-live', 'polite');

        const line = document.createElement('div');
        line.className = 'theia-mobile-agent-stream-line theia-mod-thinking';
        const dot = document.createElement('span');
        dot.className = 'theia-mobile-agent-stream-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-stream-label';
        label.textContent = nls.localize('qaap/mobileProjects/previewLoading', 'Cargando...');
        line.append(dot, label);
        wrap.append(line);
        return wrap;
    }

    async syncTranscriptPreviewFromConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,
    ): Promise<void> {
        const awaitingPreview = conversationShouldWatchDevPreview(conv, window.location.origin)
            || this.host.transcriptPreviewRequestPending;
        if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview'
            && !this.host.transcriptPreviewRequestPending
            && !awaitingPreview) {
            return;
        }
        const latestProject = await this.refreshTranscriptPreviewProject(project, summary);
        if (this.resolveTranscriptPreviewUrl(latestProject, conv) || conv.status !== 'streaming') {
            this.host.transcriptPreviewRequestPending = false;
        }
        if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview'
            && (this.matchesActivePreviewSummary(summary) || this.host.projectDetailSurfaceTargets)) {
            const candidateUrl = this.resolveTranscriptPreviewUrl(latestProject, conv);
            if (candidateUrl === this.lastSyncedPreviewUrl(project.id)
                && this.mountedPreviewUrl(project.id) === candidateUrl
                && conv.status === 'streaming') {
                this.scheduleTranscriptPreviewTabProbe(latestProject, summary, conv);
                return;
            }
            this.setLastSyncedPreviewUrl(project.id, candidateUrl);
            this.renderPreviewTab(latestProject, summary);
        } else if (awaitingPreview) {
            this.scheduleTranscriptPreviewTabProbe(latestProject, summary, conv);
        }
    }

    async refreshTranscriptPreviewProject(project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO): Promise<MobileProjectEntry> {
        try {
            const previousPreviewUrl = project.previewUrl
                ?? this.host.projects.find(candidate => candidate.id === project.id)?.previewUrl;
            this.host.projects = await this.host.projectsService.loadProjects();
            const loadedProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
            const latestProject = previousPreviewUrl && !loadedProject.previewUrl
                ? { ...loadedProject, previewUrl: previousPreviewUrl }
                : loadedProject;
            if (latestProject.previewUrl) {
                if (await this.previewUrlMatchesProject(latestProject.previewUrl, latestProject)) {
                    return latestProject;
                }
            }
            const previewUrl = await this.host.projectsService.resolveProjectPreviewUrl(latestProject, summary?.cwd);
            if (previewUrl && await this.previewUrlMatchesProject(previewUrl, latestProject)) {
                return { ...latestProject, previewUrl };
            }
            const discoveredPreviewUrl = await this.discoverProjectDevPreviewUrl(latestProject);
            return discoveredPreviewUrl ? { ...latestProject, previewUrl: discoveredPreviewUrl } : latestProject;
        } catch {
            const previewUrl = await this.host.projectsService.resolveProjectPreviewUrl(project, summary?.cwd).catch(() => undefined);
            if (previewUrl && await this.previewUrlMatchesProject(previewUrl, project).catch(() => false)) {
                return { ...project, previewUrl };
            }
            const discoveredPreviewUrl = await this.discoverProjectDevPreviewUrl(project).catch(() => undefined);
            if (discoveredPreviewUrl) {
                return { ...project, previewUrl: discoveredPreviewUrl };
            }
            return project;
        }
    }

    async previewUrlMatchesProject(previewUrl: string, project: MobileProjectEntry): Promise<boolean> {
        try {
            const response = await fetch(normalizePreviewUrlForSameOrigin(previewUrl), { cache: 'no-store' });
            if (!response.ok) {
                return false;
            }
            const html = await response.text();
            const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
            return previewPageTitleMatchesProjectName(title, project.name);
        } catch {
            return false;
        }
    }

    async discoverProjectDevPreviewUrl(project: MobileProjectEntry): Promise<string | undefined> {
        const ports = Array.from({ length: 18 }, (_, index) => 5173 + index);
        const probes = await Promise.all(ports.map(async port => {
            const probe = await probeQaapDevPreviewPort(port);
            if (!probe.ready || !await this.previewUrlMatchesProject(probe.previewUrl, project)) {
                return undefined;
            }
            return normalizePreviewUrlForSameOrigin(probe.previewUrl);
        }));
        const previewUrl = probes.find(Boolean);
        if (previewUrl) {
            void this.host.projectsService.recordProjectPreviewUrl(project, previewUrl);
        }
        return previewUrl;
    }

    beginTranscriptDevPreviewRequest(project: MobileProjectEntry, _summary: QaapAgentConversationSummaryDTO): void {
        this.clearPreviewRuntimeForProject(project.id);
        this.stopTranscriptPreviewTabProbe();
        const cleared = { ...project, previewUrl: undefined };
        this.host.projects = this.host.projects.map(candidate => candidate.id === cleared.id
            ? cleared
            : candidate);
        if (this.host.transcriptOpenProject?.id === cleared.id) {
            this.host.transcriptOpenProject = cleared;
        }
    }

    stageTranscriptPreviewReadyUrl(projectId: string, readyUrl: string): void {
        this.setProbeReadyPreviewUrl(projectId, readyUrl);
    }

    /** Preview URL of the bootstrap-managed dev server, when it is up for this project. */
    protected bootstrapRunningPreviewUrl(project: MobileProjectEntry): string | undefined {
        return this.bootstrapPreviewUrlForProject(project);
    }

    /** True while the bootstrap is installing / starting / serving the dev server. */
    protected isProjectBootstrapPreviewActive(): boolean {
        const phase = this.host.projectBootstrap?.phase;
        return phase === 'installing' || phase === 'starting' || phase === 'running';
    }

    resolveTranscriptPreviewUrl(
        project: MobileProjectEntry,
        conv: QaapAgentConversationDTO | undefined,
    ): string | undefined {
        if (conv) {
            const fromConversation = findTranscriptPreviewUrlFromConversation(conv, window.location.origin);
            if (fromConversation) {
                return normalizePreviewUrlForSameOrigin(fromConversation);
            }
            if (this.host.transcriptPreviewRequestPending && conv.status === 'streaming') {
                return this.probeReadyPreviewUrl(project.id) ?? this.bootstrapRunningPreviewUrl(project);
            }
            if (conv.status === 'streaming' && conversationShouldWatchDevPreview(conv, window.location.origin)) {
                return this.bootstrapRunningPreviewUrl(project)
                    ?? this.probeReadyPreviewUrl(project.id)
                    ?? this.mountedPreviewUrl(project.id)
                    ?? undefined;
            }
        }
        if (this.host.transcriptPreviewRequestPending && conv?.status === 'streaming') {
            return undefined;
        }
        const storedUrl = project.previewUrl ? normalizePreviewUrlForSameOrigin(project.previewUrl) : undefined;
        if (storedUrl) {
            return storedUrl;
        }
        const bootstrapUrl = this.bootstrapRunningPreviewUrl(project);
        if (bootstrapUrl) {
            return bootstrapUrl;
        }
        return undefined;
    }

    async requestTranscriptPreview(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (this.host.transcriptPreviewRequestRunning) {
            return;
        }
        const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
        if (latestProject.previewUrl && this.host.onResumePreview) {
            await this.host.onResumePreview(latestProject);
            return;
        }

        const bootstrap = this.host.projectBootstrap;
        if (bootstrap && this.bootstrapAppliesToProject(project)) {
            const conversation = this.host.transcriptLastConv?.id === summary.id
                ? this.host.transcriptLastConv
                : undefined;
            void ensureTranscriptDevPreview(bootstrap, { conversation }).then(readyUrl => {
                if (!readyUrl || !this.matchesActivePreviewSummary(summary)) {
                    return;
                }
                if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
                    return;
                }
                const refreshed = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
                this.host.projects = this.host.projects.map(candidate => candidate.id === refreshed.id
                    ? { ...candidate, previewUrl: readyUrl }
                    : candidate);
                void this.host.projectsService.recordProjectPreviewUrl({ ...refreshed, previewUrl: readyUrl }, readyUrl);
                this.renderPreviewTab({ ...refreshed, previewUrl: readyUrl }, summary);
            });
        }

        const message = nls.localize(
            'qaap/mobileProjects/previewAgentRequest',
            'Prepare this app for live in-IDE preview. Qaap starts and keeps the dev server running in a dedicated terminal with hot reload — do NOT run long-lived dev commands in shell (pnpm dev, npm start, vite, next dev, etc.); shell tools time out after ~30s and break preview. Install dependencies only if node_modules is missing. Fix build/typecheck issues with one-shot commands. When ready, reply with the expected local port (e.g. 5173) and confirm dependencies are installed.',
        );
        this.host.transcriptPreviewRequestRunning = true;
        this.host.transcriptPreviewRequestPending = true;
        this.updateTranscriptPreviewRunButtonState();
        if (summary.cwd) {
            this.host.setAutoVerifyEnabled(summary.cwd, true);
            this.host.refreshTranscriptChecksViews(project, summary);
        }
        this.renderPreviewTab(project, summary);
        try {
            await this.host.submitTranscriptViaBackendConversation(project, summary, message, {
                selectedAgentId: this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                modeId: this.host.transcriptComposerModeId,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    this.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
            });
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/previewRequestSent', 'Preview request sent to agent'),
                { kind: 'success', duration: 1600 },
            );
            this.host.transcriptScheduleRefresh?.();
        } catch (error) {
            this.host.transcriptPreviewRequestPending = false;
            MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
        } finally {
            this.host.transcriptPreviewRequestRunning = false;
            if (this.matchesActivePreviewSummary(summary) && this.transcriptPreviewProjectId === project.id) {
                this.renderPreviewTab(project, summary);
            }
        }
    }
}

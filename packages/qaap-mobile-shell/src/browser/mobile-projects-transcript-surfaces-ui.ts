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
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import { reconcileAgentApprovalPolicyId, type QaapAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import { resolveTranscriptWorkspaceCwd, isTranscriptWorkspaceFilesystemPath } from '../common/qaap-transcript-workspace-cwd';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { ExecutionSurfaceTabId } from '../common/qaap-execution-surface-tabs';
import {
    conversationShouldWatchDevPreview,
    findTranscriptPreviewUrlFromConversation,
    previewPageTitleMatchesProjectName,
    resolveReadyTranscriptPreviewUrlFromProbe,
} from '../common/qaap-transcript-preview-offer';
import { fetchQaapCurrentDevPreview, probeQaapDevPreviewPort, probeQaapIdentityPreview, waitForQaapDevPreviewPort } from './qaap-dev-preview-client';
import {
    findQaapIdentityPreviewUrl,
    isLocalQaapPreviewOrigin,
    parseQaapIdentityPreviewRequestPath,
    resolveDevPreviewPublicOrigin,
} from '../common/qaap-dev-preview';
import { ensureTranscriptDevPreview, extractDevPreviewPortFromUrl } from './qaap-transcript-preview-bootstrap';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { isTerminalDoesNotExistError } from './qaap-project-bootstrap-dev-errors';
import {
    buildQaapPreviewId,
    normalizeQaapPreviewConversationId,
    qaapPreviewProjectIdMatches,
    type QaapPreviewIdentity,
} from '../common/qaap-preview-identity';
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
    markTranscriptTerminalRestorable,
    scheduleTranscriptTerminalResize,
    type TranscriptTerminalPersistedWorkspace,
    type TranscriptTerminalSurface,
    type TranscriptTerminalViewServices,
} from './qaap-transcript-terminal-view';
import { resolveInteractiveAgentCliBin, resolveInteractiveAgentLoginCommand } from '../common/qaap-agent-tui-command';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
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

interface ConversationPreviewRuntimeState {
    mountedUrl?: string;
    probeReadyUrl?: string;
    lastSyncedUrl?: string;
}

/**
 * Cadence of the mounted-identity supersession watch. Chained dev runs (retry, second tab,
 * backend restart) retire the claim the iframe is mounted on; nothing else probes once mounted,
 * so without this watch the surface shows the proxy's 403 page until a full reload.
 */
const TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS = 8_000;

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
    headerPreviewRunHost: HTMLElement;
    headerFilesMoreHost: HTMLElement;
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

    protected readonly transcriptPreviewEnsureRequests = new Set<string>();
    protected transcriptPreviewProbeTimer: number | undefined;
    protected transcriptPreviewIdentityWatchTimer: number | undefined;
    protected readonly previewRuntimeByConversationId = new Map<string, ConversationPreviewRuntimeState>();
    protected transcriptPreviewProjectId: string | undefined;
    protected transcriptPreviewConversationScopeId: string | undefined;
    /** Bumped on Stop / new Play so in-flight ensureTranscriptDevPreview callbacks are ignored. */
    protected previewLaunchGeneration = 0;

    constructor(
        protected readonly host: MobileProjectsTranscriptSurfacesHost,
        protected readonly transcriptHistoryUi: MobileProjectsTranscriptHistoryUi,
    ) { }

    protected previewScopeId(summary?: Pick<QaapAgentConversationSummaryDTO, 'id'>): string {
        return normalizeQaapPreviewConversationId(summary?.id ?? this.host.transcriptOpenSummaryId);
    }

    protected previewRuntimeFor(conversationScopeId: string): ConversationPreviewRuntimeState {
        let state = this.previewRuntimeByConversationId.get(conversationScopeId);
        if (!state) {
            state = {};
            this.previewRuntimeByConversationId.set(conversationScopeId, state);
        }
        return state;
    }

    protected mountedPreviewUrl(conversationScopeId: string): string | undefined {
        return this.previewRuntimeFor(conversationScopeId).mountedUrl;
    }

    protected setMountedPreviewUrl(conversationScopeId: string, url: string | undefined): void {
        const state = this.previewRuntimeFor(conversationScopeId);
        if (url === undefined) {
            delete state.mountedUrl;
        } else {
            state.mountedUrl = url;
        }
    }

    protected probeReadyPreviewUrl(conversationScopeId: string): string | undefined {
        return this.previewRuntimeFor(conversationScopeId).probeReadyUrl;
    }

    protected setProbeReadyPreviewUrl(conversationScopeId: string, url: string | undefined): void {
        const state = this.previewRuntimeFor(conversationScopeId);
        if (url === undefined) {
            delete state.probeReadyUrl;
        } else {
            state.probeReadyUrl = normalizePreviewUrlForSameOrigin(url);
        }
    }

    protected lastSyncedPreviewUrl(conversationScopeId: string): string | undefined {
        return this.previewRuntimeFor(conversationScopeId).lastSyncedUrl;
    }

    protected setLastSyncedPreviewUrl(conversationScopeId: string, url: string | undefined): void {
        const state = this.previewRuntimeFor(conversationScopeId);
        if (url === undefined) {
            delete state.lastSyncedUrl;
        } else {
            state.lastSyncedUrl = url;
        }
    }

    protected clearPreviewRuntimeForConversation(conversationScopeId: string): void {
        this.previewRuntimeByConversationId.delete(conversationScopeId);
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
        this.host.diffReviewWidget.setTranscriptCloseHandler(() => {
            const summary = this.host.transcriptOpenSummary;
            if (summary) {
                this.host.selectTranscriptTab('messages', project, summary);
                return;
            }
            this.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
            this.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('messages');
            this.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(project);
            this.host.root.classList.toggle('theia-mod-project-surface-chat', true);
            this.host.root.classList.toggle('theia-mod-project-surface-tools', false);
        });
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

        const card = document.createElement('div');
        card.className = 'theia-mobile-transcript-plan-card';

        const segments = this.latestAgentSegments(conv);
        if (!segments || segments.length === 0) {
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-plan-note';
            note.textContent = nls.localize(
                'qaap/mobileProjects/planEmpty',
                'Plan appears here as soon as the agent starts thinking or using tools.',
            );
            card.append(note);
            host.append(card);
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
            card.append(note);
            host.append(card);
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

        card.append(head, progress);
        if (timeline) {
            card.append(timeline);
        }
        host.append(card);
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
        subtitle.hidden = true;
        subtitle.className = 'theia-mobile-projects-subtitle';
        subtitle.replaceChildren();
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
        host.append(diffHost);
        this.host.transcriptReviewDiffHost = diffHost;
        this.host.transcriptReviewChecksHost = undefined;
        this.host.transcriptHistoryRoot = cwd;

        const rootUri = project.uri?.toString() ?? `file://${cwd}`;
        if (!this.host.diffReviewWidget) {
            this.host.diffReviewWidget = await this.host.createDiffReviewWidget();
        }
        if (this.host.transcriptReviewHost !== host || !diffHost.isConnected) {
            return;
        }
        // No bottom changes-dock (Loading / history) — agent changes live in the diff widget.
        this.host.diffReviewWidget.enableTranscriptEmbed({ externalChrome: true });
        this.host.diffReviewWidget.node.classList.add('theia-mobile-transcript-diff-embed');
        this.host.diffReviewWidget.setTranscriptAgentFeedbackHandler(async message => {
            await this.submitTranscriptReviewFeedback(project, summary, message);
        });
        this.host.diffReviewWidget.setTranscriptCloseHandler(() => {
            this.host.executionSurfaceTabsUi.selectTranscriptTab('messages', project, summary);
        });
        this.host.attachDiffReviewWidget(diffHost);
        this.host.diffReviewWidget.setRepositoryContext({
            rootUri,
            rootFsPath: cwd,
            isActiveWorkspace: project.isCurrent,
        });
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
            this.host.diffReviewWidget.setTranscriptCloseHandler(undefined);
            this.host.diffReviewWidget.setReviewStatsChangeHandler(undefined);
        }
        this.host.transcriptReviewDiffHost = undefined;
        this.host.transcriptReviewChecksHost = undefined;
        this.host.transcriptHistoryRoot = undefined;
        this.host.transcriptHistoryLoading = false;
    }

    disposeTranscriptEmbeddedPreview(): void {
        this.stopTranscriptPreviewIdentityWatch();
        this.host.transcriptEmbeddedPreview?.dispose();
        this.host.transcriptEmbeddedPreview = undefined;
        if (this.transcriptPreviewConversationScopeId) {
            this.setMountedPreviewUrl(this.transcriptPreviewConversationScopeId, undefined);
        }
    }

    /**
     * Tear down the preview iframe when another execution tab is active so embedded
     * dev servers (e.g. Vite HMR) stop running in a hidden `display:none` host.
     * Keeps the last preview URL staged for a fast remount when Preview is opened again.
     */
    suspendTranscriptPreviewIframe(): void {
        this.stopTranscriptPreviewIdentityWatch();
        const chrome = this.host.transcriptEmbeddedPreview;
        if (!chrome) {
            return;
        }
        const conversationScopeId = this.transcriptPreviewConversationScopeId;
        const isEmptyPlaceholder = chrome.root.classList.contains('theia-mod-empty-preview');
        const stagedUrl = (conversationScopeId ? this.mountedPreviewUrl(conversationScopeId) : undefined)
            ?? this.getTranscriptEmbeddedPreviewUrl();
        chrome.dispose();
        this.host.transcriptEmbeddedPreview = undefined;
        this.executionPreviewHost()?.replaceChildren();
        if (!conversationScopeId) {
            return;
        }
        if (isEmptyPlaceholder) {
            this.setMountedPreviewUrl(conversationScopeId, undefined);
            return;
        }
        if (stagedUrl) {
            this.setProbeReadyPreviewUrl(conversationScopeId, stagedUrl);
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

    mountTranscriptEmbeddedPreview(
        host: HTMLElement,
        previewUrl: string,
        project: MobileProjectEntry,
        summary?: QaapAgentConversationSummaryDTO,
    ): void {
        const normalized = normalizePreviewUrlForSameOrigin(previewUrl);
        const conversationScopeId = this.previewScopeId(summary);
        this.transcriptPreviewProjectId = project.id;
        this.transcriptPreviewConversationScopeId = conversationScopeId;
        this.scheduleTranscriptPreviewIdentityWatch(project);
        if (this.host.transcriptEmbeddedPreview) {
            this.clearTranscriptEmptyPreviewChrome();
            const root = this.host.transcriptEmbeddedPreview.root;
            const current = this.getTranscriptEmbeddedPreviewUrl();
            if (current === normalized
                && this.transcriptPreviewProjectId === project.id
                && root.isConnected
                && host.contains(root)
                && !root.classList.contains('theia-mod-empty-preview')) {
                this.setMountedPreviewUrl(conversationScopeId, normalized);
                // Re-wire opener/scope even on same-URL remounts (controller may have been
                // created before Work Hub comment composer was available).
                this.wireTranscriptPreviewAnnotationScope(project, normalized);
                this.syncHeaderPreviewRunButton(project, summary);
                return;
            }
            this.host.transcriptEmbeddedPreview.setUrl(normalized);
            this.wireTranscriptPreviewAnnotationScope(project, normalized);
            this.setMountedPreviewUrl(conversationScopeId, normalized);
            if (!host.contains(root)) {
                host.append(root);
            }
            this.syncHeaderPreviewRunButton(project, summary);
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
            getAnnotationScope: () => this.resolvePreviewAnnotationScope(project, normalized),
            composerSession: this.host.resolveAnnotationComposerSession(),
        });
        this.wireTranscriptPreviewAnnotationScope(project, normalized);
        this.setMountedPreviewUrl(conversationScopeId, normalized);
        this.syncHeaderPreviewRunButton(project, summary);
    }

    protected wireTranscriptPreviewAnnotationScope(project: MobileProjectEntry, previewUrl: string): void {
        const frame = this.host.transcriptEmbeddedPreview?.frame;
        const surface = this.host.previewSurfaceRegistry?.getSurfaceForFrame(frame);
        surface?.picker.setAnnotationScopeProvider(() => this.resolvePreviewAnnotationScope(project, previewUrl));
        surface?.picker.setComposerSession(this.host.resolveAnnotationComposerSession());
    }

    protected resolvePreviewAnnotationScope(project: MobileProjectEntry, previewUrl: string): {
        previewId: string;
        workspaceId: string;
        threadId: string;
        previewUrl: string;
        route: string;
        viewportMode: 'desktop' | 'mobile';
        viewportWidth: number;
        viewportHeight: number;
    } {
        const live = this.getTranscriptEmbeddedPreviewUrl() || previewUrl;
        let stablePreviewUrl = previewUrl;
        let route = '/';
        try {
            const parsed = new URL(live, window.location.href);
            stablePreviewUrl = parsed.origin;
            route = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
        } catch {
            route = '/';
        }
        const narrow = typeof matchMedia === 'function'
            && matchMedia('(max-width: 767px), (pointer: coarse)').matches;
        const frame = this.host.transcriptEmbeddedPreview?.frame;
        const identity = this.resolveTranscriptPreviewIdentity(project, this.host.transcriptOpenSummary);
        return {
            previewId: buildQaapPreviewId(identity),
            workspaceId: project.id,
            threadId: this.host.transcriptOpenSummaryId
                ?? this.host.transcriptLastConv?.id
                ?? 'default',
            previewUrl: stablePreviewUrl,
            route,
            viewportMode: narrow ? 'mobile' : 'desktop',
            viewportWidth: frame?.clientWidth || window.innerWidth,
            viewportHeight: frame?.clientHeight || window.innerHeight,
        };
    }

    protected resolveTranscriptPreviewIdentity(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO | undefined,
    ): QaapPreviewIdentity {
        const conversationId = summary?.id
            ?? this.host.transcriptOpenSummaryId
            ?? this.host.transcriptLastConv?.id
            ?? 'default';
        const conversation = this.host.transcriptLastConv?.id === conversationId
            ? this.host.transcriptLastConv
            : undefined;
        const runId = this.bootstrapAppliesToProject(project)
            ? this.host.projectBootstrap?.getStateSnapshot().previewRunId
            : undefined;
        const fallbackRunId = [...(conversation?.messages ?? [])].reverse()
            .find(message => message.role === 'user' && !!message.taskId)?.taskId
            ?? `turn-${summary?.turnStartedAt ?? summary?.updatedAt ?? conversation?.updatedAt ?? 0}`;
        return { projectId: project.id, conversationId, runId: runId ?? fallbackRunId };
    }

    protected async claimTranscriptPreviewExecution(
        _project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        port: number,
        fallbackUrl: string,
    ): Promise<string | undefined> {
        const bootstrap = this.host.projectBootstrap;
        if (!bootstrap) {
            return undefined;
        }
        // claimPreviewExecution allocates a per-conversation processId; do not require the
        // previous section's global process UUID or section B would never reserve its own preview.
        const claim = await bootstrap.claimPreviewExecution(port, summary.id);
        return claim.kind === 'claimed' ? claim.previewUrl ?? fallbackUrl : undefined;
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
            if (!this.matchesActivePreviewSummary(summary) || !host.isConnected
                || !await this.previewUrlMatchesProject(candidateUrl, latestProject)) {
                return;
            }
            this.mountTranscriptEmbeddedPreview(host, candidateUrl, latestProject, summary);
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
            const reconciled = await this.reconcileSupersededProjectPreviewUrl(latestProject, readyUrl);
            if (reconciled && this.transcriptPreviewProjectId === project.id && host.isConnected) {
                const adopted = this.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
                void this.tryMountProjectScopedPreview(host, project, summary, adopted, reconciled);
                return;
            }
            const cleared = this.clearMismatchedProjectPreviewUrl(latestProject, readyUrl);
            if (this.transcriptPreviewProjectId === project.id && host.isConnected) {
                this.disposeTranscriptEmbeddedPreview();
                host.replaceChildren();
                this.mountTranscriptEmptyPreview(host, cleared, summary);
                void this.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
            }
            return;
        }
        const conversationScopeId = this.previewScopeId(summary);
        const executionUrl = await this.claimTranscriptPreviewExecution(project, summary, port, readyUrl);
        if (!executionUrl) {
            this.host.messageService?.warn(nls.localize(
                'qaap/mobileProjects/previewIdentityConflict',
                'This preview execution could not reserve its own process and port.',
            ));
            return;
        }
        if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) !== 'preview') {
            this.stageTranscriptPreviewReadyUrl(conversationScopeId, executionUrl);
            if (latestProject.previewUrl !== executionUrl) {
                const updatedProject = { ...latestProject, previewUrl: executionUrl };
                this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
                    ? updatedProject
                    : candidate);
                if (this.host.transcriptOpenProject?.id === updatedProject.id) {
                    this.host.transcriptOpenProject = updatedProject;
                }
                void this.host.projectsService.recordProjectPreviewUrl(updatedProject, executionUrl).catch(() => undefined);
            }
            return;
        }
        if (this.mountedPreviewUrl(conversationScopeId) === executionUrl
            && this.transcriptPreviewProjectId === project.id
            && this.host.transcriptEmbeddedPreview?.root.isConnected === true
            && host.contains(this.host.transcriptEmbeddedPreview.root)
            && !this.host.transcriptEmbeddedPreview.root.classList.contains('theia-mod-empty-preview')) {
            return;
        }

        this.setMountedPreviewUrl(conversationScopeId, executionUrl);
        this.setProbeReadyPreviewUrl(conversationScopeId, executionUrl);
        const allowBootstrap = this.host.transcriptPreviewRequestPending;
        this.host.transcriptPreviewRequestPending = false;
        this.host.transcriptPreviewRequestRunning = false;
        if (allowBootstrap) {
            void this.ensureTranscriptPreviewServing(project, summary, executionUrl, { allowBootstrap: true });
        }
        if (latestProject.previewUrl !== executionUrl) {
            const updatedProject = { ...latestProject, previewUrl: executionUrl };
            this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
                ? updatedProject
                : candidate);
            if (this.host.transcriptOpenProject?.id === updatedProject.id) {
                this.host.transcriptOpenProject = updatedProject;
            }
            void this.host.projectsService.recordProjectPreviewUrl(updatedProject, executionUrl).catch(() => undefined);
        }
        const hadEmptyPreview = this.host.transcriptEmbeddedPreview?.root.classList.contains('theia-mod-empty-preview') === true;
        if (hadEmptyPreview
            || !this.host.transcriptEmbeddedPreview?.root.isConnected
            || !host.contains(this.host.transcriptEmbeddedPreview.root)) {
            this.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
        }
        this.mountTranscriptEmbeddedPreview(host, executionUrl, latestProject, summary);
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

    /**
     * Queries the preview registry for this project's newest live claim and returns its ready
     * identity URL. Also hands the claim to the bootstrap when it owns this project, so the
     * composer "Open preview" pill and the persisted session record follow the same swap.
     */
    protected async fetchCurrentProjectClaimUrl(project: MobileProjectEntry): Promise<string | undefined> {
        const cwd = this.host.projectsService.getProjectCwd(project)
            ?? this.host.preparedCwdByProjectId.get(project.id);
        let cwdUri: string | undefined;
        try {
            cwdUri = cwd ? FileUri.create(cwd).toString() : undefined;
        } catch {
            cwdUri = undefined;
        }
        const current = await fetchQaapCurrentDevPreview([
            cwdUri,
            project.uri?.toString(),
            project.id,
        ]);
        if (!current?.ready || !current.previewUrl) {
            return undefined;
        }
        if (this.bootstrapAppliesToProject(project)) {
            this.host.projectBootstrap?.adoptSupersedingPreviewClaim(current);
        }
        return normalizePreviewUrlForSameOrigin(current.previewUrl);
    }

    /**
     * Newest live claim URL when `staleUrl` stopped resolving. Chained dev runs supersede the
     * claim a surface is still mounted on — the identity proxy then answers only "This preview
     * belongs to another execution" — so swap to the successor instead of requiring a reload.
     */
    protected async reconcileSupersededProjectPreviewUrl(
        project: MobileProjectEntry,
        staleUrl: string,
    ): Promise<string | undefined> {
        const currentUrl = await this.fetchCurrentProjectClaimUrl(project);
        if (!currentUrl || currentUrl === normalizePreviewUrlForSameOrigin(staleUrl)) {
            return undefined;
        }
        return currentUrl;
    }

    /** Applies a reconciled claim URL to hub state, runtime staging, and the session store. */
    protected adoptReconciledProjectPreviewUrl(project: MobileProjectEntry, previewUrl: string): MobileProjectEntry {
        const updated = { ...project, previewUrl };
        this.host.projects = this.host.projects.map(candidate => candidate.id === updated.id
            ? updated
            : candidate);
        if (this.host.transcriptOpenProject?.id === updated.id) {
            this.host.transcriptOpenProject = updated;
        }
        this.setProbeReadyPreviewUrl(this.previewScopeId(), previewUrl);
        void this.host.projectsService.recordProjectPreviewUrl(updated, previewUrl).catch(() => undefined);
        return updated;
    }

    protected stopTranscriptPreviewIdentityWatch(): void {
        if (this.transcriptPreviewIdentityWatchTimer !== undefined) {
            window.clearTimeout(this.transcriptPreviewIdentityWatchTimer);
            this.transcriptPreviewIdentityWatchTimer = undefined;
        }
    }

    protected scheduleTranscriptPreviewIdentityWatch(project: MobileProjectEntry): void {
        this.stopTranscriptPreviewIdentityWatch();
        this.transcriptPreviewIdentityWatchTimer = window.setTimeout(() => {
            this.transcriptPreviewIdentityWatchTimer = undefined;
            void this.verifyMountedTranscriptPreviewIdentity(project);
        }, TRANSCRIPT_PREVIEW_IDENTITY_WATCH_MS);
    }

    /**
     * Supersession watch for a mounted identity-scoped preview. Once mounted, nothing else
     * probes the iframe's claim, so a claim retired by a newer run would keep showing the
     * proxy's 403 page until a full reload. Probe the mounted identity and, when it dies while
     * a newer live claim exists for the same project, remount in place with the successor URL.
     */
    protected async verifyMountedTranscriptPreviewIdentity(project: MobileProjectEntry): Promise<void> {
        const chrome = this.host.transcriptEmbeddedPreview;
        if (!chrome || !chrome.root.isConnected
            || this.transcriptPreviewProjectId !== project.id
            || chrome.root.classList.contains('theia-mod-empty-preview')) {
            return;
        }
        if (document.hidden) {
            this.scheduleTranscriptPreviewIdentityWatch(project);
            return;
        }
        const conversationScopeId = this.previewScopeId();
        const mountedUrl = this.getTranscriptEmbeddedPreviewUrl() ?? this.mountedPreviewUrl(conversationScopeId);
        if (!mountedUrl) {
            return;
        }
        let identity: { previewId: string } | undefined;
        try {
            identity = parseQaapIdentityPreviewRequestPath(new URL(mountedUrl, window.location.href).pathname);
        } catch {
            identity = undefined;
        }
        if (!identity) {
            // Legacy port-scoped mounts cannot be superseded-403'd; the tab probe covers them.
            return;
        }
        const probe = await probeQaapIdentityPreview(identity.previewId);
        const stillMounted = (): boolean => this.host.transcriptEmbeddedPreview === chrome
            && chrome.root.isConnected
            && this.transcriptPreviewProjectId === project.id;
        if (!stillMounted()) {
            return;
        }
        if (probe.ready) {
            this.scheduleTranscriptPreviewIdentityWatch(project);
            return;
        }
        const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
        const reconciled = await this.reconcileSupersededProjectPreviewUrl(latestProject, mountedUrl);
        const hostElement = this.executionPreviewHost();
        if (reconciled && stillMounted() && hostElement?.isConnected) {
            const adopted = this.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
            this.mountTranscriptEmbeddedPreview(hostElement, reconciled, adopted);
            return;
        }
        // The successor claim may still be booting (or the run died) — keep watching.
        this.scheduleTranscriptPreviewIdentityWatch(project);
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
        this.clearPreviewRuntimeForConversation(this.previewScopeId());
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
            // A superseded claim probes as dead even though the project has a newer live one
            // (chained runs: retry, second tab, backend restart). Swap before falling back to
            // the destructive clear-and-rediscover path, which cannot recover on hosted origins.
            const reconciled = await this.reconcileSupersededProjectPreviewUrl(latestProject, candidateUrl);
            if (this.transcriptPreviewProjectId !== project.id || !host.isConnected) {
                return;
            }
            if (reconciled) {
                const adopted = this.adoptReconciledProjectPreviewUrl(latestProject, reconciled);
                void this.tryMountProjectScopedPreview(host, project, summary, adopted, reconciled);
                return;
            }
            const cleared = this.clearMismatchedProjectPreviewUrl(latestProject, candidateUrl);
            this.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
            this.mountTranscriptEmptyPreview(host, cleared, summary);
            void this.discoverAndMountTranscriptPreviewIfReady(cleared, summary);
            return;
        }
        const port = extractDevPreviewPortFromUrl(candidateUrl);
        if (port === undefined) {
            if (this.matchesActivePreviewSummary(summary)) {
                this.mountTranscriptEmbeddedPreview(host, candidateUrl, latestProject, summary);
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
        if (this.host.transcriptPreviewSuppressedByUser) {
            this.disposeTranscriptEmbeddedPreview();
            host.replaceChildren();
            this.mountTranscriptEmptyPreview(host, project, summary);
            this.syncHeaderPreviewRunButton(project, summary);
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

        const conversationScopeId = this.previewScopeId(summary);
        this.setMountedPreviewUrl(conversationScopeId, undefined);
        this.setLastSyncedPreviewUrl(conversationScopeId, undefined);

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
            const probeReadyUrl = this.probeReadyPreviewUrl(conversationScopeId);
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
            const conversationScopeId = this.previewScopeId(summary);
            const readyUrl = await resolveReadyTranscriptPreviewUrlFromProbe(
                conv,
                port => probeQaapDevPreviewPort(port),
                window.location.origin,
            );
            const normalized = readyUrl ? normalizePreviewUrlForSameOrigin(readyUrl) : undefined;
            if (normalized && await this.previewUrlMatchesProject(normalized, project)) {
                this.setProbeReadyPreviewUrl(conversationScopeId, normalized);
                const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
                const updatedProject = { ...latestProject, previewUrl: normalized };
                this.host.projects = this.host.projects.map(candidate => candidate.id === updatedProject.id
                    ? updatedProject
                    : candidate);
                this.host.transcriptOpenProject = this.host.transcriptOpenProject?.id === updatedProject.id
                    ? updatedProject
                    : this.host.transcriptOpenProject;
                void this.host.projectsService.recordProjectPreviewUrl(updatedProject, normalized).catch(() => undefined);
                // Never auto-switch to Preview. If the user is already on that tab, mount the
                // iframe in place; otherwise only stage the Open-preview pill / ready offer.
                if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
                    const host = this.executionPreviewHost();
                    if (host) {
                        void this.tryMountProjectScopedPreview(host, project, summary, updatedProject, normalized);
                    }
                } else {
                    this.stageTranscriptPreviewReadyUrl(conversationScopeId, normalized);
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
        if (this.host.transcriptPreviewSuppressedByUser) {
            return false;
        }
        if (this.host.transcriptPreviewRequestRunning || this.host.transcriptPreviewRequestPending) {
            return true;
        }
        // A bootstrap install/dev run outlives the agent turn; keep waiting (and probing) until
        // its preview is actually mounted instead of falling back to the idle play button.
        if (this.isProjectBootstrapPreviewActive()
            && project
            && !this.mountedPreviewUrl(this.previewScopeId())) {
            return true;
        }
        return conv?.status === 'streaming'
            && conversationShouldWatchDevPreview(conv, window.location.origin);
    }

    findTranscriptPreviewRunButton(): HTMLButtonElement | undefined {
        const headerButton = this.host.headerPreviewRunHost.querySelector('.theia-mobile-transcript-preview-run');
        if (headerButton instanceof HTMLButtonElement) {
            return headerButton;
        }
        const overlayButton = this.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mobile-transcript-preview-run');
        return overlayButton instanceof HTMLButtonElement ? overlayButton : undefined;
    }

    /**
     * Ensures the Preview play control is mounted and visible in the Work Hub header.
     *
     * Important: this method only SHOWS/updates the button. Concurrent refresh paths used to call
     * sync with incomplete args or a briefly flipped tab and set `hidden=true`, which made the
     * control flicker/disappear on click. Hiding is exclusive to
     * {@link hideHeaderPreviewRunButton} (leaving the Preview tab / tearing down the shell).
     */
    syncHeaderPreviewRunButton(
        project: MobileProjectEntry | undefined = this.host.transcriptOpenProject,
        summary: QaapAgentConversationSummaryDTO | undefined = this.host.transcriptOpenSummary,
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
    ): void {
        const host = this.host.headerPreviewRunHost;
        const openProject = project ?? this.host.transcriptOpenProject;
        const openSummary = summary ?? this.host.transcriptOpenSummary;
        if (!openProject || !openSummary) {
            return;
        }
        const onPreviewTab = this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(openProject) === 'preview';
        // Never auto-switch to Preview because a prompt matched "run the app" / pending bootstrap.
        // Staging + the composer Open preview pill stay on Chat; the header play control only
        // belongs on the Preview tab after an explicit user navigation (pill / link / tab).
        if (!onPreviewTab) {
            return;
        }
        let button = host.querySelector<HTMLButtonElement>('.theia-mobile-transcript-preview-run');
        if (!button) {
            button = this.createTranscriptPreviewRunButton(openProject, openSummary);
            host.replaceChildren(button);
        }
        host.hidden = false;
        this.applyTranscriptPreviewRunButtonState(button, openProject, openSummary, conv);
    }

    /** Hide the header play control — only when leaving Preview or tearing down the shell. */
    hideHeaderPreviewRunButton(): void {
        this.host.headerPreviewRunHost.hidden = true;
    }

    /**
     * Mounts Files ⋯ on the Work Hub header (left of the view selector) when the Files
     * surface is active outside the transcript sheet overlay.
     */
    syncHeaderFilesMoreButton(
        project: MobileProjectEntry | undefined = this.host.transcriptOpenProject,
        summary: QaapAgentConversationSummaryDTO | undefined = this.host.transcriptOpenSummary,
    ): void {
        const host = this.host.headerFilesMoreHost;
        const openProject = project ?? this.host.transcriptOpenProject;
        const openSummary = summary ?? this.host.transcriptOpenSummary;
        if (!openProject || !openSummary) {
            this.hideHeaderFilesMoreButton();
            return;
        }
        const onFilesTab = this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(openProject) === 'files';
        const useHubHeader = !this.host.transcriptSheet
            && (this.host.agentsHubShellActive || Boolean(this.host.projectDetailSurfaceTargets));
        const workspaceKey = this.resolveTranscriptWorkspaceKey(openProject, openSummary);
        const mount = workspaceKey
            ? this.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey)
            : undefined;
        if (!onFilesTab || !useHubHeader || !mount?.attachMoreActionsHost) {
            mount?.attachMoreActionsHost?.(undefined);
            host.hidden = true;
            return;
        }
        mount.attachMoreActionsHost(host);
        host.hidden = false;
    }

    /** Hide / restore Files ⋯ when leaving Files or tearing down the shell. */
    hideHeaderFilesMoreButton(): void {
        const openProject = this.host.transcriptOpenProject;
        const openSummary = this.host.transcriptOpenSummary;
        if (openProject && openSummary) {
            const workspaceKey = this.resolveTranscriptWorkspaceKey(openProject, openSummary);
            const mount = workspaceKey
                ? this.host.transcriptWorkspaceSurfaces.peekFiles(workspaceKey)
                : undefined;
            mount?.attachMoreActionsHost?.(undefined);
        }
        this.host.headerFilesMoreHost.hidden = true;
    }

    protected createTranscriptPreviewRunButton(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-transcript-preview-run theia-mobile-transcript-preview-run--header';
        const ring = document.createElement('span');
        ring.className = 'theia-mobile-transcript-preview-run-ring';
        ring.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('i');
        icon.className = 'codicon codicon-play';
        icon.setAttribute('aria-hidden', 'true');
        btn.append(ring, icon);
        const label = nls.localize('qaap/mobileProjects/previewButton', 'Vista previa');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        return btn;
    }

    updateTranscriptPreviewRunButtonState(conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv): void {
        this.syncHeaderPreviewRunButton(this.host.transcriptOpenProject, this.host.transcriptOpenSummary, conv);
    }

    /** True while preview is starting, probing, or already mounted live — show Stop instead of Play. */
    protected isTranscriptPreviewStoppable(
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
        project: MobileProjectEntry | undefined = this.host.transcriptOpenProject,
    ): boolean {
        if (this.host.transcriptPreviewSuppressedByUser) {
            return false;
        }
        if (this.isTranscriptPreviewWaiting(conv, project)) {
            return true;
        }
        const root = this.host.transcriptEmbeddedPreview?.root;
        if (root?.isConnected && !root.classList.contains('theia-mod-empty-preview')) {
            return true;
        }
        return !!this.mountedPreviewUrl(this.previewScopeId());
    }

    protected applyTranscriptPreviewRunButtonState(
        button: HTMLButtonElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO | undefined = this.host.transcriptLastConv,
    ): void {
        const stoppable = this.isTranscriptPreviewStoppable(conv, project);
        const waiting = this.isTranscriptPreviewWaiting(conv, project);
        button.disabled = false;
        button.classList.toggle('theia-mod-loading', waiting);
        button.classList.toggle('theia-mod-stop', stoppable);
        const icon = button.querySelector<HTMLElement>('.codicon');
        if (icon) {
            icon.classList.toggle('codicon-play', !stoppable);
            icon.classList.toggle('codicon-debug-stop', stoppable);
        }
        const label = stoppable
            ? nls.localize('qaap/mobileProjects/previewStop', 'Detener vista previa')
            : nls.localize('qaap/mobileProjects/previewButton', 'Vista previa');
        button.title = label;
        button.setAttribute('aria-label', label);
        if (waiting) {
            button.setAttribute('aria-busy', 'true');
        } else {
            button.removeAttribute('aria-busy');
        }
        button.onclick = () => {
            if (this.isTranscriptPreviewStoppable(this.host.transcriptLastConv, project)) {
                this.stopTranscriptPreview(project, summary);
                return;
            }
            void this.requestTranscriptPreview(project, summary);
        };
    }

    /** Cancel an in-flight preview start or tear down a live iframe back to the empty play state. */
    stopTranscriptPreview(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        // Invalidate every in-flight ensure/probe/submit callback first.
        this.previewLaunchGeneration += 1;
        this.host.transcriptPreviewSuppressedByUser = true;
        this.host.transcriptPreviewRequestRunning = false;
        this.host.transcriptPreviewRequestPending = false;
        this.transcriptPreviewEnsureRequests.clear();
        this.stopTranscriptPreviewTabProbe();
        this.stopTranscriptPreviewIdentityWatch();
        this.clearPreviewRuntimeForConversation(this.previewScopeId(summary));
        this.host.projectBootstrap?.cancelActivePreviewLaunch();
        const cleared = { ...project, previewUrl: undefined };
        this.host.projects = this.host.projects.map(candidate => candidate.id === cleared.id ? cleared : candidate);
        if (this.host.transcriptOpenProject?.id === cleared.id) {
            this.host.transcriptOpenProject = cleared;
        }
        this.disposeTranscriptEmbeddedPreview();
        // Paint Play immediately — sync before remount so the icon never waits on empty chrome.
        this.syncHeaderPreviewRunButton(cleared, summary);
        const host = this.executionPreviewHost();
        if (host && this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project) === 'preview') {
            this.mountTranscriptEmptyPreview(host, cleared, summary);
            this.syncHeaderPreviewRunButton(cleared, summary);
        }
        // Also stop the agent turn that was asked to prepare the preview (composer Stop).
        this.cancelPreviewAgentTurn(project, summary);
        MobileSnackbar.dismiss();
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/previewStopped', 'Vista previa detenida'),
            { duration: 1400 },
        );
    }

    /**
     * Cancels the streaming agent turn associated with a preview launch — same effect as tapping
     * Stop in the sticky composer — so "Prepare this app for live in-IDE preview…" does not keep
     * running after the user aborted the preview.
     */
    protected cancelPreviewAgentTurn(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const openProject = this.host.transcriptOpenProject ?? project;
        const openSummary = this.host.transcriptOpenSummary ?? summary;
        const hasRealConversation = !!openSummary && !isAgentsHubIdleConversationSummary(openSummary);
        if (hasRealConversation && this.host.onCancelConversation) {
            this.host.onCancelConversation(openProject, openSummary);
        } else {
            this.host.cancelOpenTranscriptStream?.();
        }
        this.host.transcriptComposerSendRefresh?.();
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
                conversationId: summary.id,
                projectId: project.id,
                workspaceRoot: this.host.projectsService.getProjectCwd(project) ?? summary.cwd,
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

    /** True while the user is typing in the mounted preview's URL field. */
    protected isTranscriptPreviewUrlFieldActive(): boolean {
        const input = this.host.transcriptEmbeddedPreview?.root.querySelector('.theia-mini-browser-url-field input');
        return !!input && input === document.activeElement;
    }

    mountTranscriptEmptyPreview(
        host: HTMLElement,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        // Probe churn (identity mismatch, run restarts) can decide to fall back to the empty state
        // while the user is typing a URL into the live chrome — never tear the field out from
        // under their cursor; the next probe tick re-evaluates after blur.
        if (this.isTranscriptPreviewUrlFieldActive()) {
            return;
        }
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
            getAnnotationScope: () => this.resolvePreviewAnnotationScope(project, 'about:blank'),
            composerSession: this.host.resolveAnnotationComposerSession(),
        });
        this.wireTranscriptPreviewAnnotationScope(project, 'about:blank');
        this.host.transcriptEmbeddedPreview.root.classList.add('theia-mod-empty-preview');
        const input = this.host.transcriptEmbeddedPreview.root.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
        if (input) {
            input.value = '';
            input.placeholder = nls.localize('qaap/mobileProjects/previewUrlPlaceholder', 'Ingresa una URL');
        }
        // Play control lives in the Work Hub header (left of Change view). Keep the empty frame
        // chrome clear so the iframe URL field stays the only content affordance here.
        this.host.transcriptEmbeddedPreview.root.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
        this.syncHeaderPreviewRunButton(project, summary);
        this.annotateEmptyPreviewWhenNotRunnable(project, summary);
    }

    /**
     * A repo with no runnable app (no manifest, no index.html, no scaffolded subfolder — e.g. a
     * freshly created GitHub repo holding only a README) used to show a play button that silently
     * did nothing. Say so instead, reusing the ready-overlay typography.
     */
    protected annotateEmptyPreviewWhenNotRunnable(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const rootPath = this.resolveRunnableTranscriptProjectRoot(project, summary);
        const bootstrap = this.host.projectBootstrap;
        const frameSlot = this.host.transcriptEmbeddedPreview?.root.querySelector<HTMLElement>('.qaap-preview-frame-slot')
            ?? this.host.transcriptEmbeddedPreview?.root.querySelector<HTMLElement>('.qaap-preview-content-area');
        if (!frameSlot || !rootPath || typeof bootstrap?.describeRunnableApp !== 'function') {
            return;
        }
        void bootstrap.describeRunnableApp(FileUri.create(rootPath)).then(result => {
            if (result.runnable || !frameSlot.isConnected) {
                return;
            }
            if (this.host.transcriptOpenProject && this.host.transcriptOpenProject.id !== project.id) {
                return;
            }
            frameSlot.querySelector('.theia-mobile-transcript-preview-empty-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.className = 'theia-mobile-transcript-preview-empty-overlay';
            const wrap = document.createElement('div');
            wrap.className = 'theia-mobile-transcript-preview-empty';
            const note = document.createElement('div');
            note.className = 'theia-mobile-transcript-preview-ready';
            const title = document.createElement('div');
            title.className = 'theia-mobile-transcript-preview-ready-title';
            title.textContent = nls.localize('qaap/mobileProjects/previewNoApp', 'This repository does not have a runnable app yet');
            const detail = document.createElement('p');
            detail.className = 'theia-mobile-transcript-preview-ready-hint';
            detail.textContent = result.hint
                ?? nls.localize(
                    'qaap/mobileProjects/previewNoAppHint',
                    'No package.json or index.html was found. Ask the agent to generate the app, or upload the project code to this repository.',
                );
            note.append(title, detail);
            wrap.append(note);
            overlay.append(wrap);
            frameSlot.append(overlay);
            this.syncHeaderPreviewRunButton(project, summary);
        }).catch(() => undefined);
    }

    /**
     * Project root that is safe to hand to the dev-server bootstrap: the hub project's own cwd
     * first, then the session cwd only when it is a real per-project filesystem path (never the
     * shared container root).
     */
    protected resolveRunnableTranscriptProjectRoot(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string | undefined {
        const projectCwd = this.host.projectsService.getProjectCwd(project);
        if (projectCwd && !isQaapWorkspaceContainerPath(projectCwd)) {
            return projectCwd;
        }
        const sessionCwd = summary.cwd;
        if (sessionCwd
            && isTranscriptWorkspaceFilesystemPath(sessionCwd)
            && !isQaapWorkspaceContainerPath(sessionCwd)) {
            return sessionCwd;
        }
        return undefined;
    }

    /**
     * Workspace path for transcript Files/Terminal.
     * Hub project URI locally; on the VPS, {@link QaapAgentConversationSummaryDTO.cwd} wins for agent tasks.
     */
    resolveTranscriptProjectCwd(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): string | undefined {
        const resolved = resolveTranscriptWorkspaceCwd({
            summary,
            projectCwd: this.host.projectsService.getProjectCwd(project),
            preparedCwd: this.host.preparedCwdByProjectId.get(project.id),
        });
        if (resolved) {
            return resolved;
        }
        const workspaceCwd = this.host.projectsService.getCurrentWorkspaceCwd();
        if (
            workspaceCwd
            && !isQaapWorkspaceContainerPath(workspaceCwd)
            && this.host.projectsService.projectMatchesCurrentWorkspace(project)
        ) {
            return workspaceCwd;
        }
        const fromOpenSummary = this.host.transcriptOpenSummary?.cwd;
        if (
            fromOpenSummary
            && isTranscriptWorkspaceFilesystemPath(fromOpenSummary)
            && !isQaapWorkspaceContainerPath(fromOpenSummary)
        ) {
            return fromOpenSummary;
        }
        return undefined;
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
        if (!workspaceKey) {
            const workspaceCwd = this.host.projectsService.getCurrentWorkspaceCwd();
            if (
                workspaceCwd
                && !isQaapWorkspaceContainerPath(workspaceCwd)
                && this.host.projectsService.projectMatchesCurrentWorkspace(project)
            ) {
                this.host.preparedCwdByProjectId.set(project.id, workspaceCwd);
                this.ensureTranscriptFilesTab(project, summary);
                return;
            }
        }
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
                'Open or clone this project to browse its files.',
            );
            host.append(note);
            return;
        }
        if (this.host.transcriptFilesAttachedKey === workspaceKey && host.querySelector('.theia-mobile-transcript-files')) {
            this.syncHeaderFilesMoreButton(project, summary);
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
        this.syncHeaderFilesMoreButton(project, summary);
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
        toolbar.append(addBtn, switcher);

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
            await this.mountFreshTranscriptTerminalSlide(
                workspaceKey, cwd, services, project, summary, activateNewest,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Stale Work Hub PTY ids survive VPS/backend restarts in browser storage. Clear and retry once.
            if (isTerminalDoesNotExistError(message)) {
                try {
                    await services.saveWorkspaceState(workspaceKey, undefined);
                    await this.mountFreshTranscriptTerminalSlide(
                        workspaceKey, cwd, services, project, summary, activateNewest,
                    );
                    return;
                } catch (retryError) {
                    this.showTranscriptTerminalError(host, services, retryError);
                    return;
                }
            }
            this.showTranscriptTerminalError(host, services, error);
        }
    }

    protected async mountFreshTranscriptTerminalSlide(
        workspaceKey: TranscriptWorkspaceSurfaceKey,
        cwd: string,
        services: TranscriptTerminalViewServices,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        activateNewest: boolean,
    ): Promise<void> {
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
    }

    protected showTranscriptTerminalError(
        host: HTMLElement,
        services: TranscriptTerminalViewServices,
        error: unknown,
    ): void {
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

    /**
     * Opens (or focuses) the Terminal surface, creates a fresh PTY slide, and starts the
     * interactive agent CLI — same agents as chat, but as a TUI in the integrated terminal.
     */
    async launchAgentTuiInTranscriptTerminal(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        agentId: string,
        options?: { readonly login?: boolean },
    ): Promise<void> {
        const command = options?.login
            ? resolveInteractiveAgentLoginCommand(agentId)
            : resolveInteractiveAgentCliBin(agentId);
        if (!command) {
            return;
        }
        this.host.executionSurfaceTabsUi.selectTranscriptTab('terminal', project, summary);
        await this.ensureTranscriptTerminalTab(project, summary);
        const workspaceKey = this.resolveTranscriptWorkspaceKey(project, summary);
        const cwd = this.resolveTranscriptProjectCwd(project, summary);
        const services = this.host.createTranscriptTerminalViewServices?.();
        if (!workspaceKey || !cwd || !services) {
            return;
        }
        await this.createTranscriptTerminalSlide(workspaceKey, cwd, services, project, summary, true);
        const state = this.host.transcriptTerminalSlidesByWorkspace.get(workspaceKey);
        const surface = state?.surfaces[state.activeIndex];
        if (!surface || surface.terminal.isDisposed) {
            return;
        }
        const title = resolveAgentDisplayLabel(agentId);
        try {
            surface.terminal.title.label = options?.login
                ? nls.localize('qaap/mobileProjects/terminalAgentSignInTitle', 'Sign in · {0}', title)
                : title;
        } catch {
            /* title is best-effort */
        }
        this.renderTranscriptTerminalSlides(workspaceKey);
        await new Promise<void>(resolve => {
            window.setTimeout(resolve, 120);
        });
        if (!surface.terminal.isDisposed) {
            surface.terminal.sendText(`${command}\n`);
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
        this.hideHeaderFilesMoreButton();
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

    /** Marks open transcript terminals restorable and persists workspace tabs before reload. */
    prepareTranscriptTerminalsForPageUnload(): void {
        for (const [workspaceKey, state] of this.host.transcriptTerminalSlidesByWorkspace) {
            for (const surface of state.surfaces) {
                if (!surface.terminal.isDisposed) {
                    markTranscriptTerminalRestorable(surface.terminal);
                }
            }
            void this.persistTranscriptTerminalWorkspace(workspaceKey);
        }
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
        label.textContent = nls.localize('qaap/mobileProjects/previewLoading', 'Loading…');
        line.append(dot, label);
        wrap.append(line);
        return wrap;
    }

    async syncTranscriptPreviewFromConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,
    ): Promise<void> {
        if (this.host.transcriptPreviewSuppressedByUser) {
            return;
        }
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
            const conversationScopeId = this.previewScopeId(summary);
            const candidateUrl = this.resolveTranscriptPreviewUrl(latestProject, conv);
            if (candidateUrl === this.lastSyncedPreviewUrl(conversationScopeId)
                && this.mountedPreviewUrl(conversationScopeId) === candidateUrl
                && conv.status === 'streaming') {
                this.scheduleTranscriptPreviewTabProbe(latestProject, summary, conv);
                return;
            }
            this.setLastSyncedPreviewUrl(conversationScopeId, candidateUrl);
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
            const normalized = normalizePreviewUrlForSameOrigin(previewUrl);
            const parsed = new URL(normalized, window.location.href);
            const identityPath = parseQaapIdentityPreviewRequestPath(parsed.pathname);
            if (identityPath) {
                const probe = await probeQaapIdentityPreview(identityPath.previewId);
                if (!probe.ready) {
                    return false;
                }
                if (probe.projectId) {
                    const cwd = this.host.projectsService.getProjectCwd(project)
                        ?? this.host.preparedCwdByProjectId.get(project.id);
                    let cwdUri: string | undefined;
                    try {
                        cwdUri = cwd ? FileUri.create(cwd).toString() : undefined;
                    } catch {
                        cwdUri = undefined;
                    }
                    return qaapPreviewProjectIdMatches(
                        probe.projectId,
                        project.id,
                        project.uri?.toString(),
                        cwdUri,
                    );
                }
                // Legacy identity links predate project coordinates in the probe response. Keep
                // title matching only for that migration path, never as the primary identity.
            }
            // Hosted multi-tenant origins must never accept a preview by HTML title — two Vite apps
            // both titled "Vite App" would cross-mount across projects of the same user.
            if (!isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin())) {
                return false;
            }
            const response = await fetch(normalized, { cache: 'no-store' });
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
        // The preview registry knows the project's live claim even on hosted origins, where the
        // legacy localhost port-scan below is unavailable. This is what recovers a surface whose
        // stored URL was cleared after its claim was superseded by a newer run.
        const currentClaimUrl = await this.fetchCurrentProjectClaimUrl(project);
        if (currentClaimUrl && await this.previewUrlMatchesProject(currentClaimUrl, project)) {
            void this.host.projectsService.recordProjectPreviewUrl(project, currentClaimUrl);
            return currentClaimUrl;
        }
        if (!isLocalQaapPreviewOrigin(resolveDevPreviewPublicOrigin())) {
            return undefined;
        }
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

    beginTranscriptDevPreviewRequest(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        this.clearPreviewRuntimeForConversation(this.previewScopeId(summary));
        this.stopTranscriptPreviewTabProbe();
        const cleared = { ...project, previewUrl: undefined };
        this.host.projects = this.host.projects.map(candidate => candidate.id === cleared.id
            ? cleared
            : candidate);
        if (this.host.transcriptOpenProject?.id === cleared.id) {
            this.host.transcriptOpenProject = cleared;
        }
        this.syncHeaderPreviewRunButton(cleared, summary);
    }

    stageTranscriptPreviewReadyUrl(conversationScopeId: string, readyUrl: string): void {
        this.setProbeReadyPreviewUrl(conversationScopeId, readyUrl);
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
        const conversationScopeId = this.previewScopeId(conv ? { id: conv.id } : undefined);
        const storedUrl = project.previewUrl ? normalizePreviewUrlForSameOrigin(project.previewUrl) : undefined;
        const bootstrapUrl = this.bootstrapRunningPreviewUrl(project);
        // On the hosted multi-project runtime, an identity-scoped URL is authoritative. Agent
        // prose can still mention the package's hard-coded localhost/default port (for example
        // 8080) even though the allocator launched the process on 3000. Letting that hint win
        // discards a valid registry URL and can probe or display another unregistered process.
        // Keep conversation ports only as the legacy/local fallback when no stable identity is
        // available yet.
        const identityUrl = findQaapIdentityPreviewUrl(
            [storedUrl, bootstrapUrl],
            window.location.href,
        );
        if (identityUrl) {
            return identityUrl;
        }
        if (conv) {
            const fromConversation = findTranscriptPreviewUrlFromConversation(conv, window.location.origin);
            if (fromConversation) {
                return normalizePreviewUrlForSameOrigin(fromConversation);
            }
            if (this.host.transcriptPreviewRequestPending && conv.status === 'streaming') {
                return this.probeReadyPreviewUrl(conversationScopeId) ?? this.bootstrapRunningPreviewUrl(project);
            }
            if (conv.status === 'streaming' && conversationShouldWatchDevPreview(conv, window.location.origin)) {
                return this.bootstrapRunningPreviewUrl(project)
                    ?? this.probeReadyPreviewUrl(conversationScopeId)
                    ?? this.mountedPreviewUrl(conversationScopeId)
                    ?? undefined;
            }
        }
        if (this.host.transcriptPreviewRequestPending && conv?.status === 'streaming') {
            return undefined;
        }
        if (storedUrl) {
            return storedUrl;
        }
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
        this.host.transcriptPreviewSuppressedByUser = false;
        const launchGeneration = ++this.previewLaunchGeneration;
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/previewStarting', 'Levantando preview…'),
            { duration: 2200 },
        );
        // Keep the header play control mounted across the whole request lifecycle.
        this.syncHeaderPreviewRunButton(project, summary);
        const latestProject = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
        if (latestProject.previewUrl && this.host.onResumePreview) {
            if (launchGeneration !== this.previewLaunchGeneration || this.host.transcriptPreviewSuppressedByUser) {
                return;
            }
            await this.host.onResumePreview(latestProject);
            this.syncHeaderPreviewRunButton(project, summary);
            return;
        }

        const bootstrap = this.host.projectBootstrap;
        // Old sessions can carry a corrupt cwd (e.g. the bare `/workspace` container root from an
        // early agent run). Feeding that root to the bootstrap either stalls silently (no
        // package.json → no descriptor) or, worse, falls back to whatever workspace is currently
        // open and records ANOTHER project's preview URL onto this one. Validate first and fail
        // loudly instead.
        const projectRoot = this.resolveRunnableTranscriptProjectRoot(project, summary);
        if (bootstrap && !projectRoot) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/previewRootUnresolved',
                    'Could not resolve this project\'s folder — open the project and retry.'
                ),
                { kind: 'warning' },
            );
        }
        if (bootstrap && projectRoot) {
            const conversation = this.host.transcriptLastConv?.id === summary.id
                ? this.host.transcriptLastConv
                : undefined;
            void ensureTranscriptDevPreview(bootstrap, {
                conversation,
                conversationId: summary.id,
                projectId: project.id,
                workspaceRoot: projectRoot,
            }).then(readyUrl => {
                if (launchGeneration !== this.previewLaunchGeneration || this.host.transcriptPreviewSuppressedByUser) {
                    return;
                }
                if (!readyUrl) {
                    if (this.matchesActivePreviewSummary(summary)
                        && this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
                        MobileSnackbar.show(
                            nls.localize(
                                'qaap/mobileProjects/previewStartFailed',
                                'The dev server for {0} did not start. Check the Terminal view for details.',
                                project.name ?? project.id,
                            ),
                            { kind: 'warning' },
                        );
                    }
                    return;
                }
                // ALWAYS record the ready URL, even when the user stayed on the Chat view.
                // Recording only while the Preview tab was active meant a chat-dwelling user never
                // got `project.previewUrl` set, so the "Open preview" pill had no URL to offer —
                // the observed "the agent started the app but there is nothing to click" failure.
                const refreshed = this.host.projects.find(candidate => candidate.id === project.id) ?? project;
                this.host.projects = this.host.projects.map(candidate => candidate.id === refreshed.id
                    ? { ...candidate, previewUrl: readyUrl }
                    : candidate);
                void this.host.projectsService.recordProjectPreviewUrl({ ...refreshed, previewUrl: readyUrl }, readyUrl);
                if (!this.matchesActivePreviewSummary(summary)) {
                    return;
                }
                this.stageTranscriptPreviewReadyUrl(this.previewScopeId(summary), readyUrl);
                if (this.host.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
                    this.renderPreviewTab({ ...refreshed, previewUrl: readyUrl }, summary);
                } else {
                    this.host.transcriptScheduleRefresh?.();
                }
            });
        }

        const message = nls.localize(
            'qaap/mobileProjects/previewAgentRequest',
            'Prepare this app for live in-IDE preview. Qaap starts and keeps the dev server running in a dedicated terminal with hot reload — do NOT run long-lived dev commands in shell (pnpm dev, npm start, vite, next dev, etc.); shell tools time out after ~30s and break preview. Install dependencies only if node_modules is missing. Fix build/typecheck issues with one-shot commands. When ready, reply with the expected local port (e.g. 5173) and confirm dependencies are installed.',
        );
        this.host.transcriptPreviewRequestRunning = true;
        this.host.transcriptPreviewRequestPending = true;
        // Pin Preview before submit — create/open conversation paths force Messages and would
        // otherwise tear the header play control out mid-click.
        this.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
        this.updateTranscriptPreviewRunButtonState();
        if (summary.cwd) {
            this.host.setAutoVerifyEnabled(summary.cwd, true);
            this.host.refreshTranscriptChecksViews(project, summary);
        }
        this.renderPreviewTab(project, summary);
        this.syncHeaderPreviewRunButton(project, summary);
        try {
            await this.host.submitTranscriptViaBackendConversation(project, summary, message, {
                selectedAgentId: this.host.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                modeId: this.host.transcriptComposerModeId,
                approvalPolicyId: reconcileAgentApprovalPolicyId(
                    this.host.transcriptComposerApprovalPolicyId,
                    summary.cwd,
                ),
            });
            // Stop may have landed while submit was still creating the turn — cancel again now
            // that the request exists, same as composer Stop after the message is in flight.
            if (launchGeneration !== this.previewLaunchGeneration || this.host.transcriptPreviewSuppressedByUser) {
                this.cancelPreviewAgentTurn(project, summary);
                return;
            }
            this.host.transcriptScheduleRefresh?.();
        } catch (error) {
            if (launchGeneration !== this.previewLaunchGeneration || this.host.transcriptPreviewSuppressedByUser) {
                this.cancelPreviewAgentTurn(project, summary);
                return;
            }
            this.host.transcriptPreviewRequestPending = false;
            MobileSnackbar.show(error instanceof Error ? error.message : String(error), { kind: 'warning' });
        } finally {
            if (launchGeneration === this.previewLaunchGeneration && !this.host.transcriptPreviewSuppressedByUser) {
                this.host.transcriptPreviewRequestRunning = false;
                this.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'preview');
                this.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('preview');
                this.host.root.classList.toggle('theia-mod-project-surface-chat', false);
                this.host.root.classList.toggle('theia-mod-project-surface-tools', true);
                if (this.matchesActivePreviewSummary(summary) && this.transcriptPreviewProjectId === project.id) {
                    this.renderPreviewTab(project, summary);
                }
                this.syncHeaderPreviewRunButton(project, summary);
            } else {
                this.host.transcriptPreviewRequestRunning = false;
            }
        }
    }
}

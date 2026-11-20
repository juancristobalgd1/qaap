// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';
import {
    conversationToSummary,
    getConversation,
    QAAP_AGENT_CONVERSATION_API_PATH,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isAgentsHubIdleConversationSummary } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import {
    type ExecutionSurfaceTabId,
} from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { AIVariableResolutionRequest } from '@theia/ai-core';
import type { MobileComposerAttachHandlers } from '@theia/qaap-composer/lib/browser/qaap-mobile-composer-device-attach';
import type { TranscriptWorkspaceSurfacesCache } from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-workspace-surfaces-cache';
import type { MobileProjectsProjectDetailUi } from './mobile-projects-project-detail-ui';
import type { MobileProjectsTranscriptHeaderUi } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';
import { activateExecutionSurfaceTabExtracted, appendExecutionSurfaceTabStripToTitleRowExtracted, centerExecutionSurfaceActiveControlExtracted, closeExecutionSurfaceSidebarExtracted, directChildWithClassExtracted, dismissExecutionSurfaceSidebarExtracted, mountExecutionSurfaceTabContentExtracted, mountTranscriptExecutionHeaderExtracted, navigateExecutionSurfaceBackExtracted, openExecutionSurfaceSidebarExtracted, openExecutionSurfaceSidebarWhenReadyExtracted, cancelExecutionSurfaceSidebarOpenRetryExtracted, type ExecutionSurfaceSidebarOpenRetry, rebuildExecutionSurfaceTabStripsExtracted, refreshExecutionSurfaceTabStripStateExtracted, replaceExecutionSurfaceTabStripExtracted, resolveExecutionSurfaceProjectExtracted, resolveExecutionSurfaceTabStripHostExtracted, restoreActiveExecutionSurfaceExtracted, scheduleExecutionSurfaceFrameExtracted, showOnlyExecutionSurfaceTabExtracted, syncConnectedTranscriptSurfaceHostsExtracted, syncExecutionSurfaceChromeExtracted, syncExecutionSurfaceChromeInHostExtracted, syncHeaderExecutionTabStripExtracted, syncProjectDetailTabStripExtracted, syncSurfaceHostsFromContainerExtracted } from './mobile-projects-execution-surface-tabs-ui-render';
import { applyExecutionSurfaceIconSelectDisplayExtracted, buildExecutionViewTabStripExtracted, buildTranscriptTabStripExtracted, createExecutionSurfaceIconSelectExtracted, createTerminalAgentTuiSelectExtracted, executionSurfaceTabSpecsExtracted, executionTabOverflowMenuMinTopExtracted, openExecutionTabOverflowMenuExtracted, resolveExecutionTabOverflowMenuPortalExtracted, resolveTerminalAgentTuiActiveAgentIdExtracted, syncTerminalAgentTuiTriggerExtracted, syncTerminalAgentTuiTriggersInStripExtracted } from './mobile-projects-execution-surface-tabs-ui-streaming';
import { closeExecutionTabOverflowMenuExtracted, mountTranscriptSurfaceTabExtracted, positionExecutionTabOverflowMenuExtracted } from './mobile-projects-execution-surface-tabs-ui-timeline';
import { recordUserPreviewSurfaceChoiceExtracted } from './mobile-projects-execution-surface-tabs-ui-streaming';
import { isQaapWorkHubAuxPanelLayout, QaapWorkHubAuxPanel } from './qaap-work-hub-aux-panel';
import { MobileWorkHubAuxSheet, type MobileWorkHubAuxSheetTab } from './mobile-work-hub-aux-sheet';
import { openAgentLoginDialogInBackground } from './qaap-agent-login-background';
import { fetchAgentModelsForAgent } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { QaapLiveFeedFrame } from '@theia/qaap-shared-core/lib/common/qaap-live-feed-cursor';
import type { QaapWorkHubAuxSideChatHost, QaapWorkHubSideChatComposerSelection, QaapWorkHubSideChatModelOption, QaapWorkHubSideChatParent } from './qaap-work-hub-aux-side-chat-view';
import type { QaapWorkHubAuxPanelSurfaceKind } from './qaap-work-hub-aux-panel-model';
import { resolveQaapWorkHubPullRequestTarget, type QaapWorkHubPullRequestRef, type QaapWorkHubPullRequestTarget } from './qaap-work-hub-aux-pull-request-model';

type TranscriptTab = ExecutionSurfaceTabId;

/**
 * The desktop right panel is one per page, but the page can hold several Work Hub
 * panels (the Work Hub itself and the chat view embedded for the IDE). They share
 * the panel; the one the user acts on (or the one on screen) drives its views.
 */
const workHubAuxPanelUis = new Set<MobileProjectsExecutionSurfaceTabsUi>();
let workHubAuxPanel: QaapWorkHubAuxPanel | undefined;
let workHubAuxPanelOwner: MobileProjectsExecutionSurfaceTabsUi | undefined;
/** The narrow-viewport twin of the right panel: one bottom sheet per page, shared like the panel. */
let mobileAuxSheet: MobileWorkHubAuxSheet | undefined;

/** Live conversation feed for the side chat: one EventSource while its tab is shown; the view filters the frames. */
function subscribeWorkHubAuxSideChatLive(onFrame: (frame: QaapLiveFeedFrame) => void): Disposable {
    if (typeof EventSource === 'undefined') {
        return Disposable.NULL;
    }
    const source = new EventSource(`${QAAP_AGENT_CONVERSATION_API_PATH}/stream`);
    source.addEventListener('message', event => {
        try {
            onFrame(JSON.parse(String((event as MessageEvent).data)) as QaapLiveFeedFrame);
        } catch {
            // Not a frame this view understands.
        }
    });
    return Disposable.create(() => source.close());
}

/** The side chat's hooks into the Work Hub, routed to the current owner of the shared right panel. */
const workHubAuxSideChatHost: QaapWorkHubAuxSideChatHost = {
    resolveParent: () => resolveWorkHubAuxPanelOwner()?.resolveWorkHubAuxSideChatParent(),
    resolveComposerSelection: () => resolveWorkHubAuxPanelOwner()?.resolveWorkHubAuxSideChatComposerSelection(),
    listModels: () => resolveWorkHubAuxPanelOwner()?.listWorkHubAuxSideChatModels() ?? Promise.resolve([]),
    pickAttachments: (anchor, handlers) => resolveWorkHubAuxPanelOwner()?.pickWorkHubAuxSideChatAttachments(anchor, handlers) ?? Promise.resolve([]),
    prepareOutbound: (draft, variables) => resolveWorkHubAuxPanelOwner()?.prepareWorkHubAuxSideChatOutbound(draft, variables) ?? Promise.resolve(draft),
    startSignIn: agentId => resolveWorkHubAuxPanelOwner()?.startWorkHubAuxSideChatSignIn(agentId),
    openInMainArea: conversationId => resolveWorkHubAuxPanelOwner()?.openWorkHubAuxSideChatInMainArea(conversationId) ?? Promise.resolve(),
    subscribeLive: subscribeWorkHubAuxSideChatLive,
};

function resolveWorkHubAuxPanelOwner(): MobileProjectsExecutionSurfaceTabsUi | undefined {
    if (workHubAuxPanelOwner?.isRenderedOnScreen()) {
        return workHubAuxPanelOwner;
    }
    return [...workHubAuxPanelUis].find(ui => ui.isRenderedOnScreen()) ?? workHubAuxPanelOwner;
}

/**
 * The desktop right panel for the Settings header toggle: the same panel and claim the chat chevron uses.
 * `undefined` outside the desktop layout, where the Settings header has no right panel to toggle.
 */
export function resolveWorkHubAuxPanelForSettingsToggle(): QaapWorkHubAuxPanel | undefined {
    const owner = resolveWorkHubAuxPanelOwner() ?? [...workHubAuxPanelUis][0];
    return owner?.claimWorkHubAuxPanel();
}

/** Panel surface for execution-surface tab strips, overflow menu, and tab navigation. */
export interface MobileProjectsExecutionSurfaceTabsHost {
    readonly executionSurfaceTabByProjectId: Map<string, TranscriptTab>;
    /** Resolve the project directory that keys "preview closed by the user". */
    readonly projectsService?: {
        getProjectCwd(project: MobileProjectEntry): string | undefined;
        readonly windowService?: { openNewWindow(url: string, options?: { external?: boolean }): unknown };
    };
    readonly preparedCwdByProjectId?: ReadonlyMap<string, string>;
    transcriptTabStrip: HTMLElement | undefined;
    transcriptSheet: HTMLElement | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptChatInputHost: HTMLElement | undefined;
    transcriptReviewHost: HTMLElement | undefined;
    transcriptPreviewHost: HTMLElement | undefined;
    transcriptFilesHost: HTMLElement | undefined;
    transcriptTerminalHost: HTMLElement | undefined;
    transcriptTerminalToolbar: HTMLElement | undefined;
    transcriptTerminalPinnedMode: string | undefined;
    transcriptWorkspaceSurfaces: TranscriptWorkspaceSurfacesCache;
    transcriptHeaderSubtitle: HTMLElement | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    /** Opens a conversation in the main area; the side chat's Bring back uses the same call as the sidebar. */
    readonly conversationOpenUi?: { openConversationSummary(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void> };
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    headerViewModeSwitchHost?: HTMLElement;
    projectDetailTabStrip: HTMLElement | undefined;
    projectDetailSurfaceTargets: {
        chatHost: HTMLElement;
        reviewHost: HTMLElement;
        previewHost: HTMLElement;
        filesHost: HTMLElement;
        terminalHost: HTMLElement;
    } | undefined;
    headerExecutionTabsHost: HTMLElement;
    headerExecutionTabsProjectId: string | undefined;
    agentsHubShellActive: boolean;
    agentsHubInlineTranscriptRoot: HTMLElement | undefined;
    agentsHubInlineExecutionRoot: HTMLElement | undefined;
    agentsHubInlineTabStrip: HTMLElement | undefined;
    stickyComposerHost: HTMLElement;
    transcriptComposerMountKey?: string | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptStickyComposerUi: import('@theia/qaap-composer/lib/browser/mobile-projects-transcript-sticky-composer-ui').MobileProjectsTranscriptStickyComposerUi;
    stickyComposerSheetsUi?: import('@theia/qaap-composer/lib/browser/mobile-projects-sticky-composer-sheets-ui').MobileProjectsStickyComposerSheetsUi;
    root: HTMLElement;
    scroll: HTMLElement;
    executionTabOverflowMenu: HTMLElement | undefined;
    executionTabOverflowAnchor: HTMLButtonElement | undefined;
    executionTabOverflowDispose: Disposable;
    executionSurfaceSidebar: {
        element: HTMLElement;
        backdrop: HTMLElement;
        content: HTMLElement;
        activeHost?: HTMLElement;
        placeholder?: Comment;
        viewModeHost?: HTMLElement;
        viewModePlaceholder?: Comment;
        viewModeCandidate?: HTMLElement;
        viewModeObserver?: MutationObserver;
        previewHeaderHost?: HTMLElement;
        previewHeaderPlaceholder?: Comment;
        previewHeaderObserver?: MutationObserver;
        previewHeaderMount?: {
            attachPreviewHeaderHost?: (host: HTMLElement | undefined) => void;
            attachChangesHeaderActionHost?: (host: HTMLElement | undefined) => void;
        };
        previewChangesHeaderHost?: HTMLElement;
        toolbarHost?: HTMLElement;
        toolbarPlaceholder?: Comment;
        toolbarObserver?: MutationObserver;
        activeTab: TranscriptTab;
        project: MobileProjectEntry;
        summary: QaapAgentConversationSummaryDTO;
        origin: 'transcript' | 'project-detail';
        closeTimer?: number;
    } | undefined;
    expandedId: string | undefined;
    projectDetailExpandedId: string | undefined;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    transcriptSurfacesUi: MobileProjectsTranscriptSurfacesUi;
    projectDetailUi: MobileProjectsProjectDetailUi;
    openTranscriptChanges?: () => void | Promise<void>;

    /** The panel's attach menu and send hooks, used by the side chat's own composer. */
    pickContextVariable?: (anchor: HTMLElement, handlers: MobileComposerAttachHandlers) => Promise<AIVariableResolutionRequest[]>;
    expandComposerDraftForSubmit?: (draft: string) => Promise<string>;
    applyComposerAttachmentsToDraft?: (draft: string, variables?: AIVariableResolutionRequest[]) => Promise<string>;

    ensureAgentsHubExecutionShellRendered(): void;
    appendTranscriptHeaderActions(header: HTMLElement, title: HTMLElement): HTMLButtonElement;
    renderHeader(): void;
    renderSubtitle(): void;
    stickyComposerRenderUi: import('@theia/qaap-composer/lib/browser/mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    stickyComposerAgentsUi: import('@theia/qaap-composer/lib/browser/mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
    stickyComposerPinnedAgentId: string | undefined;
    resolveAgentsHubShellProject(): MobileProjectEntry | undefined;
    resolveAgentsHubShellSummary(project: MobileProjectEntry): QaapAgentConversationSummaryDTO;
    projectNavigationUi: import('./mobile-projects-project-navigation-ui').MobileProjectsProjectNavigationUi;
    hubQueryUi: import('@theia/qaap-shared-core/lib/browser/mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    isProjectDetailView(): boolean;
    openDesktopIdeFromAgentsHub(): Promise<void>;
    projects: MobileProjectEntry[];
    closeCardMenu(): void;
    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
    syncDesktopWorkHubLayout?(): void;
}

/** The open execution-surface sidebar drawer state. */
export type MobileProjectsExecutionSurfaceSidebarState = NonNullable<MobileProjectsExecutionSurfaceTabsHost['executionSurfaceSidebar']>;

/** Tab strip, overflow picker, and execution-surface visibility for transcript and project detail. */
export class MobileProjectsExecutionSurfaceTabsUi {
    /** @internal The single pending "open the sidebar once its host exists" retry, if any. */
    public executionSurfaceSidebarOpenRetry: ExecutionSurfaceSidebarOpenRetry | undefined;

    constructor(
        /** @internal Used by the extracted mobile-projects-execution-surface-tabs-ui-* modules. */
        public readonly host: MobileProjectsExecutionSurfaceTabsHost,
    ) { }

    resolveExecutionSurfaceProject(): MobileProjectEntry | undefined {
        return resolveExecutionSurfaceProjectExtracted(this);
    }

    activeExecutionTab(project?: MobileProjectEntry): TranscriptTab {
        const resolved = project ?? this.resolveExecutionSurfaceProject();
        return resolved ? this.executionSurfaceTabForProject(resolved) : 'messages';
    }

    executionSurfaceTabForProject(project: MobileProjectEntry): TranscriptTab {
        return this.host.executionSurfaceTabByProjectId.get(project.id) ?? 'messages';
    }

    /**
     * `true` while the conversation stays on screen: Chat is selected, or the desktop
     * Work Hub docks the views in the right panel beside it.
     */
    isChatSurfaceVisible(project: MobileProjectEntry): boolean {
        return this.executionSurfaceTabForProject(project) === 'messages' || !!this.resolveWorkHubAuxPanel();
    }

    /**
     * Shows Messages without undocking a surface from the desktop right panel: Chat already sits
     * beside the dock, so switching would dismiss the drawer, undock the panel's tab and leave its
     * empty state behind. Used by annotation Send and by opening a conversation.
     */
    showMessagesKeepingDock(project: MobileProjectEntry): void {
        if (this.host.executionSurfaceSidebar?.element.classList.contains('qaap-mod-docked')) {
            return;
        }
        this.setExecutionSurfaceTab(project, 'messages');
        this.showOnlyExecutionSurfaceTab('messages');
    }

    setExecutionSurfaceTab(project: MobileProjectEntry, tab: TranscriptTab): void {
        this.host.executionSurfaceTabByProjectId.set(project.id, tab);
        this.syncExecutionSurfaceChrome(project);
    }

    syncExecutionSurfaceChrome(project: MobileProjectEntry): void {
        syncExecutionSurfaceChromeExtracted(this, project);
    }

    syncExecutionSurfaceChromeInHost(host: HTMLElement, tab: TranscriptTab, linkStrip: (strip: HTMLElement) => void,): void {
        syncExecutionSurfaceChromeInHostExtracted(this, host, tab, linkStrip);
    }

    resolveExecutionSurfaceTabStripHost(strip: HTMLElement | undefined): HTMLElement | undefined {
        return resolveExecutionSurfaceTabStripHostExtracted(this, strip);
    }

    appendExecutionSurfaceTabStripToTitleRow(titleRow: HTMLElement, strip: HTMLElement): void {
        appendExecutionSurfaceTabStripToTitleRowExtracted(this, titleRow, strip);
    }

    mountTranscriptExecutionHeader(header: HTMLElement, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, titleText: string,): { back: HTMLButtonElement; tabStrip: HTMLElement } {
        return mountTranscriptExecutionHeaderExtracted(this, header, project, summary, titleText);
    }

    replaceExecutionSurfaceTabStrip(currentStrip: HTMLElement | undefined, nextStrip: HTMLElement): void {
        replaceExecutionSurfaceTabStripExtracted(this, currentStrip, nextStrip);
    }

    selectTranscriptTab(tab: TranscriptTab, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        this.activateExecutionSurfaceTab(tab, project, summary, 'transcript');
    }

    activateExecutionSurfaceTab(tab: TranscriptTab, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, origin: 'transcript' | 'project-detail',): void {
        activateExecutionSurfaceTabExtracted(this, tab, project, summary, origin);
    }

    showOnlyExecutionSurfaceTab(tab: TranscriptTab): void {
        showOnlyExecutionSurfaceTabExtracted(this, tab);
    }

    openExecutionSurfaceSidebar(
        tab: TranscriptTab,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        origin: 'transcript' | 'project-detail',
    ): void {
        openExecutionSurfaceSidebarExtracted(this, tab, project, summary, origin);
    }

    openExecutionSurfaceSidebarWhenReady(
        tab: TranscriptTab,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        origin: 'transcript' | 'project-detail',
    ): void {
        openExecutionSurfaceSidebarWhenReadyExtracted(this, tab, project, summary, origin);
    }

    /** Stops a pending {@link openExecutionSurfaceSidebarWhenReady} retry. */
    cancelExecutionSurfaceSidebarOpenRetry(): void {
        cancelExecutionSurfaceSidebarOpenRetryExtracted(this);
    }

    dispose(): void {
        this.cancelExecutionSurfaceSidebarOpenRetry();
        workHubAuxPanelUis.delete(this);
        if (workHubAuxPanelOwner === this) {
            workHubAuxPanelOwner = undefined;
        }
        if (!workHubAuxPanelUis.size) {
            workHubAuxPanel?.dispose();
            workHubAuxPanel = undefined;
            mobileAuxSheet?.dispose();
            mobileAuxSheet = undefined;
        }
    }

    /** @internal The conversation a side chat opens from: the one the main area shows, or `undefined` without a task. */
    resolveWorkHubAuxSideChatParent(): QaapWorkHubSideChatParent | undefined {
        const summary = this.host.executionSurfaceSidebar?.summary ?? this.host.transcriptOpenSummary;
        return summary ? { id: summary.id, title: summary.title, cwd: summary.cwd, agentId: summary.agentId } : undefined;
    }

    /**
     * @internal The harness and model the main composer shows now. The side chat selector starts from them;
     * `undefined` when the composer has no harness pinned, and the parent's harness applies instead.
     */
    resolveWorkHubAuxSideChatComposerSelection(): QaapWorkHubSideChatComposerSelection | undefined {
        const agentId = this.host.stickyComposerPinnedAgentId?.trim();
        if (!agentId) {
            return undefined;
        }
        const cwd = this.resolveWorkHubAuxSideChatParent()?.cwd;
        const agentModel = this.host.stickyComposerAgentsUi.resolveStickyComposerAgentModel(agentId, this.resolveExecutionSurfaceProject(), cwd);
        return { agentId, agentModel };
    }

    /**
     * @internal The models of the side chat's harness (the composer's, else the parent's) for the side chat selector.
     * A model the server does not mark available is treated as not signed in, so Pro stays locked until the session is confirmed.
     */
    async listWorkHubAuxSideChatModels(): Promise<readonly QaapWorkHubSideChatModelOption[]> {
        const parent = this.resolveWorkHubAuxSideChatParent();
        if (!parent) {
            return [];
        }
        // Every harness the main composer's picker offers (Settings → Harness applies), each with its own models.
        const project = this.resolveExecutionSurfaceProject();
        const composerAgents = this.host.stickyComposerAgentsUi;
        let catalog = composerAgents.getLoadedStickyComposerAgents();
        if (catalog.length === 0 && project) {
            catalog = await composerAgents.ensureStickyComposerAgentsLoaded(project).catch(() => []);
        }
        const agents = composerAgents.getComposerAgentPickerAgents(catalog);
        const lists = await Promise.all(agents.map(async agent => {
            const models = await fetchAgentModelsForAgent(agent.id).catch(() => []);
            return models.map(model => ({
                agentId: agent.id,
                agentLabel: agent.label || agent.id,
                modelLabel: model.label,
                agentModel: { provider: model.provider, vendor: model.vendor, modelId: model.modelId },
                tier: model.tier ?? 'pro',
                session: model.available === true
                    ? 'signed-in'
                    : model.unavailableReason === 'not-connected' ? 'signed-out'
                        : model.unavailableReason === 'checking' ? 'checking' : 'unknown',
            } satisfies QaapWorkHubSideChatModelOption));
        }));
        return lists.flat();
    }

    /** @internal The Work Hub's attach menu for the side chat's «+»: the main composer's menu, anchored to the side chat's button. */
    async pickWorkHubAuxSideChatAttachments(anchor: HTMLElement, handlers: MobileComposerAttachHandlers): Promise<readonly AIVariableResolutionRequest[]> {
        const pick = this.host.pickContextVariable;
        if (!pick) {
            return [];
        }
        const uploadTargetDir = this.resolveExecutionSurfaceProject()?.uri ?? handlers.uploadTargetDir;
        return pick(anchor, { ...handlers, uploadTargetDir });
    }

    /** @internal The outbound prompt of a side chat send: skills expanded, then the attachments applied, as the main submit does. */
    async prepareWorkHubAuxSideChatOutbound(draft: string, variables: readonly AIVariableResolutionRequest[]): Promise<string> {
        const expanded = (await this.host.expandComposerDraftForSubmit?.(draft)) ?? draft;
        if (variables.length === 0) {
            return expanded;
        }
        return (await this.host.applyComposerAttachmentsToDraft?.(expanded, [...variables])) ?? expanded;
    }

    /** @internal Opens the harness sign-in dialog the composer opens for the same agent. */
    startWorkHubAuxSideChatSignIn(agentId: string): void {
        const summary = this.host.transcriptOpenSummary ?? this.host.executionSurfaceSidebar?.summary;
        openAgentLoginDialogInBackground(this.host, this.resolveExecutionSurfaceProject(), summary, agentId);
    }

    /** @internal Opens a conversation in the main area with the same call the sidebar uses. */
    async openWorkHubAuxSideChatInMainArea(conversationId: string): Promise<void> {
        const project = this.resolveExecutionSurfaceProject();
        if (!project) {
            return;
        }
        const summary = conversationToSummary(await getConversation(conversationId));
        await this.host.conversationOpenUi?.openConversationSummary(project, summary);
    }

    /**
     * The desktop Work Hub right panel, or `undefined` on mobile and in the IDE
     * chat, where the chevron keeps opening the views menu and the full-screen drawer.
     */
    resolveWorkHubAuxPanel(): QaapWorkHubAuxPanel | undefined {
        if (!isQaapWorkHubAuxPanelLayout()) {
            return undefined;
        }
        workHubAuxPanelUis.add(this);
        workHubAuxPanelOwner ??= this;
        if (!workHubAuxPanel) {
            workHubAuxPanel = new QaapWorkHubAuxPanel({
                canShowSurfaces: () => !!resolveWorkHubAuxPanelOwner()?.resolveWorkHubAuxPanelTarget(),
                showSurface: kind => resolveWorkHubAuxPanelOwner()?.showWorkHubAuxPanelSurface(kind),
                releaseSurface: userClosed => resolveWorkHubAuxPanelOwner()?.releaseWorkHubAuxPanelSurface(userClosed),
                resolvePullRequestTarget: () => resolveWorkHubAuxPanelOwner()?.resolveWorkHubAuxPanelPullRequestTarget(),
                openExternal: url => resolveWorkHubAuxPanelOwner()?.openWorkHubAuxPanelExternal(url),
                sideChat: workHubAuxSideChatHost,
            });
        }
        return workHubAuxPanel;
    }

    /**
     * Hands a docked surface element back to the right panel even outside its layout. Switching to
     * the IDE leaves the Work Hub layout first, so {@link resolveWorkHubAuxPanel} is `undefined` there;
     * removing the element without telling the panel left it "docked" to a detached element, and the
     * Browser stayed black on the way back because the panel never asked for the surface again.
     */
    undockWorkHubAuxPanelSurface(element: HTMLElement): void {
        if (workHubAuxPanel) {
            workHubAuxPanel.undockSurface(element);
        } else {
            element.remove();
        }
    }

    /** Make this UI the one whose task the shared right panel shows, e.g. after the user acted on it. */
    claimWorkHubAuxPanel(): QaapWorkHubAuxPanel | undefined {
        const panel = this.resolveWorkHubAuxPanel();
        if (panel) {
            workHubAuxPanelOwner = this;
        }
        return panel;
    }

    /** `true` when this UI's Work Hub root is laid out (not a hidden twin). */
    isRenderedOnScreen(): boolean {
        const root = this.host.root;
        return root.isConnected && root.getClientRects().length > 0;
    }

    /** @internal The task the shared right panel mounts views for. */
    resolveWorkHubAuxPanelTarget(): {
        project: MobileProjectEntry;
        summary: QaapAgentConversationSummaryDTO;
        origin: 'transcript' | 'project-detail';
    } | undefined {
        const sidebar = this.host.executionSurfaceSidebar;
        const project = sidebar?.project ?? this.host.transcriptOpenProject ?? this.resolveExecutionSurfaceProject();
        if (!project) {
            return undefined;
        }
        const summary = sidebar?.summary
            ?? this.host.transcriptOpenSummary
            ?? (this.host.agentsHubShellActive ? this.host.resolveAgentsHubShellSummary(project) : undefined);
        return summary ? { project, summary, origin: sidebar?.origin ?? 'transcript' } : undefined;
    }

    /**
     * @internal The pull request the panel's "Pull request" view follows: the task's (or the project's when
     * no task is open). Needs only a project, so the view also works without an open task.
     */
    resolveWorkHubAuxPanelPullRequestTarget(): QaapWorkHubPullRequestTarget | undefined {
        const sidebar = this.host.executionSurfaceSidebar;
        const project = sidebar?.project ?? this.host.transcriptOpenProject ?? this.resolveExecutionSurfaceProject();
        if (!project) {
            return undefined;
        }
        const summary = sidebar?.summary
            ?? this.host.transcriptOpenSummary
            ?? (this.host.agentsHubShellActive ? this.host.resolveAgentsHubShellSummary(project) : undefined);
        return resolveQaapWorkHubPullRequestTarget(project, summary);
    }

    /**
     * The narrow-viewport "Side chat" / "Pull request" bottom sheet, or `undefined` outside the mobile layout (the
     * desktop right panel owns those views there). Created once; the views inside are the desktop panel's classes.
     */
    resolveMobileAuxSheet(): MobileWorkHubAuxSheet | undefined {
        if (!matchesMobileNarrowViewport() || this.resolveWorkHubAuxPanel()) {
            return undefined;
        }
        workHubAuxPanelUis.add(this);
        workHubAuxPanelOwner ??= this;
        if (!mobileAuxSheet) {
            mobileAuxSheet = new MobileWorkHubAuxSheet({
                host: {
                    resolvePullRequestTarget: () => resolveWorkHubAuxPanelOwner()?.resolveWorkHubAuxPanelPullRequestTarget(),
                    openExternal: url => resolveWorkHubAuxPanelOwner()?.openWorkHubAuxPanelExternal(url),
                    sideChat: workHubAuxSideChatHost,
                },
            });
        }
        return mobileAuxSheet;
    }

    /**
     * `true` when a real conversation (not the idle landing composer) is open, so the mobile views
     * dropdown enables "Side chat" and "Pull request".
     */
    hasOpenConversationForMobileAuxSheet(): boolean {
        const summary = this.host.transcriptOpenSummary;
        return !!this.host.transcriptOpenProject
            && !!summary
            && !isAgentsHubIdleConversationSummary(summary);
    }

    /**
     * Opens the mobile sheet on `tab` for the conversation this UI shows. `false` outside the mobile layout.
     * A `pullRequest` ref (a transcript chip) shows exactly that pull request.
     */
    openMobileAuxSheet(tab: MobileWorkHubAuxSheetTab, pullRequest?: QaapWorkHubPullRequestRef): boolean {
        const sheet = this.resolveMobileAuxSheet();
        if (!sheet) {
            return false;
        }
        workHubAuxPanelOwner = this;
        sheet.open(tab, pullRequest);
        return true;
    }

    /**
     * Shows exactly `ref` in the desktop right panel's "Pull request" tab (a pull request mentioned in
     * the transcript); on mobile, in the bottom sheet's "Pull request" tab. `false` in the IDE chat.
     */
    openPullRequestInWorkHubAuxPanel(ref: QaapWorkHubPullRequestRef): boolean {
        return this.claimWorkHubAuxPanel()?.openPullRequest(ref) === true || this.openMobileAuxSheet('pull-request', ref);
    }

    /**
     * @internal Desktop: the system browser through the Theia window service. Web: the service opens a new tab.
     * Falls back to a plain new tab when no project service is wired.
     */
    openWorkHubAuxPanelExternal(url: string): void {
        const windowService = this.host.projectsService?.windowService;
        if (windowService) {
            windowService.openNewWindow(url, { external: true });
        } else {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }

    /** @internal */
    showWorkHubAuxPanelSurface(kind: QaapWorkHubAuxPanelSurfaceKind): void {
        const target = this.resolveWorkHubAuxPanelTarget();
        if (!target) {
            return;
        }
        // Changes is the files surface in Changes mode: the existing 'review' tab opens it that way.
        const tab = kind === 'changes' ? 'review' : kind;
        recordUserPreviewSurfaceChoiceExtracted(this, tab);
        this.activateExecutionSurfaceTab(tab, target.project, target.summary, target.origin);
    }

    /** @internal */
    releaseWorkHubAuxPanelSurface(userClosed: boolean): void {
        if (userClosed) {
            this.closeExecutionSurfaceSidebar();
            return;
        }
        const target = this.resolveWorkHubAuxPanelTarget();
        if (target) {
            // Back to Chat, so a header rebuild does not re-dock the view under the launcher.
            this.activateExecutionSurfaceTab('messages', target.project, target.summary, target.origin);
        } else {
            this.dismissExecutionSurfaceSidebar();
        }
    }

    closeExecutionSurfaceSidebar(): void {
        closeExecutionSurfaceSidebarExtracted(this);
    }

    dismissExecutionSurfaceSidebar(): void {
        dismissExecutionSurfaceSidebarExtracted(this);
    }

    /** Restore the project-owned surface after a shell/header rebuild without changing its state. */
    restoreActiveExecutionSurface(project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO): void {
        restoreActiveExecutionSurfaceExtracted(this, project, summary);
    }

    /** @internal Used by the extracted mobile-projects-execution-surface-tabs-ui-* modules. */
    public syncConnectedTranscriptSurfaceHosts(): void {
        syncConnectedTranscriptSurfaceHostsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-execution-surface-tabs-ui-* modules. */
    public syncSurfaceHostsFromContainer(container: HTMLElement): void {
        syncSurfaceHostsFromContainerExtracted(this, container);
    }

    /** @internal Used by the extracted mobile-projects-execution-surface-tabs-ui-* modules. */
    public directChildWithClass(parent: HTMLElement, className: string): HTMLElement | undefined {
        return directChildWithClassExtracted(this, parent, className);
    }

    mountExecutionSurfaceTabContent(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, tab: TranscriptTab,): void {
        mountExecutionSurfaceTabContentExtracted(this, project, summary, tab);
    }

    syncHeaderExecutionTabStrip(): void {
        syncHeaderExecutionTabStripExtracted(this);
    }

    syncProjectDetailTabStrip(): void {
        syncProjectDetailTabStripExtracted(this);
    }

    rebuildExecutionSurfaceTabStrips(project: MobileProjectEntry, activeTab: TranscriptTab): void {
        rebuildExecutionSurfaceTabStripsExtracted(this, project, activeTab);
    }

    refreshExecutionSurfaceTabStripState(strip: HTMLElement, activeTab: TranscriptTab): void {
        refreshExecutionSurfaceTabStripStateExtracted(this, strip, activeTab);
    }

    /** @internal Used by the extracted mobile-projects-execution-surface-tabs-ui-* modules. */
    public centerExecutionSurfaceActiveControl(strip: HTMLElement): void {
        centerExecutionSurfaceActiveControlExtracted(this, strip);
    }

    /** @internal Used by the extracted mobile-projects-execution-surface-tabs-ui-* modules. */
    public scheduleExecutionSurfaceFrame(callback: () => void): void {
        scheduleExecutionSurfaceFrameExtracted(this, callback);
    }

    resolveExecutionSurfaceIconSelectDisplayTab(activeTab: TranscriptTab): TranscriptTab {
        if (this.resolveWorkHubAuxPanel()) {
            // The chevron toggles the right panel; the views live there, the chip stays on Chat.
            return 'messages';
        }
        // 'review' (Changes) is now merged into the 'files' tab — display as 'files'.
        return activeTab === 'review' ? 'files' : activeTab;
    }

    navigateExecutionSurfaceBack(project: MobileProjectEntry): boolean {
        return navigateExecutionSurfaceBackExtracted(this, project);
    }

    applyExecutionSurfaceIconSelectDisplay(strip: HTMLElement, activeTab: TranscriptTab): void {
        applyExecutionSurfaceIconSelectDisplayExtracted(this, strip, activeTab);
    }

    buildTranscriptTabStrip(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): HTMLElement {
        return buildTranscriptTabStripExtracted(this, project, summary);
    }

    buildExecutionViewTabStrip(activeTab: TranscriptTab, onSelect: (tab: TranscriptTab) => void,): HTMLElement {
        return buildExecutionViewTabStripExtracted(this, activeTab, onSelect);
    }

    createTerminalAgentTuiSelect(): HTMLElement {
        return createTerminalAgentTuiSelectExtracted(this);
    }

    resolveTerminalAgentTuiActiveAgentId(project?: MobileProjectEntry): string | undefined {
        return resolveTerminalAgentTuiActiveAgentIdExtracted(this, project);
    }

    syncTerminalAgentTuiTriggersInStrip(strip: HTMLElement): void {
        syncTerminalAgentTuiTriggersInStripExtracted(this, strip);
    }

    syncTerminalAgentTuiTrigger(trigger: HTMLButtonElement, agentId?: string): void {
        syncTerminalAgentTuiTriggerExtracted(this, trigger, agentId);
    }

    executionSurfaceTabSpecs(): Array<{ id: TranscriptTab; label: string; icon: string }> {
        return executionSurfaceTabSpecsExtracted(this);
    }

    createExecutionSurfaceIconSelect(displayTabId: TranscriptTab, activeTab: TranscriptTab, tabSpecs: Array<{ id: TranscriptTab; label: string; icon: string }>, onSelect: (tab: TranscriptTab) => void,): HTMLElement {
        return createExecutionSurfaceIconSelectExtracted(this, displayTabId, activeTab, tabSpecs, onSelect);
    }

    resolveExecutionTabOverflowMenuPortal(anchor: HTMLElement): HTMLElement {
        return resolveExecutionTabOverflowMenuPortalExtracted(this, anchor);
    }

    openExecutionTabOverflowMenu(anchor: HTMLButtonElement, menu: HTMLElement): void {
        openExecutionTabOverflowMenuExtracted(this, anchor, menu);
    }

    executionTabOverflowMenuMinTop(anchor: HTMLElement): number {
        return executionTabOverflowMenuMinTopExtracted(this, anchor);
    }

    positionExecutionTabOverflowMenu(menu: HTMLElement, anchor: HTMLElement): void {
        positionExecutionTabOverflowMenuExtracted(this, menu, anchor);
    }

    closeExecutionTabOverflowMenu(): void {
        closeExecutionTabOverflowMenuExtracted(this);
    }

    mountTranscriptSurfaceTab(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, tab: TranscriptTab,): void {
        mountTranscriptSurfaceTabExtracted(this, project, summary, tab);
    }
}

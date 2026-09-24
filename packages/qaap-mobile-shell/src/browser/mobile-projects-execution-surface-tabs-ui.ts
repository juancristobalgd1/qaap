// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    type ExecutionSurfaceTabId,
} from '@theia/qaap-shared-core/lib/common/qaap-execution-surface-tabs';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { TranscriptWorkspaceSurfacesCache } from '@theia/qaap-transcript-overlay/lib/browser/qaap-transcript-workspace-surfaces-cache';
import type { MobileProjectsProjectDetailUi } from './mobile-projects-project-detail-ui';
import type { MobileProjectsTranscriptHeaderUi } from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';
import { activateExecutionSurfaceTabExtracted, appendExecutionSurfaceTabStripToTitleRowExtracted, centerExecutionSurfaceActiveControlExtracted, closeExecutionSurfaceSidebarExtracted, directChildWithClassExtracted, dismissExecutionSurfaceSidebarExtracted, mountExecutionSurfaceTabContentExtracted, mountTranscriptExecutionHeaderExtracted, navigateExecutionSurfaceBackExtracted, openExecutionSurfaceSidebarExtracted, openExecutionSurfaceSidebarWhenReadyExtracted, rebuildExecutionSurfaceTabStripsExtracted, refreshExecutionSurfaceTabStripStateExtracted, replaceExecutionSurfaceTabStripExtracted, resolveExecutionSurfaceProjectExtracted, resolveExecutionSurfaceTabStripHostExtracted, restoreActiveExecutionSurfaceExtracted, scheduleExecutionSurfaceFrameExtracted, showOnlyExecutionSurfaceTabExtracted, syncConnectedTranscriptSurfaceHostsExtracted, syncExecutionSurfaceChromeExtracted, syncExecutionSurfaceChromeInHostExtracted, syncHeaderExecutionTabStripExtracted, syncProjectDetailTabStripExtracted, syncSurfaceHostsFromContainerExtracted } from './mobile-projects-execution-surface-tabs-ui-render';
import { applyExecutionSurfaceIconSelectDisplayExtracted, buildExecutionViewTabStripExtracted, buildTranscriptTabStripExtracted, createExecutionSurfaceIconSelectExtracted, createTerminalAgentTuiSelectExtracted, executionSurfaceTabSpecsExtracted, executionTabOverflowMenuMinTopExtracted, openExecutionTabOverflowMenuExtracted, resolveExecutionTabOverflowMenuPortalExtracted, resolveTerminalAgentTuiActiveAgentIdExtracted, syncTerminalAgentTuiTriggerExtracted, syncTerminalAgentTuiTriggersInStripExtracted } from './mobile-projects-execution-surface-tabs-ui-streaming';
import { closeExecutionTabOverflowMenuExtracted, mountTranscriptSurfaceTabExtracted, positionExecutionTabOverflowMenuExtracted } from './mobile-projects-execution-surface-tabs-ui-timeline';

type TranscriptTab = ExecutionSurfaceTabId;

/** Panel surface for execution-surface tab strips, overflow menu, and tab navigation. */
export interface MobileProjectsExecutionSurfaceTabsHost {
    readonly executionSurfaceTabByProjectId: Map<string, TranscriptTab>;
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
    transcriptStickyComposerUi: import('./mobile-projects-transcript-sticky-composer-ui').MobileProjectsTranscriptStickyComposerUi;
    stickyComposerSheetsUi?: import('./mobile-projects-sticky-composer-sheets-ui').MobileProjectsStickyComposerSheetsUi;
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

    ensureAgentsHubExecutionShellRendered(): void;
    appendTranscriptHeaderActions(header: HTMLElement, title: HTMLElement): HTMLButtonElement;
    renderHeader(): void;
    renderSubtitle(): void;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    stickyComposerAgentsUi: import('./mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
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

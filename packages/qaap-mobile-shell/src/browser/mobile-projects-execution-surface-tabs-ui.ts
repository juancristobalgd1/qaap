// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    type ExecutionSurfaceTabId,
    recordExecutionSurfaceTabUse,
} from '../common/qaap-execution-surface-tabs';
import {
    appendExecutionSurfaceTabIcon,
    createExecutionSurfaceIconElement,
    isExecutionSurfaceIconElement,
    QAAP_MESSAGE_CIRCLE_ICON_CLASS,
    QAAP_SCM_CHANGES_ICON_CLASS,
} from '../common/qaap-scm-changes-icon';
import { applyExecutionSurfaceHeaderChrome, queryExecutionSurfaceViewSelect } from './qaap-execution-surface-header-chrome';
import { appendAgentBrandIcon, createAgentBrandIcon } from '../common/qaap-agent-branding';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { resolveInteractiveAgentCliBin } from '../common/qaap-agent-tui-command';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsProjectDetailUi } from './mobile-projects-project-detail-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';
import { activateExecutionSurfaceTabExtracted, appendExecutionSurfaceTabStripToTitleRowExtracted, centerExecutionSurfaceActiveControlExtracted, directChildWithClassExtracted, mountExecutionSurfaceTabContentExtracted, mountTranscriptExecutionHeaderExtracted, navigateExecutionSurfaceBackExtracted, rebuildExecutionSurfaceTabStripsExtracted, refreshExecutionSurfaceTabStripStateExtracted, replaceExecutionSurfaceTabStripExtracted, resolveExecutionSurfaceProjectExtracted, resolveExecutionSurfaceTabStripHostExtracted, restoreActiveExecutionSurfaceExtracted, scheduleExecutionSurfaceFrameExtracted, showOnlyExecutionSurfaceTabExtracted, syncConnectedTranscriptSurfaceHostsExtracted, syncExecutionSurfaceChromeExtracted, syncExecutionSurfaceChromeInHostExtracted, syncHeaderExecutionTabStripExtracted, syncProjectDetailTabStripExtracted, syncSurfaceHostsFromContainerExtracted, syncTranscriptTabStripExtracted } from './mobile-projects-execution-surface-tabs-ui-render2';
import { applyExecutionSurfaceIconSelectDisplayExtracted, buildExecutionViewTabStripExtracted, buildTranscriptTabStripExtracted, createExecutionSurfaceIconSelectExtracted, createTerminalAgentTuiSelectExtracted, executionSurfaceTabSpecsExtracted, executionTabOverflowMenuMinTopExtracted, openExecutionTabOverflowMenuExtracted, resolveExecutionTabOverflowMenuPortalExtracted, resolveTerminalAgentTuiActiveAgentIdExtracted, syncTerminalAgentTuiTriggerExtracted, syncTerminalAgentTuiTriggersInStripExtracted } from './mobile-projects-execution-surface-tabs-ui-streaming2';
import { closeExecutionTabOverflowMenuExtracted, mountTranscriptSurfaceTabExtracted, positionExecutionTabOverflowMenuExtracted } from './mobile-projects-execution-surface-tabs-ui-timeline2';

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
    transcriptHeaderSubtitle: HTMLElement | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
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
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    isProjectDetailView(): boolean;
    openDesktopIdeFromAgentsHub(): Promise<void>;
    projects: MobileProjectEntry[];
    closeCardMenu(): void;
    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
    syncDesktopWorkHubLayout?(): void;
}

/** Tab strip, overflow picker, and execution-surface visibility for transcript and project detail. */
export class MobileProjectsExecutionSurfaceTabsUi {

    constructor(protected readonly host: MobileProjectsExecutionSurfaceTabsHost) { }

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

    /** Restore the project-owned surface after a shell/header rebuild without changing its state. */
    restoreActiveExecutionSurface(project: MobileProjectEntry, summary?: QaapAgentConversationSummaryDTO): void {
        restoreActiveExecutionSurfaceExtracted(this, project, summary);
    }

    protected syncConnectedTranscriptSurfaceHosts(): void {
        syncConnectedTranscriptSurfaceHostsExtracted(this);
    }

    protected syncSurfaceHostsFromContainer(container: HTMLElement): void {
        syncSurfaceHostsFromContainerExtracted(this, container);
    }

    protected directChildWithClass(parent: HTMLElement, className: string): HTMLElement | undefined {
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

    syncTranscriptTabStrip(project: MobileProjectEntry): void {
        syncTranscriptTabStripExtracted(this, project);
    }

    rebuildExecutionSurfaceTabStrips(project: MobileProjectEntry, activeTab: TranscriptTab): void {
        rebuildExecutionSurfaceTabStripsExtracted(this, project, activeTab);
    }

    refreshExecutionSurfaceTabStripState(strip: HTMLElement, activeTab: TranscriptTab): void {
        refreshExecutionSurfaceTabStripStateExtracted(this, strip, activeTab);
    }

    protected centerExecutionSurfaceActiveControl(strip: HTMLElement): void {
        centerExecutionSurfaceActiveControlExtracted(this, strip);
    }

    protected scheduleExecutionSurfaceFrame(callback: () => void): void {
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

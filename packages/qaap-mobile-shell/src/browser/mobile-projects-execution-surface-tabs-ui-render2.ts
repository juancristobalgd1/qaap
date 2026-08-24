// @ts-nocheck
// Extracted from mobile-projects-execution-surface-tabs-ui.ts

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
import { writePendingTranscriptFilesViewMode } from './qaap-transcript-files-view';
import { peekPreferDesktopIde } from './mobile-projects-open';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsProjectDetailUi } from './mobile-projects-project-detail-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSurfacesUi } from './mobile-projects-transcript-surfaces-ui';

export function resolveExecutionSurfaceProjectExtracted(ctx: any): MobileProjectEntry | undefined {
    const projectId = ctx.host.projectDetailExpandedId ?? ctx.host.expandedId;
    if (projectId) {
        return ctx.host.projects.find(p => p.id === projectId)
            ?? ctx.host.hubQueryUi.projectsForCurrentHubList().find(p => p.id === projectId);
    }
    // Agents Hub shell keeps the workspace project via agentsHubSelectedProjectId /
    // resolveCurrentWorkspaceProject — not expandedId (cleared on activateAgentsHubProject).
    if (ctx.host.agentsHubShellActive) {
        return ctx.host.resolveAgentsHubShellProject();
    }
    return undefined;
}

export function syncExecutionSurfaceChromeExtracted(ctx: any, project: MobileProjectEntry): void {
    const tab = ctx.executionSurfaceTabForProject(project);
    ctx.syncExecutionSurfaceChromeInHost(ctx.host.headerExecutionTabsHost, tab, linked => {
        ctx.host.projectDetailTabStrip = linked;
    });
    if (ctx.host.transcriptSheet?.isConnected) {
        ctx.syncExecutionSurfaceChromeInHost(ctx.host.transcriptSheet, tab, linked => {
            ctx.host.transcriptTabStrip = linked;
        });
    } else if (ctx.host.transcriptTabStrip?.isConnected) {
        ctx.refreshExecutionSurfaceTabStripState(ctx.host.transcriptTabStrip, tab);
    }
}

export function syncExecutionSurfaceChromeInHostExtracted(ctx: any, host: HTMLElement,
    tab: TranscriptTab,
    linkStrip: (strip: HTMLElement) => void,): void {
    const strips = host.querySelectorAll<HTMLElement>('.theia-mobile-transcript-tabs.theia-mod-header-inline');
    if (strips.length === 0) {
        return;
    }
    strips.forEach(strip => ctx.refreshExecutionSurfaceTabStripState(strip, tab));
    linkStrip(strips[strips.length - 1]!);
}

export function resolveExecutionSurfaceTabStripHostExtracted(ctx: any, strip: HTMLElement | undefined): HTMLElement | undefined {
    if (!strip) {
        return undefined;
    }
    const host = strip.closest('.theia-mobile-projects-header-execution-tabs');
    return host instanceof HTMLElement ? host : strip.parentElement ?? undefined;
}

export function appendExecutionSurfaceTabStripToTitleRowExtracted(ctx: any, titleRow: HTMLElement, strip: HTMLElement): void {
    const host = document.createElement('div');
    host.className = 'theia-mobile-projects-header-execution-tabs';
    host.append(strip);
    titleRow.append(host);
}

export function mountTranscriptExecutionHeaderExtracted(ctx: any, header: HTMLElement,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    titleText: string,): { back: HTMLButtonElement; tabStrip: HTMLElement } {
    header.classList.add('theia-mod-execution-tabs');
    const title = document.createElement('h2');
    title.textContent = titleText;
    const back = ctx.host.appendTranscriptHeaderActions(header, title);
    ctx.host.transcriptHeaderSubtitle = undefined;
    ctx.host.transcriptSurfacesUi.updateTranscriptHeader(project, summary);
    const activeTab = ctx.executionSurfaceTabForProject(project);
    const tabStrip = ctx.buildTranscriptTabStrip(project, summary);
    const titleRow = header.querySelector('.theia-mobile-agent-log-title-row');
    if (titleRow instanceof HTMLElement) {
        ctx.appendExecutionSurfaceTabStripToTitleRow(titleRow, tabStrip);
    }
    ctx.refreshExecutionSurfaceTabStripState(tabStrip, activeTab);
    return { back, tabStrip };
}

export function restoreActiveExecutionSurfaceExtracted(ctx: any, project: MobileProjectEntry,
    summary?: QaapAgentConversationSummaryDTO,): void {
    let activeTab = ctx.executionSurfaceTabForProject(project);
    if (activeTab === 'review') {
        // Changes is represented by the Files surface; normalize old in-memory state too.
        activeTab = 'files';
        ctx.host.executionSurfaceTabByProjectId.set(project.id, activeTab);
    }
    ctx.showOnlyExecutionSurfaceTab(activeTab);
    const activeSummary = summary
        ?? ctx.host.transcriptOpenSummary
        ?? (ctx.host.agentsHubShellActive ? ctx.host.resolveAgentsHubShellSummary?.(project) : undefined);
    if (activeSummary) {
        ctx.mountExecutionSurfaceTabContent(project, activeSummary, activeTab);
    }
    ctx.syncExecutionSurfaceChrome(project);
}

export function replaceExecutionSurfaceTabStripExtracted(ctx: any, currentStrip: HTMLElement | undefined, nextStrip: HTMLElement): void {
    const host = ctx.resolveExecutionSurfaceTabStripHost(currentStrip);
    if (host) {
        host.replaceChildren(nextStrip);
        return;
    }
    currentStrip?.replaceWith(nextStrip);
}

export function activateExecutionSurfaceTabExtracted(ctx: any, tab: TranscriptTab,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    origin: 'transcript' | 'project-detail',): void {
    if (tab === 'review' && peekPreferDesktopIde()) {
        void ctx.host.openTranscriptChanges?.();
        return;
    }
    // 'review' (Changes) is merged into the 'files' tab — redirect with a
    // pending view-mode flag so the file view activates changes mode on mount.
    if (tab === 'review') {
        writePendingTranscriptFilesViewMode('changes');
        tab = 'files';
    }
    const sameTab = ctx.executionSurfaceTabForProject(project) === tab;
    if (sameTab) {
        // Persist even an explicit Chat selection; re-renders must not infer state from a
        // missing map entry and silently choose a default later.
        ctx.setExecutionSurfaceTab(project, tab);
        ctx.syncExecutionSurfaceChrome(project);
        if (tab === 'messages') {
            ctx.closeExecutionTabOverflowMenu();
        }
    } else {
        recordExecutionSurfaceTabUse(tab);
        ctx.setExecutionSurfaceTab(project, tab);
        ctx.rebuildExecutionSurfaceTabStrips(project, tab);
        if (origin === 'transcript') {
            ctx.host.transcriptSurfacesUi.updateTranscriptHeader(project);
        } else {
            ctx.host.renderHeader();
            ctx.host.renderSubtitle();
        }
    }
    if (ctx.host.agentsHubShellActive && tab !== 'messages') {
        ctx.host.ensureAgentsHubExecutionShellRendered();
    }
    ctx.showOnlyExecutionSurfaceTab(tab);
    ctx.mountExecutionSurfaceTabContent(project, summary, tab);
    ctx.host.root.classList.toggle('theia-mod-project-surface-chat', tab === 'messages');
    ctx.host.root.classList.toggle('theia-mod-project-surface-tools', tab !== 'messages');
    ctx.host.stickyComposerRenderUi.renderStickyComposer();
    ctx.syncExecutionSurfaceChrome(project);
    ctx.host.renderHeader();
    if (tab === 'preview') {
        ctx.host.transcriptSurfacesUi.syncHeaderPreviewRunButton(project, summary);
    } else {
        ctx.host.transcriptSurfacesUi.hideHeaderPreviewRunButton();
    }
    if (tab === 'files') {
        ctx.host.transcriptSurfacesUi.syncHeaderFilesMoreButton(project, summary);
        ctx.host.transcriptSurfacesUi.syncHeaderViewModeSwitch(project, summary);
    } else {
        ctx.host.transcriptSurfacesUi.hideHeaderFilesMoreButton();
        ctx.host.transcriptSurfacesUi.hideHeaderViewModeSwitch();
    }
    ctx.host.syncDesktopWorkHubLayout?.();
}

export function showOnlyExecutionSurfaceTabExtracted(ctx: any, tab: TranscriptTab): void {
    ctx.syncConnectedTranscriptSurfaceHosts();
    const activeSurface = tab === 'review' ? 'files' : tab;
    const showMessages = activeSurface === 'messages';
    // 'review' is merged into 'files' — show the files host for both.
    const showFiles = activeSurface === 'files';
    if (ctx.host.agentsHubInlineTranscriptRoot) {
        ctx.host.agentsHubInlineTranscriptRoot.hidden = !showMessages;
    }
    if (ctx.host.transcriptChatHost) {
        ctx.host.transcriptChatHost.hidden = !showMessages;
    }
    if (ctx.host.transcriptChatInputHost) {
        ctx.host.transcriptChatInputHost.hidden = !showMessages;
    }
    if (ctx.host.transcriptReviewHost) {
        ctx.host.transcriptReviewHost.hidden = true;
    }
    if (ctx.host.transcriptPreviewHost) {
        ctx.host.transcriptPreviewHost.hidden = activeSurface !== 'preview';
    }
    if (ctx.host.transcriptFilesHost) {
        ctx.host.transcriptFilesHost.hidden = !showFiles;
    }
    if (ctx.host.transcriptTerminalHost) {
        ctx.host.transcriptTerminalHost.hidden = activeSurface !== 'terminal';
    }
    const targets = ctx.host.projectDetailSurfaceTargets;
    if (targets) {
        targets.chatHost.hidden = !showMessages;
        targets.reviewHost.hidden = true;
        targets.previewHost.hidden = activeSurface !== 'preview';
        targets.filesHost.hidden = !showFiles;
        targets.terminalHost.hidden = activeSurface !== 'terminal';
    }
    if (ctx.host.agentsHubShellActive) {
        ctx.host.stickyComposerHost.hidden = !showMessages;
        ctx.host.root.classList.toggle('theia-mod-sticky-composer', showMessages);
        // Quick-action chips are an empty-chat affordance, not a Messages-tab one:
        // re-derive their visibility from the conversation instead of force-showing
        // them on every return to Messages (which surfaced them on non-empty chats).
        const quickActionsSummary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        if (!showMessages) {
            ctx.host.stickyComposerHost.classList.remove('theia-mod-show-quick-actions');
        } else if (quickActionsSummary) {
            ctx.host.transcriptStickyComposerUi.syncTranscriptComposerQuickActionsVisibility(ctx.host.stickyComposerHost, quickActionsSummary);
        } else {
            // No conversation resolved yet — pre-first-message state, keep the chips.
            ctx.host.stickyComposerHost.classList.add('theia-mod-show-quick-actions');
        }
        if (!showMessages) {
            // Leaving Messages destroys the mounted composer. Its draft is live in
            // `transcriptComposerDraft` but the localStorage persist is debounced, so flush it
            // now — otherwise a fast tab switch loses the last <280ms of typing when the composer
            // remounts and re-reads the stale stored value.
            const composingId = ctx.host.transcriptComposerSummary?.id ?? ctx.host.transcriptOpenSummary?.id;
            ctx.host.transcriptStickyComposerUi.flushTranscriptComposerDraft(composingId);
            ctx.host.stickyComposerHost.replaceChildren();
            ctx.host.transcriptComposerMountKey = undefined;
            ctx.host.stickyComposerSheetsUi?.closeStickyComposerSheets();
        }
    }
    ctx.host.agentsHubInlineExecutionRoot?.setAttribute('data-active-surface', activeSurface);
    ctx.host.transcriptSheet?.querySelector('.theia-mobile-agent-log-sheet')?.setAttribute('data-active-surface', activeSurface);
    ctx.host.root.querySelector('.theia-mobile-projects-detail-surfaces-body')?.setAttribute('data-active-surface', activeSurface);
    if (activeSurface !== 'preview') {
        ctx.host.transcriptSurfacesUi.suspendTranscriptPreviewIframe();
    }
}

export function syncConnectedTranscriptSurfaceHostsExtracted(ctx: any): void {
    const inlineRoot = ctx.host.agentsHubInlineExecutionRoot;
    if (inlineRoot?.isConnected) {
        const transcriptRoot = ctx.directChildWithClass(inlineRoot, 'theia-mobile-agents-hub-inline-transcript');
        if (transcriptRoot) {
            ctx.host.agentsHubInlineTranscriptRoot = transcriptRoot;
            const chatHost = ctx.directChildWithClass(transcriptRoot, 'theia-mobile-agent-transcript-real-chat');
            if (chatHost) {
                ctx.host.transcriptChatHost = chatHost;
            }
        }
        ctx.syncSurfaceHostsFromContainer(inlineRoot);
    }

    const sheet = ctx.host.transcriptSheet
        ?.querySelector<HTMLElement>('.theia-mobile-agent-log-sheet.theia-mod-transcript');
    if (sheet?.isConnected) {
        const chatHost = ctx.directChildWithClass(sheet, 'theia-mobile-agent-transcript-real-chat');
        if (chatHost) {
            ctx.host.transcriptChatHost = chatHost;
        }
        const inputHost = ctx.directChildWithClass(sheet, 'theia-mobile-agent-transcript-chat-input');
        if (inputHost) {
            ctx.host.transcriptChatInputHost = inputHost;
        }
        ctx.syncSurfaceHostsFromContainer(sheet);
    }
}

export function syncSurfaceHostsFromContainerExtracted(ctx: any, container: HTMLElement): void {
    ctx.host.transcriptReviewHost = ctx.directChildWithClass(container, 'theia-mobile-transcript-review') ?? ctx.host.transcriptReviewHost;
    ctx.host.transcriptPreviewHost = ctx.directChildWithClass(container, 'theia-mobile-transcript-preview') ?? ctx.host.transcriptPreviewHost;
    ctx.host.transcriptFilesHost = ctx.directChildWithClass(container, 'theia-mobile-transcript-files-host') ?? ctx.host.transcriptFilesHost;
    ctx.host.transcriptTerminalHost = ctx.directChildWithClass(container, 'theia-mobile-transcript-terminal-host') ?? ctx.host.transcriptTerminalHost;
}

export function directChildWithClassExtracted(ctx: any, parent: HTMLElement, className: string): HTMLElement | undefined {
    for (const child of Array.from(parent.children)) {
        if (child instanceof HTMLElement && child.classList.contains(className)) {
            return child;
        }
    }
    return undefined;
}

export function mountExecutionSurfaceTabContentExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    tab: TranscriptTab,): void {
    if (ctx.host.transcriptSheet || ctx.host.agentsHubShellActive) {
        ctx.mountTranscriptSurfaceTab(project, summary, tab);
        return;
    }
    ctx.host.transcriptSurfacesUi.mountProjectDetailSurfaceTab(project, summary, tab);
}

export function syncHeaderExecutionTabStripExtracted(ctx: any): void {
    if (ctx.host.agentsHubShellActive) {
        return;
    }
    const project = ctx.host.isProjectDetailView() ? ctx.host.projectNavigationUi.resolveSelectedProject() : undefined;
    if (!project) {
        ctx.host.headerExecutionTabsHost.hidden = true;
        ctx.host.headerExecutionTabsHost.replaceChildren();
        ctx.host.projectDetailTabStrip = undefined;
        ctx.host.headerExecutionTabsProjectId = undefined;
        // Do not hide the preview-run control here — hub re-renders call this with no
        // project detail selection even while an Agents Hub Preview session is open.
        return;
    }
    ctx.host.headerExecutionTabsHost.hidden = false;
    const activeTab = ctx.executionSurfaceTabForProject(project);
    const needsRebuild = ctx.host.headerExecutionTabsProjectId !== project.id
        || !ctx.host.projectDetailTabStrip
        || !ctx.host.headerExecutionTabsHost.contains(ctx.host.projectDetailTabStrip);
    if (needsRebuild) {
        ctx.host.headerExecutionTabsProjectId = project.id;
        const tabStrip = ctx.buildExecutionViewTabStrip(
            activeTab,
            tab => ctx.host.projectDetailUi.selectProjectDetailTab(tab, project),
        );
        ctx.host.headerExecutionTabsHost.replaceChildren(tabStrip);
        ctx.host.projectDetailTabStrip = tabStrip;
        applyExecutionSurfaceHeaderChrome(tabStrip, activeTab);
        ctx.applyExecutionSurfaceIconSelectDisplay(tabStrip, activeTab);
        return;
    }
    ctx.syncProjectDetailTabStrip();
}

export function syncProjectDetailTabStripExtracted(ctx: any): void {
    const project = ctx.resolveExecutionSurfaceProject();
    if (!project) {
        return;
    }
    ctx.syncExecutionSurfaceChrome(project);
}

export function syncTranscriptTabStripExtracted(ctx: any, project: MobileProjectEntry): void {
    if (!ctx.host.transcriptTabStrip) {
        return;
    }
    ctx.refreshExecutionSurfaceTabStripState(ctx.host.transcriptTabStrip, ctx.executionSurfaceTabForProject(project));
}

export function rebuildExecutionSurfaceTabStripsExtracted(ctx: any, project: MobileProjectEntry, activeTab: TranscriptTab): void {
    ctx.closeExecutionTabOverflowMenu();
    const summary = ctx.host.transcriptOpenSummary ?? ctx.host.resolveAgentsHubShellSummary(project);
    if (ctx.host.agentsHubShellActive && !ctx.host.headerExecutionTabsHost.hidden) {
        const strip = ctx.buildExecutionViewTabStrip(
            activeTab,
            tab => ctx.selectTranscriptTab(tab, project, summary),
        );
        ctx.host.headerExecutionTabsHost.replaceChildren(strip);
        ctx.host.transcriptTabStrip = strip;
        ctx.host.agentsHubInlineTabStrip = strip;
        ctx.refreshExecutionSurfaceTabStripState(strip, activeTab);
    } else if (ctx.host.projectDetailTabStrip && ctx.host.headerExecutionTabsHost.contains(ctx.host.projectDetailTabStrip)) {
        const strip = ctx.buildExecutionViewTabStrip(
            activeTab,
            tab => ctx.host.projectDetailUi.selectProjectDetailTab(tab, project),
        );
        ctx.host.headerExecutionTabsHost.replaceChildren(strip);
        ctx.host.projectDetailTabStrip = strip;
        ctx.refreshExecutionSurfaceTabStripState(strip, activeTab);
    }
    if (ctx.host.transcriptTabStrip?.isConnected
        && ctx.host.transcriptOpenSummary
        && ctx.host.transcriptTabStrip !== ctx.host.agentsHubInlineTabStrip) {
        const strip = ctx.buildExecutionViewTabStrip(
            activeTab,
            tab => ctx.selectTranscriptTab(tab, project, summary),
        );
        ctx.replaceExecutionSurfaceTabStrip(ctx.host.transcriptTabStrip, strip);
        ctx.host.transcriptTabStrip = strip;
        ctx.refreshExecutionSurfaceTabStripState(strip, activeTab);
    }
}

export function refreshExecutionSurfaceTabStripStateExtracted(ctx: any, strip: HTMLElement, activeTab: TranscriptTab): void {
    if (activeTab === 'messages') {
        ctx.closeExecutionTabOverflowMenu();
    }
    applyExecutionSurfaceHeaderChrome(strip, activeTab);
    const selectBtn = queryExecutionSurfaceViewSelect(strip);
    selectBtn?.setAttribute('aria-expanded', 'false');
    ctx.applyExecutionSurfaceIconSelectDisplay(strip, activeTab);
    ctx.syncTerminalAgentTuiTriggersInStrip(strip);
    ctx.centerExecutionSurfaceActiveControl(strip);
}

export function centerExecutionSurfaceActiveControlExtracted(ctx: any, strip: HTMLElement): void {
    ctx.scheduleExecutionSurfaceFrame(() => {
        const active = strip.querySelector<HTMLElement>(
            '.theia-mobile-transcript-tab-icon-select[data-surface-active="true"]:not(.theia-mobile-transcript-terminal-agent-tui), .theia-mobile-transcript-tab.theia-mod-active',
        );
        if (!active?.isConnected) {
            return;
        }
        active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
}

export function scheduleExecutionSurfaceFrameExtracted(ctx: any, callback: () => void): void {
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(callback);
        return;
    }
    window.setTimeout(callback, 0);
}

export function navigateExecutionSurfaceBackExtracted(ctx: any, project: MobileProjectEntry): boolean {
    if (ctx.executionSurfaceTabForProject(project) === 'messages') {
        return false;
    }
    const agentsSummary = ctx.host.transcriptOpenSummary
        ?? (ctx.host.agentsHubShellActive ? ctx.host.resolveAgentsHubShellSummary(project) : undefined);
    if ((ctx.host.transcriptSheet || ctx.host.agentsHubShellActive) && agentsSummary) {
        ctx.selectTranscriptTab('messages', project, agentsSummary);
        return true;
    }
    if (ctx.host.isProjectDetailView() && ctx.host.expandedId === project.id) {
        ctx.host.projectDetailUi.selectProjectDetailTab('messages', project);
        return true;
    }
    return false;
}

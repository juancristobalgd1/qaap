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
    if (activeSummary && activeTab !== 'messages') {
        // Open after shell/header synchronization so a restored surface is not
        // immediately reattached to the inline transcript host.
        ctx.openExecutionSurfaceSidebar(activeTab, project, activeSummary, 'transcript');
    }
}

function resolveExecutionSurfaceSidebarHostExtracted(ctx: any, tab: TranscriptTab): HTMLElement | undefined {
    const activeSurface = tab === 'review' ? 'files' : tab;
    const transcriptHost = activeSurface === 'preview'
        ? ctx.host.transcriptPreviewHost
        : activeSurface === 'files'
            ? ctx.host.transcriptFilesHost
            : activeSurface === 'terminal'
                ? ctx.host.transcriptTerminalHost
                : undefined;
    const hostClass = activeSurface === 'preview'
        ? 'theia-mobile-transcript-preview'
        : activeSurface === 'files'
            ? 'theia-mobile-transcript-files-host'
            : activeSurface === 'terminal'
                ? 'theia-mobile-transcript-terminal-host'
                : undefined;
    if (hostClass) {
        // Header/shell refreshes can leave an empty host from the previous
        // Work Hub surface connected next to the live host. Resolve from the
        // visible active root first so the drawer receives the actual view.
        const activeRoots = Array.from(document.querySelectorAll<HTMLElement>(
            `.theia-mobile-agents-hub-inline-execution[data-active-surface="${activeSurface}"]`,
        )).filter(root => root.isConnected && !root.hidden && root.getBoundingClientRect().width > 0);
        for (const root of activeRoots) {
            const liveHost = directChildWithClassExtracted(ctx, root, hostClass);
            if (liveHost?.isConnected && !liveHost.hidden) {
                return liveHost;
            }
        }
    }
    // Work Hub can render project-detail surfaces without reporting itself as the
    // legacy project-detail view. Prefer the live transcript host when the inline
    // Agents shell owns it, then fall back to the project-detail host whenever it
    // is the only connected surface. This keeps secondary views in the drawer in
    // both entry paths instead of silently replacing Chat in the center.
    if (transcriptHost?.isConnected) {
        return transcriptHost;
    }
    const targets = ctx.host.projectDetailSurfaceTargets;
    if (targets) {
        if (activeSurface === 'preview') {
            return targets.previewHost;
        }
        if (activeSurface === 'files') {
            return targets.filesHost;
        }
        if (activeSurface === 'terminal') {
            return targets.terminalHost;
        }
    }
    return transcriptHost;
}

function restoreExecutionSurfaceSidebarHostExtracted(sidebar: any): void {
    const host = sidebar.activeHost as HTMLElement | undefined;
    if (!host) {
        return;
    }
    const placeholder = sidebar.placeholder as Comment | undefined;
    if (placeholder?.isConnected) {
        placeholder.replaceWith(host);
    } else {
        host.remove();
    }
    host.hidden = true;
    sidebar.activeHost = undefined;
    sidebar.placeholder = undefined;
}

function restoreExecutionSurfaceSidebarViewModeHostExtracted(sidebar: any): void {
    sidebar.viewModeObserver?.disconnect();
    sidebar.viewModeObserver = undefined;
    const host = sidebar.viewModeHost as HTMLElement | undefined;
    if (!host) {
        return;
    }
    const placeholder = sidebar.viewModePlaceholder as Comment | undefined;
    if (placeholder?.isConnected) {
        placeholder.replaceWith(host);
    } else {
        host.remove();
    }
    host.hidden = true;
    sidebar.viewModeHost = undefined;
    sidebar.viewModePlaceholder = undefined;
    sidebar.viewModeCandidate = undefined;
}

function restoreExecutionSurfaceSidebarPreviewHeaderExtracted(sidebar: any): void {
    sidebar.previewHeaderObserver?.disconnect();
    sidebar.previewHeaderObserver = undefined;
    const previewHeader = sidebar.previewHeaderHost as HTMLElement | undefined;
    if (!previewHeader) {
        return;
    }
    const placeholder = sidebar.previewHeaderPlaceholder as Comment | undefined;
    if (placeholder?.isConnected) {
        placeholder.replaceWith(previewHeader);
    } else {
        previewHeader.remove();
    }
    previewHeader.classList.remove('theia-mobile-execution-surface-sidebar-preview-header');
    const changesHeader = sidebar.previewChangesHeaderHost as HTMLElement | undefined;
    if (changesHeader?.parentElement === sidebar.element?.querySelector('.theia-mobile-execution-surface-sidebar-header')) {
        changesHeader.remove();
    }
    sidebar.previewHeaderHost = undefined;
    sidebar.previewHeaderPlaceholder = undefined;
    sidebar.previewChangesHeaderHost = undefined;
}

function restoreExecutionSurfaceSidebarPreviewHeaderMountExtracted(sidebar: any): void {
    const mount = sidebar.previewHeaderMount as {
        attachPreviewHeaderHost?: (host: HTMLElement | undefined) => void;
    } | undefined;
    mount?.attachPreviewHeaderHost?.(undefined);
    sidebar.previewHeaderMount = undefined;
}

function createExecutionSurfaceSidebarChangesHeaderExtracted(): HTMLElement {
    const changesHeader = document.createElement('div');
    changesHeader.className = 'theia-mobile-transcript-files-changes-header';
    const icon = createExecutionSurfaceIconElement(QAAP_SCM_CHANGES_ICON_CLASS, 'theia-mobile-transcript-files-changes-header-icon');
    const label = document.createElement('span');
    label.className = 'theia-mobile-transcript-files-changes-header-label';
    label.textContent = nls.localize('qaap/mobileProjects/tabChanges', 'Changes');
    changesHeader.append(icon, label);
    changesHeader.setAttribute('aria-label', label.textContent);
    return changesHeader;
}

function executionSurfaceSidebarChangesModeSelectedExtracted(sidebar: any): boolean {
    const switchElement = sidebar.element?.querySelector<HTMLElement>('.theia-mobile-transcript-files-view-mode-switch');
    const changesButton = switchElement?.querySelector<HTMLElement>('[data-view-mode="changes"]')
        ?? switchElement?.querySelectorAll<HTMLElement>('[aria-selected]')[1];
    return changesButton?.getAttribute('aria-selected') === 'true';
}

function syncExecutionSurfaceSidebarFallbackPreviewHeaderExtracted(sidebar: any,
    header: HTMLElement,
    close: HTMLElement,
    previewHeader: HTMLElement,): void {
    const changesMode = executionSurfaceSidebarChangesModeSelectedExtracted(sidebar);
    let changesHeader = sidebar.previewChangesHeaderHost as HTMLElement | undefined;
    if (changesMode && !changesHeader) {
        changesHeader = header.querySelector<HTMLElement>('.theia-mobile-transcript-files-changes-header')
            ?? createExecutionSurfaceSidebarChangesHeaderExtracted();
        sidebar.previewChangesHeaderHost = changesHeader;
    }
    if (!changesHeader) {
        return;
    }
    const activeHeader = changesMode ? changesHeader : previewHeader;
    const inactiveHeader = changesMode ? previewHeader : changesHeader;
    if (inactiveHeader.parentElement === header) {
        inactiveHeader.remove();
    }
    if (activeHeader.parentElement !== header) {
        const before = sidebar.viewModeHost?.parentElement === header
            ? sidebar.viewModeHost
            : close;
        header.insertBefore(activeHeader, before);
    }
}

function restoreExecutionSurfaceSidebarToolbarHostExtracted(sidebar: any): void {
    sidebar.toolbarObserver?.disconnect();
    sidebar.toolbarObserver = undefined;
    const host = sidebar.toolbarHost as HTMLElement | undefined;
    if (!host) {
        return;
    }
    const placeholder = sidebar.toolbarPlaceholder as Comment | undefined;
    if (placeholder?.isConnected) {
        placeholder.replaceWith(host);
    } else {
        host.remove();
    }
    host.classList.remove('theia-mobile-execution-surface-sidebar-toolbar');
    sidebar.toolbarHost = undefined;
    sidebar.toolbarPlaceholder = undefined;
}

function resolveExecutionSurfaceSidebarToolbarHostExtracted(activeSurface: string, host: HTMLElement): HTMLElement | undefined {
    if (activeSurface === 'preview') {
        return host.querySelector<HTMLElement>('.qaap-agent-preview-embedded-toolbar');
    }
    if (activeSurface === 'terminal') {
        return host.querySelector<HTMLElement>('.theia-mobile-transcript-terminal-toolbar');
    }
    return undefined;
}

function promoteExecutionSurfaceSidebarToolbarExtracted(sidebar: any): void {
    const activeHost = sidebar.activeHost as HTMLElement | undefined;
    const header = sidebar.element?.querySelector<HTMLElement>('.theia-mobile-execution-surface-sidebar-header');
    const close = header?.querySelector<HTMLElement>('.theia-mobile-execution-surface-sidebar-close');
    const toolbar = activeHost && resolveExecutionSurfaceSidebarToolbarHostExtracted(sidebar.activeTab, activeHost);
    if (!header || !close || !toolbar?.parentNode) {
        return;
    }
    const currentToolbar = sidebar.toolbarHost as HTMLElement | undefined;
    if (currentToolbar === toolbar && currentToolbar.parentElement === header) {
        return;
    }
    if (currentToolbar && currentToolbar !== toolbar) {
        // A terminal/preview host can recreate its toolbar after interaction.
        // Drop the stale promoted copy before moving the fresh one into the
        // drawer header, otherwise both bars remain visible.
        currentToolbar.remove();
        sidebar.toolbarHost = undefined;
    }
    if (!sidebar.toolbarPlaceholder?.isConnected) {
        const placeholder = document.createComment('qaap execution surface toolbar host');
        toolbar.parentNode.insertBefore(placeholder, toolbar);
        sidebar.toolbarPlaceholder = placeholder;
    }
    toolbar.classList.add('theia-mobile-execution-surface-sidebar-toolbar');
    header.insertBefore(toolbar, close);
    sidebar.toolbarHost = toolbar;
}

function observeExecutionSurfaceSidebarToolbarExtracted(sidebar: any): void {
    if (sidebar.toolbarObserver || typeof MutationObserver === 'undefined') {
        return;
    }
    const activeHost = sidebar.activeHost as HTMLElement | undefined;
    if (!activeHost) {
        return;
    }
    const observer = new MutationObserver(() => promoteExecutionSurfaceSidebarToolbarExtracted(sidebar));
    observer.observe(activeHost, { childList: true, subtree: true });
    sidebar.toolbarObserver = observer;
}

function promoteExecutionSurfaceSidebarViewModeHostExtracted(sidebar: any): void {
    if (sidebar.activeTab !== 'files') {
        return;
    }
    const header = sidebar.element?.querySelector<HTMLElement>('.theia-mobile-execution-surface-sidebar-header');
    const close = header?.querySelector<HTMLElement>('.theia-mobile-execution-surface-sidebar-close');
    const storedCandidate = sidebar.viewModeHost as HTMLElement | undefined;
    const visibleCandidate = Array.from(document.querySelectorAll<HTMLElement>(
        '.theia-mobile-projects-header-view-mode-switch',
    )).find(candidate => !candidate.hidden
        && !candidate.closest('.theia-mobile-execution-surface-sidebar')
        && candidate.querySelector('.theia-mobile-transcript-files-view-mode-switch'));
    const candidate = storedCandidate?.parentElement === header
        ? storedCandidate
        : visibleCandidate ?? storedCandidate ?? sidebar.viewModeCandidate as HTMLElement | undefined;
    if (!header || !close || !candidate || candidate.hidden || (!candidate.parentNode && candidate !== storedCandidate)) {
        return;
    }
    if (!candidate.querySelector('.theia-mobile-transcript-files-view-mode-switch')) {
        return;
    }
    if (!sidebar.viewModeHost || sidebar.viewModeHost !== candidate) {
        sidebar.viewModeHost = candidate;
        if (!sidebar.viewModePlaceholder?.isConnected && candidate.parentNode) {
            sidebar.viewModePlaceholder = document.createComment('qaap execution surface view mode host');
            candidate.replaceWith(sidebar.viewModePlaceholder);
        }
    }
    if (candidate.parentElement !== header) {
        // Keep the placeholder in the drawer header so dismissing the drawer can
        // restore the original header position even if the global header rerenders
        // while the drawer is open.
        header.insertBefore(candidate, close);
    }
}

function observeExecutionSurfaceSidebarViewModeHostExtracted(sidebar: any): void {
    if (sidebar.viewModeObserver || typeof MutationObserver === 'undefined' || !sidebar.viewModeCandidate) {
        return;
    }
    const observer = new MutationObserver(() => {
        if (!sidebar.element?.isConnected) {
            observer.disconnect();
            if (sidebar.viewModeObserver === observer) {
                sidebar.viewModeObserver = undefined;
            }
            return;
        }
        promoteExecutionSurfaceSidebarViewModeHostExtracted(sidebar);
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'hidden'],
    });
    sidebar.viewModeObserver = observer;
}

function promoteExecutionSurfaceSidebarPreviewHeaderExtracted(sidebar: any): void {
    if (sidebar.activeTab !== 'files') {
        return;
    }
    const activeHost = sidebar.activeHost as HTMLElement | undefined;
    const header = sidebar.element?.querySelector<HTMLElement>('.theia-mobile-execution-surface-sidebar-header');
    const close = header?.querySelector<HTMLElement>('.theia-mobile-execution-surface-sidebar-close');
    const mount = sidebar.previewHeaderMount as {
        attachPreviewHeaderHost?: (host: HTMLElement | undefined) => void;
    } | undefined;
    if (mount?.attachPreviewHeaderHost && header && close) {
        mount.attachPreviewHeaderHost(header);
        const previewHeader = header.querySelector<HTMLElement>('.theia-mobile-transcript-files-preview-header');
        const before = sidebar.viewModeHost?.parentElement === header
            ? sidebar.viewModeHost
            : close;
        if (previewHeader && previewHeader.nextElementSibling !== before) {
            header.insertBefore(previewHeader, before);
        }
        return;
    }
    const mountedPreviewHeader = activeHost?.querySelector<HTMLElement>('.theia-mobile-transcript-files-preview-header');
    const storedPreviewHeader = sidebar.previewHeaderHost as HTMLElement | undefined;
    const previewHeader = mountedPreviewHeader ?? storedPreviewHeader;
    if (!activeHost || !header || !close || !previewHeader || (!previewHeader.parentNode && previewHeader !== storedPreviewHeader)) {
        return;
    }
    if (executionSurfaceSidebarChangesModeSelectedExtracted(sidebar)) {
        syncExecutionSurfaceSidebarFallbackPreviewHeaderExtracted(sidebar, header, close, previewHeader);
        return;
    }
    if (storedPreviewHeader && storedPreviewHeader !== previewHeader && storedPreviewHeader.parentElement === header) {
        storedPreviewHeader.remove();
    }
    if (!sidebar.previewHeaderHost || sidebar.previewHeaderHost !== previewHeader) {
        sidebar.previewHeaderHost = previewHeader;
        if (!sidebar.previewHeaderPlaceholder?.isConnected && previewHeader.parentNode) {
            sidebar.previewHeaderPlaceholder = document.createComment('qaap execution surface preview header');
            previewHeader.replaceWith(sidebar.previewHeaderPlaceholder);
        }
        previewHeader.classList.add('theia-mobile-execution-surface-sidebar-preview-header');
    }
    const before = sidebar.viewModeHost?.parentElement === header
        ? sidebar.viewModeHost
        : close;
    if (previewHeader.parentElement !== header || previewHeader.nextElementSibling !== before) {
        header.insertBefore(previewHeader, before);
    }
    syncExecutionSurfaceSidebarFallbackPreviewHeaderExtracted(sidebar, header, close, previewHeader);
}

function observeExecutionSurfaceSidebarPreviewHeaderExtracted(sidebar: any): void {
    if (sidebar.previewHeaderObserver || typeof MutationObserver === 'undefined' || !sidebar.activeHost) {
        return;
    }
    const observer = new MutationObserver(() => {
        if (!sidebar.element?.isConnected) {
            observer.disconnect();
            if (sidebar.previewHeaderObserver === observer) {
                sidebar.previewHeaderObserver = undefined;
            }
            return;
        }
        promoteExecutionSurfaceSidebarPreviewHeaderExtracted(sidebar);
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-selected', 'class', 'hidden'],
    });
    sidebar.previewHeaderObserver = observer;
}

function executionSurfaceSidebarSpecExtracted(ctx: any, tab: TranscriptTab): { label: string; icon: string } {
    const activeSurface = tab === 'review' ? 'files' : tab;
    return ctx.executionSurfaceTabSpecs().find((entry: { id: TranscriptTab }) => entry.id === activeSurface)
        ?? {
            label: nls.localize('qaap/mobileProjects/tabChat', 'Chat'),
            icon: QAAP_MESSAGE_CIRCLE_ICON_CLASS,
        };
}

export function openExecutionSurfaceSidebarWhenReadyExtracted(ctx: any, tab: TranscriptTab,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    origin: 'transcript' | 'project-detail',): void {
    let attempts = 0;
    const attemptOpen = (): void => {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
            return;
        }
        if (ctx.host.executionSurfaceSidebar?.element?.isConnected || attempts >= 100) {
            return;
        }
        attempts += 1;
        ctx.openExecutionSurfaceSidebar(tab, project, summary, origin);
        if (!ctx.host.executionSurfaceSidebar) {
            window.setTimeout(attemptOpen, 100);
        }
    };
    attemptOpen();
}

export function openExecutionSurfaceSidebarExtracted(ctx: any, tab: TranscriptTab,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    origin: 'transcript' | 'project-detail',): void {
    const activeSurface = tab === 'review' ? 'files' : tab;
    if (activeSurface === 'messages') {
        return;
    }
    const host = resolveExecutionSurfaceSidebarHostExtracted(ctx, activeSurface);
    if (!host) {
        return;
    }

    const previous = ctx.host.executionSurfaceSidebar;
    if (previous) {
        restoreExecutionSurfaceSidebarHostExtracted(previous);
        restoreExecutionSurfaceSidebarViewModeHostExtracted(previous);
        restoreExecutionSurfaceSidebarPreviewHeaderMountExtracted(previous);
        restoreExecutionSurfaceSidebarPreviewHeaderExtracted(previous);
        restoreExecutionSurfaceSidebarToolbarHostExtracted(previous);
        previous.element.remove();
        previous.backdrop.remove();
        if (previous.closeTimer) {
            window.clearTimeout(previous.closeTimer);
        }
        ctx.host.executionSurfaceSidebar = undefined;
    }
    for (const closing of Array.from(ctx.host.root.querySelectorAll<HTMLElement>('.theia-mobile-execution-surface-sidebar.theia-mod-closing'))) {
        closing.remove();
    }

    const spec = executionSurfaceSidebarSpecExtracted(ctx, activeSurface);
    const closeLabel = nls.localize('qaap/mobileProjects/closeExecutionSurface', 'Close view');
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'theia-mobile-execution-surface-sidebar-backdrop';
    backdrop.setAttribute('aria-label', closeLabel);
    backdrop.title = closeLabel;
    backdrop.addEventListener('click', () => ctx.closeExecutionSurfaceSidebar());

    const sidebar = document.createElement('section');
    sidebar.className = 'theia-mobile-execution-surface-sidebar';
    sidebar.dataset.surface = activeSurface;
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h2');
    heading.className = 'theia-mobile-execution-surface-sidebar-title';
    heading.id = `qaap-execution-surface-sidebar-${Date.now().toString(36)}`;
    heading.textContent = spec.label;
    const compactHeader = activeSurface === 'preview' || activeSurface === 'terminal';
    const filesHeader = activeSurface === 'files';
    if (compactHeader || filesHeader) {
        sidebar.setAttribute('aria-label', spec.label);
    } else {
        sidebar.setAttribute('aria-labelledby', heading.id);
    }

    const header = document.createElement('header');
    header.className = 'theia-mobile-execution-surface-sidebar-header';
    const icon = createExecutionSurfaceIconElement(spec.icon, 'theia-mobile-execution-surface-sidebar-icon');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'theia-mobile-execution-surface-sidebar-close codicon codicon-close';
    close.title = closeLabel;
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => ctx.closeExecutionSurfaceSidebar());

    let viewModeHost: HTMLElement | undefined;
    let viewModePlaceholder: Comment | undefined;
    const viewModeCandidate = activeSurface === 'files'
        ? ctx.host.headerViewModeSwitchHost as HTMLElement | undefined
        : undefined;
    let toolbarHost: HTMLElement | undefined;
    let toolbarPlaceholder: Comment | undefined;
    if (!compactHeader && !filesHeader) {
        header.append(icon, heading);
    }
    if (viewModeHost) {
        header.append(viewModeHost);
    }
    if (compactHeader) {
        const candidate = resolveExecutionSurfaceSidebarToolbarHostExtracted(activeSurface, host);
        if (candidate?.parentNode) {
            toolbarHost = candidate;
            toolbarPlaceholder = document.createComment('qaap execution surface toolbar host');
            candidate.replaceWith(toolbarPlaceholder);
            candidate.classList.add('theia-mobile-execution-surface-sidebar-toolbar');
            header.append(candidate);
        }
    }
    header.append(close);

    const content = document.createElement('div');
    content.className = 'theia-mobile-execution-surface-sidebar-content';
    sidebar.append(header, content);

    const placeholder = document.createComment('qaap execution surface sidebar host');
    if (host.parentNode) {
        host.replaceWith(placeholder);
    }
    host.hidden = false;
    content.append(host);

    const filesMount = activeSurface === 'files'
        ? (() => {
            const workspaceKey = ctx.host.transcriptSurfacesUi?.resolveTranscriptWorkspaceKey?.(project, summary);
            return workspaceKey
                ? ctx.host.transcriptWorkspaceSurfaces?.peekFiles(workspaceKey)
                : undefined;
        })()
        : undefined;

    // Mount at the document level so the fixed drawer can cover the Work Hub
    // sessions sidebar as well as the Agents content area.
    document.body.append(backdrop, sidebar);
    const state = {
        element: sidebar,
        backdrop,
        content,
        activeHost: host,
        placeholder,
        viewModeHost,
        viewModePlaceholder,
        viewModeCandidate,
        previewHeaderHost: undefined,
        previewHeaderPlaceholder: undefined,
        previewHeaderMount: filesMount,
        previewChangesHeaderHost: undefined,
        toolbarHost,
        toolbarPlaceholder,
        activeTab: activeSurface,
        project,
        summary,
        origin,
    };
    ctx.host.executionSurfaceSidebar = state;
    promoteExecutionSurfaceSidebarViewModeHostExtracted(state);
    observeExecutionSurfaceSidebarViewModeHostExtracted(state);
    promoteExecutionSurfaceSidebarPreviewHeaderExtracted(state);
    observeExecutionSurfaceSidebarPreviewHeaderExtracted(state);
    promoteExecutionSurfaceSidebarToolbarExtracted(state);
    observeExecutionSurfaceSidebarToolbarExtracted(state);
    // The tool host has left the inline surface, so keep the underlying
    // conversation selected in the legacy visibility selectors.
    ctx.host.agentsHubInlineExecutionRoot?.setAttribute('data-active-surface', 'messages');
    ctx.host.transcriptSheet?.querySelector('.theia-mobile-agent-log-sheet')?.setAttribute('data-active-surface', 'messages');
    ctx.host.root.querySelector('.theia-mobile-projects-detail-surfaces-body')?.setAttribute('data-active-surface', 'messages');
    const reveal = (): void => sidebar.classList.add('theia-mod-open');
    const revealBackdrop = (): void => backdrop.classList.add('theia-mod-open');
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
            revealBackdrop();
            reveal();
        });
    } else {
        window.setTimeout(() => {
            revealBackdrop();
            reveal();
        }, 0);
    }
}

export function dismissExecutionSurfaceSidebarExtracted(ctx: any): void {
    const sidebar = ctx.host.executionSurfaceSidebar;
    if (!sidebar) {
        return;
    }
    restoreExecutionSurfaceSidebarHostExtracted(sidebar);
    restoreExecutionSurfaceSidebarViewModeHostExtracted(sidebar);
    restoreExecutionSurfaceSidebarPreviewHeaderMountExtracted(sidebar);
    restoreExecutionSurfaceSidebarPreviewHeaderExtracted(sidebar);
    restoreExecutionSurfaceSidebarToolbarHostExtracted(sidebar);
    ctx.host.executionSurfaceSidebar = undefined;
    sidebar.backdrop.classList.remove('theia-mod-open');
    sidebar.backdrop.classList.add('theia-mod-closing');
    sidebar.element.classList.remove('theia-mod-open');
    sidebar.element.classList.add('theia-mod-closing');
    sidebar.closeTimer = window.setTimeout(() => {
        sidebar.backdrop.remove();
        sidebar.element.remove();
    }, 220);
}

export function closeExecutionSurfaceSidebarExtracted(ctx: any): void {
    const sidebar = ctx.host.executionSurfaceSidebar;
    const project = sidebar?.project ?? ctx.resolveExecutionSurfaceProject();
    const summary = sidebar?.summary
        ?? ctx.host.transcriptOpenSummary
        ?? (project && ctx.host.agentsHubShellActive ? ctx.host.resolveAgentsHubShellSummary(project) : undefined);
    const origin = sidebar?.origin ?? 'transcript';
    ctx.dismissExecutionSurfaceSidebar();
    if (project && summary) {
        ctx.activateExecutionSurfaceTab('messages', project, summary, origin);
    }
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
    if (tab === 'messages') {
        ctx.dismissExecutionSurfaceSidebar();
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
    try {
        ctx.host.root.classList.add('theia-mod-project-surface-chat');
        ctx.host.root.classList.remove('theia-mod-project-surface-tools');
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
    } finally {
        if (tab !== 'messages') {
            // Keep the live tool surface in the overlay even when a secondary
            // header/layout synchronizer fails or rebuilds the shell.
            openExecutionSurfaceSidebarWhenReadyExtracted(ctx, tab, project, summary, origin);
        }
    }
}

export function showOnlyExecutionSurfaceTabExtracted(ctx: any, tab: TranscriptTab): void {
    ctx.syncConnectedTranscriptSurfaceHosts();
    const activeSurface = tab === 'review' ? 'files' : tab;
    if (activeSurface === 'messages') {
        ctx.dismissExecutionSurfaceSidebar();
    }
    // Conversation selection and shell restoration call this shared visibility path directly,
    // without going through activateExecutionSurfaceTab(). Keep the root layout mode in sync too;
    // otherwise a previous Files/Preview/Terminal selection leaves the no-inset tools class on a
    // newly selected Chat conversation and shifts both transcript and composer to the left.
    ctx.host.root.classList.add('theia-mod-project-surface-chat');
    ctx.host.root.classList.remove('theia-mod-project-surface-tools');
    // 'review' is merged into 'files' — show the files host for both.
    const showFiles = activeSurface === 'files';
    if (ctx.host.agentsHubInlineTranscriptRoot) {
        ctx.host.agentsHubInlineTranscriptRoot.hidden = false;
    }
    if (ctx.host.transcriptChatHost) {
        ctx.host.transcriptChatHost.hidden = false;
    }
    if (ctx.host.transcriptChatInputHost) {
        ctx.host.transcriptChatInputHost.hidden = false;
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
        targets.chatHost.hidden = false;
        targets.reviewHost.hidden = true;
        targets.previewHost.hidden = activeSurface !== 'preview';
        targets.filesHost.hidden = !showFiles;
        targets.terminalHost.hidden = activeSurface !== 'terminal';
    }
    if (ctx.host.agentsHubShellActive) {
        ctx.host.stickyComposerHost.hidden = false;
        ctx.host.root.classList.toggle('theia-mod-sticky-composer', true);
        // Quick-action chips are an empty-chat affordance, not a Messages-tab one:
        // re-derive their visibility from the conversation instead of force-showing
        // them on every return to Messages (which surfaced them on non-empty chats).
        const quickActionsSummary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        if (quickActionsSummary) {
            ctx.host.transcriptStickyComposerUi.syncTranscriptComposerQuickActionsVisibility?.(ctx.host.stickyComposerHost, quickActionsSummary);
        } else {
            // No conversation resolved yet — pre-first-message state, keep the chips.
            ctx.host.stickyComposerHost.classList.add('theia-mod-show-quick-actions');
        }
    }
    ctx.host.agentsHubInlineExecutionRoot?.setAttribute('data-active-surface', activeSurface);
    ctx.host.transcriptSheet?.querySelector('.theia-mobile-agent-log-sheet')?.setAttribute('data-active-surface', activeSurface);
    ctx.host.root.querySelector('.theia-mobile-projects-detail-surfaces-body')?.setAttribute('data-active-surface', activeSurface);
    if (activeSurface !== 'preview') {
        ctx.host.transcriptSurfacesUi.suspendTranscriptPreviewIframe();
    }
    if (activeSurface !== 'messages' && !ctx.host.executionSurfaceSidebar?.element?.isConnected) {
        const project = ctx.host.transcriptOpenProject
            ?? ctx.resolveExecutionSurfaceProject()
            ?? ctx.host.projectNavigationUi?.resolveSelectedProject?.();
        const summary = ctx.host.transcriptOpenSummary
            ?? (project && ctx.host.agentsHubShellActive ? ctx.host.resolveAgentsHubShellSummary(project) : undefined)
            ?? (project ? ctx.host.projectDetailUi?.projectDetailSurfaceSummary?.(project) : undefined);
        if (project && summary) {
            openExecutionSurfaceSidebarWhenReadyExtracted(ctx, activeSurface, project, summary, 'transcript');
        }
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
    let firstMatch: HTMLElement | undefined;
    let populatedMatch: HTMLElement | undefined;
    let visibleMatch: HTMLElement | undefined;
    for (const child of Array.from(parent.children)) {
        if (child instanceof HTMLElement && child.classList.contains(className)) {
            firstMatch ??= child;
            if (!child.hidden) {
                visibleMatch ??= child;
            }
            if (child.children.length > 0) {
                populatedMatch ??= child;
                if (!child.hidden) {
                    return child;
                }
            }
        }
    }
    // Cached surface hosts can leave an empty placeholder next to the live
    // host. Prefer the populated host so the drawer receives the actual view
    // instead of an empty shell.
    return populatedMatch ?? visibleMatch ?? firstMatch;
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

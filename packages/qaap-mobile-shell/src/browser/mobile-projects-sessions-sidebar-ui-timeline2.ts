// @ts-nocheck
// Extracted from mobile-projects-sessions-sidebar-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickPickItem } from '@theia/core/lib/browser';
import {
    readStoredAgent,
    SHELL_AGENT_ID,
} from '../common/qaap-agent-task-client';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { QAAP_WORK_HUB_GETTING_STARTED } from '../common/mobile-work-hub-catalog';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { createLucideArrowUpRightIcon } from '@theia/qaap-adapters/lib/browser/qaap-lucide-icons';
import {
    buildQaapAccountMenuEntries,
    QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    toggleQaapAccountMenu,
    type MobileViewToggleId,
} from './qaap-workbench-account-menu';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileWorkHubSessionsSidebar, isDesktopSessionsSidebarLayout } from './mobile-work-hub-sessions-sidebar';
import {
    buildWorkHubSessionsSidebarRowFingerprint,
    buildWorkHubSessionsSidebarVisibleStructureFingerprint,
    QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR,
    QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR,
    type WorkHubSessionsSidebarFingerprintInput,
} from '../common/qaap-work-hub-sessions-sidebar-fingerprint';
import { resolveQaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import {
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
    resolveSessionsSidebarInitialConversationLimit,
} from '../common/qaap-sessions-sidebar-conversation-limit';

export function createSessionsSidebarProjectGroupExtracted(ctx: any, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    const expanded = ctx.host.sessionsSidebarExpandedProjectIds.has(project.id);
    const section = document.createElement('section');
    section.className = 'theia-mobile-work-hub-sessions-sidebar-project-group';
    if (!expanded) {
        section.classList.add('theia-mod-collapsed');
    }
    const toggleExpand = (): void => {
        const willExpand = section.classList.contains('theia-mod-collapsed');
        section.classList.toggle('theia-mod-collapsed');
        const chevronBtn = head.querySelector('.theia-mobile-work-hub-sessions-sidebar-project-chevron-btn');
        chevronBtn?.setAttribute('aria-expanded', String(willExpand));
        const folderIcon = head.querySelector('.theia-mobile-work-hub-sessions-sidebar-project-folder');
        if (folderIcon) {
            folderIcon.classList.toggle('codicon-folder', !willExpand);
            folderIcon.classList.toggle('codicon-folder-opened', willExpand);
        }
        if (willExpand) {
            ctx.host.sessionsSidebarExpandedProjectIds.add(project.id);
        } else {
            ctx.host.sessionsSidebarExpandedProjectIds.delete(project.id);
        }
    };
    const head = ctx.createSessionsSidebarProjectRowHead(project, expanded, toggleExpand);
    const list = document.createElement('div');
    list.className = 'theia-mobile-projects-chats-list';
    ctx.appendSessionsSidebarConversationItems(list, project, conversations, onActivate, bypassConversationLimit);
    section.append(head, list);
    return section;
}

export function createSessionsSidebarProjectRowHeadExtracted(ctx: any, project: MobileProjectEntry,
    expanded: boolean,
    onToggleExpand: () => void,): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theia-mobile-work-hub-sessions-sidebar-project-row-wrap';
    if (project.isCurrent) {
        row.classList.add('theia-mod-current');
    }
    if (ctx.host.agentsHubSelectedProjectId === project.id) {
        row.classList.add('theia-mod-selected');
    }
    const chevronBtn = document.createElement('button');
    chevronBtn.type = 'button';
    chevronBtn.className = 'theia-mobile-work-hub-sessions-sidebar-project-chevron-btn';
    chevronBtn.setAttribute('aria-expanded', String(expanded));
    chevronBtn.setAttribute('aria-label', expanded
        ? nls.localize('qaap/sessionsSidebar/collapseProject', 'Collapse {0}', project.name)
        : nls.localize('qaap/sessionsSidebar/expandProject', 'Expand {0}', project.name));
    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-right theia-mobile-work-hub-sessions-sidebar-project-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevronBtn.append(chevron);
    chevronBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        onToggleExpand();
        const nowExpanded = ctx.host.sessionsSidebarExpandedProjectIds.has(project.id);
        chevronBtn.setAttribute('aria-expanded', String(nowExpanded));
        chevronBtn.setAttribute('aria-label', nowExpanded
            ? nls.localize('qaap/sessionsSidebar/collapseProject', 'Collapse {0}', project.name)
            : nls.localize('qaap/sessionsSidebar/expandProject', 'Expand {0}', project.name));
    });
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'theia-mobile-work-hub-sessions-sidebar-project-row';
    head.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/openProject', 'Open {0}', project.name));
    if (ctx.host.agentsHubSelectedProjectId === project.id) {
        head.setAttribute('aria-current', 'true');
    }
    const folder = document.createElement('span');
    folder.className = 'theia-mobile-work-hub-sessions-sidebar-project-folder codicon '
        + (expanded ? 'codicon-folder-opened' : 'codicon-folder');
    folder.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'theia-mobile-work-hub-sessions-sidebar-project-name';
    name.textContent = project.name;
    head.append(folder, name);
    head.addEventListener('click', ev => {
        ev.stopPropagation();
        if (!ctx.host.sessionsSidebarExpandedProjectIds.has(project.id)) {
            onToggleExpand();
        }
        void ctx.selectSessionsSidebarProject(project);
    });
    const actions = document.createElement('div');
    actions.className = 'theia-mobile-work-hub-sessions-sidebar-project-actions';
    actions.append(ctx.createSessionsSidebarNewAgentControl(project));
    const menu = ctx.host.cardMenuUi.buildProjectOptionsMenu(project);
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'theia-mobile-projects-card-menu-btn theia-mobile-projects-row-menu';
    menuBtn.setAttribute('aria-label', nls.localize('qaap/mobileProjects/cardMenu', 'Project options'));
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    const menuIcon = document.createElement('span');
    menuIcon.className = 'codicon codicon-kebab-vertical';
    menuIcon.setAttribute('aria-hidden', 'true');
    menuBtn.append(menuIcon);
    menuBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        ctx.host.cardMenuUi.toggleCardMenu(row, menu, menuBtn);
    });
    row.append(chevronBtn, head, actions, menuBtn, menu);
    return row;
}

export function createSessionsSidebarIdeOpenControlExtracted(ctx: any, project: MobileProjectEntry): HTMLButtonElement {
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'theia-mobile-projects-row-meta-open theia-mobile-work-hub-sessions-sidebar-project-open';
    const openLabel = nls.localize('qaap/mobileProjects/openInIde', 'Open in IDE');
    openBtn.setAttribute('aria-label', openLabel);
    openBtn.title = openLabel;
    const label = document.createElement('span');
    label.className = 'theia-mobile-work-hub-sessions-sidebar-project-open-label';
    label.textContent = nls.localize('qaap/mobileProjects/ideLabel', 'IDE');
    const openIcon = createLucideArrowUpRightIcon();
    openIcon.classList.add('theia-mobile-work-hub-sessions-sidebar-project-open-icon');
    openBtn.append(label, openIcon);
    openBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        ctx.host.sessionsSidebar?.hide();
        void ctx.host.delegate.onProjectOpenInIde?.(project);
    });
    openBtn.addEventListener('keydown', ev => ev.stopPropagation());
    return openBtn;
}

export function createSessionsSidebarNewAgentControlExtracted(ctx: any, project: MobileProjectEntry): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-work-hub-sessions-sidebar-project-new-agent';
    const newAgentLabel = nls.localize('qaap/sessionsSidebar/newChat', 'New agent');
    btn.setAttribute('aria-label', newAgentLabel);
    btn.title = newAgentLabel;
    const icon = document.createElement('span');
    icon.className = 'codicon codicon-add';
    icon.setAttribute('aria-hidden', 'true');
    btn.append(icon);
    btn.addEventListener('click', ev => {
        ev.stopPropagation();
        void ctx.openEmptyMobileChatSheet(project);
    });
    btn.addEventListener('keydown', ev => ev.stopPropagation());
    return btn;
}

export function onSessionsSidebarViewModeChangeExtracted(ctx: any, id: MobileViewToggleId): void {
    if (id === 'editor') {
        if (!ctx.host.commands.getCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
            || !ctx.host.commands.isEnabled(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)) {
            return;
        }
        void ctx.host.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
            .catch((error: unknown) => {
                console.warn('[qaap-mobile-shell] failed to open the desktop IDE', error);
            });
        return;
    }
    if (!ctx.host.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)
        || !ctx.host.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
        return;
    }
    void ctx.host.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, id)
        .catch((error: unknown) => {
            console.warn('[qaap-mobile-shell] failed to activate the IDE header view', error);
        });
}

export async function onWorkHubSessionsSidebarNewChatExtracted(ctx: any): Promise<void> {
    const project = ctx.resolveWorkHubSessionsSidebarProject();
    if (!project) {
        await ctx.host.onNewClick();
        return;
    }
    await ctx.openEmptyMobileChatSheet(project);
}

export async function openEmptyMobileChatSheetExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
    ctx.host.sessionsSidebar?.hide();
    if (ctx.host.shouldUseAgentsHubLanding() && !ctx.host.isProjectDetailView()) {
        // Card-menu / sidebar "New agent" must scope the idle Agents shell to THIS project.
        // Without activateAgentsHubProject, closeAgentsHubSession falls back to the workspace /
        // pinned project and the new section appears under the wrong repo.
        await ctx.host.activateAgentsHubProject(project);
        ctx.host.resetAgentsHubIdleTranscriptShell(project);
        const cwd = ctx.host.projectsService.getProjectCwd(project);
        const defaultAgent = (cwd ? readStoredAgent(cwd) : undefined)
            ?? ctx.host.activeTasks?.getDefaultAgent()
            ?? SHELL_AGENT_ID;
        ctx.host.transcriptStickyComposerUi.resetToProjectComposerDefaults(project, defaultAgent);
        ctx.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
        if (ctx.host.visible) {
            ctx.host.renderHeader();
            ctx.host.renderSubtitle();
        }
        ctx.host.stickyComposerRenderUi.renderStickyComposer();
        return;
    }
    // Non–Agents-hub path: open a pending empty transcript scoped to the card project.
    ctx.host.agentsHubSelectedProjectId = project.id;
    const cwd = ctx.host.projectsService.getProjectCwd(project);
    const agentId = (cwd ? readStoredAgent(cwd) : undefined)
        ?? ctx.host.activeTasks?.getDefaultAgent()
        ?? SHELL_AGENT_ID;
    const summary: QaapAgentConversationSummaryDTO = {
        id: `pending-new-chat-${project.id}-${Date.now()}`,
        cwd: cwd ?? '',
        workspacePath: cwd,
        agentId,
        title: nls.localize('qaap/mobileProjects/newChatTitle', 'New agent'),
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
    };
    await ctx.host.transcriptSheetUi.openTranscriptSheet(project, summary);
}

export function onSessionsSidebarAccountClickExtracted(ctx: any, anchor: HTMLButtonElement): void {
    toggleQaapAccountMenu(
        anchor,
        ctx.host.commands,
        buildQaapAccountMenuEntries(readQaapSignedIn()),
        {
            section: QAAP_WORK_HUB_GETTING_STARTED,
            onCatalogAction: action => { void ctx.host.runCatalogAction(action); },
        },
        {
            placement: 'above',
            anchorGap: 2,
            onMenuAction: () => { ctx.host.sessionsSidebar?.hide(); },
        },
    );
}

export async function openSessionsSidebarSearchExtracted(ctx: any): Promise<void> {
    if (!ctx.host.quickInputService) {
        return;
    }
    const project = ctx.resolveWorkHubSessionsSidebarProject();
    if (!project) {
        return;
    }
    const conversations = [...ctx.host.conversationIndexUi.conversationsForProject(project)]
        .sort((a, b) => b.updatedAt - a.updatedAt);
    type SessionPickItem = QuickPickItem & { summary: QaapAgentConversationSummaryDTO };
    const quickPick = ctx.host.quickInputService.createQuickPick<SessionPickItem>();
    quickPick.placeholder = nls.localize('qaap/sessionsSidebar/searchPlaceholder', 'Search sessions');
    quickPick.items = conversations.map(summary => ({
        label: summary.title?.trim() || nls.localize('qaap/mobileProjects/untitledChat', 'Untitled chat'),
        description: summary.agentId,
        summary,
    }));
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected?.summary) {
            ctx.host.sessionsSidebar?.hide();
            void ctx.host.openConversationSummary(project, selected.summary);
        }
        quickPick.hide();
    });
    quickPick.show();
}

import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
// Extracted from mobile-projects-panel.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import {
    MobileProjectEntry,
    MobileProjectsHubView,
} from './mobile-projects-types';
import { type WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import { QAAP_NAVIGATE_TO_CONVERSATION_EVENT } from './qaap-turn-settle-notifier';
import {
    type WorkHubTeamMember,
} from '../common/qaap-work-hub-team';
import {
    buildProbeStreamingSummaries,
    ensureProbeWorkspaceProject,
    QAAP_PROBE_WORKSPACE_PROJECT_ID,
} from './qaap-work-hub-perf-probe-host';
import { installQaapWorkHubPerfProbe } from './qaap-work-hub-perf-probe';
import type { WorkHubPerfProbeDiagnostics } from '../common/qaap-work-hub-perf-probe';
import {
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
} from './qaap-workbench-account-menu';
import { QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT } from './qaap-mobile-app-tester-contribution';

export function bindAgentFinishedToastCallbacksExtracted(ctx: MobileProjectsPanelContext): void {
    ctx.agentFinishedToast?.bindPanelCallbacks({
        resolveOpenConversationId: () => ctx.transcriptController.state.transcriptOpenSummaryId,
        openConversation: (project, summary) => { void ctx.openConversationSummary(project, summary); },
        resolveProjectForConversation: conversationId => {
            for (const project of ctx.projects) {
                const cwd = ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
                if (!cwd) {
                    continue;
                }
                const summary = ctx.conversations?.threadStore.getSummariesForCwd(cwd)
                    .find(s => s.id === conversationId);
                if (summary) {
                    return { project, summary };
                }
            }
            return undefined;
        },
    });
}

/**
 * Activation handler for the agent turn-settle notification: opens the originating conversation's
 * transcript sheet in the Work Hub. Dispatched by `QaapTurnSettleNotifyContribution` via
 * `QAAP_NAVIGATE_TO_CONVERSATION_EVENT` so the summary-layer notifier (which has no panel reference)
 * can still route the user to the exact session the agent was working on instead of the classic-IDE
 * chat panel.
 */
export function onNavigateToConversationHandler(ctx: MobileProjectsPanelContext, event: Event): void {
    const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
    const conversationId = detail?.conversationId;
    if (!conversationId) {
        return;
    }
    for (const project of ctx.projects) {
        const cwd = ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            continue;
        }
        const summary = ctx.conversations?.threadStore.getSummariesForCwd(cwd)
            .find(s => s.id === conversationId);
        if (summary) {
            void ctx.openConversationSummary(project, summary);
            return;
        }
    }
}

export function ensureAgentsHubExecutionShellRenderedExtracted(ctx: MobileProjectsPanelContext): void {
    if (ctx.pullRequestDetail !== undefined || ctx.isPullRequestsSidebarVisible?.() === true) {
        return;
    }
    ctx.syncCurrentProjectsScrollHost();
    if (ctx.isAgentsHubExecutionSurfaceReady()) {
        return;
    }
    const visible = ctx.visible || (!ctx.root.hidden && ctx.root.classList.contains('theia-mod-visible'));
    const tasksHub = ctx.hubView === 'tasks' || ctx.root.classList.contains('theia-mod-hub-tasks');
    const agentsLanding = ctx.shouldUseAgentsHubLanding()
        || ctx.root.classList.contains('theia-mod-agents-hub-landing');
    if (visible && tasksHub && agentsLanding) {
        ctx.visible = true;
        ctx.hubView = 'tasks';
        ctx.agentsHubLegacyInbox = false;
        const workspaceCwd = ctx.projectsService.getCurrentWorkspaceCwd();
        if (workspaceCwd) {
            ctx.projects = ensureProbeWorkspaceProject(ctx.projects, ctx.projectsService, workspaceCwd);
            for (const project of ctx.projects) {
                const cwd = project.id === QAAP_PROBE_WORKSPACE_PROJECT_ID
                    ? workspaceCwd
                    : ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
                if (cwd) {
                    ctx.preparedCwdByProjectId.set(project.id, cwd);
                }
            }
        }
        ctx.renderAgentsHubExecutionShell();
        ctx.stickyComposerRenderUi.renderStickyComposer();
        ctx.composerHeaderUi.syncHeaderComposerSurfacePicker();
    }
}

export function syncCurrentProjectsScrollHostExtracted(ctx: MobileProjectsPanelContext): void {
    const current = ctx.currentProjectsScrollHost();
    if (current !== ctx.scroll) {
        (ctx as unknown as { scroll: HTMLElement }).scroll = current;
    }
}

export function installAgentsHubEmptySurfaceGuardExtracted(ctx: MobileProjectsPanelContext): void {
    if (!ctx.homeMode || typeof window === 'undefined') {
        return;
    }
    let frame: number | undefined;
    let interval: number | undefined;
    const schedule = (): void => {
        if (frame !== undefined) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = undefined;
            ctx.ensureAgentsHubExecutionShellRendered();
        });
    };
    const observer = typeof MutationObserver !== 'undefined'
        ? new MutationObserver(schedule)
        : undefined;
    observer?.observe(ctx.root, { attributes: true, attributeFilter: ['class', 'hidden'] });
    observer?.observe(ctx.scroll, { childList: true });
    interval = window.setInterval(schedule, 2000);
    ctx.agentsHubEmptySurfaceGuardDispose = Disposable.create(() => {
        observer?.disconnect();
        if (interval !== undefined) {
            window.clearInterval(interval);
            interval = undefined;
        }
        if (frame !== undefined) {
            window.cancelAnimationFrame(frame);
            frame = undefined;
        }
    });
    schedule();
}

export function selectHubLandingViewExtracted(ctx: MobileProjectsPanelContext, view: MobileProjectsHubView,
    preferredDiffProjectId?: string,
    options?: { force?: boolean },): void {
    ctx.hubLandingUi.selectHubLandingView(view, preferredDiffProjectId, options);
}

export function disposeExtracted(ctx: MobileProjectsPanelContext): void {
    window.removeEventListener(QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT, ctx.onBootstrapPreviewOpened);
    window.removeEventListener(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, ctx.onNavigateToConversation);
    ctx.closeHeaderOverflowMenu();
    ctx.closeHeaderIdeViewPickerMenu();
    ctx.headerOverflowMenu?.remove();
    ctx.headerOverflowMenu = undefined;
    ctx.headerIdeViewPickerMenu?.remove();
    ctx.headerIdeViewPickerMenu = undefined;
    document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
    ctx.composerEditorContextService?.registerPanelDelegate(undefined);
    ctx.hubListRenderScheduler.dispose();
    ctx.agentsHubEmptySurfaceGuardDispose.dispose();
    ctx.agentsHubEmptySurfaceGuardDispose = Disposable.NULL;
    ctx.panelChromeUi.dispose();
    ctx.panelLifecycleUi.dispose();
}

export function hideExtracted(ctx: MobileProjectsPanelContext): void {
    document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
    ctx.closeHeaderIdeViewPickerMenu();
    ctx.panelLifecycleUi.hide();
}

export async function activateAgentsHubProjectExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry): Promise<void> {
    ctx.agentsHubSelectedProjectId = project.id;
    ctx.expandedId = undefined;
    ctx.soloExpanded = false;
    ctx.agentsHubLegacyInbox = false;
    ctx.projectNavigationUi.resetProjectDetailSurfaces();
    ctx.transcriptSheetUi.closeTranscriptSheet();
    const cwd = await ctx.projectsService.prepareProjectCwd(project);
    if (cwd) {
        ctx.preparedCwdByProjectId.set(project.id, cwd);
    }
    if (ctx.agentsHubInlineActive) {
        ctx.agentsHubInlineUi.closeAgentsHubSession();
    }
    if (!ctx.homeMode) {
        ctx.render();
        ctx.syncLandingHubListChrome();
        return;
    }
    if (ctx.hubView !== 'tasks') {
        ctx.selectHubLandingView('tasks', undefined, { force: true });
        return;
    }
    ctx.renderAgentsHubExecutionShell();
    ctx.stickyComposerRenderUi.renderStickyComposer();
    ctx.render();
    ctx.syncLandingHubListChrome();
    ctx.notifyWorkspaceHubBottomBarRefresh();
}

export function touchProjectActivityByConversationIdExtracted(ctx: MobileProjectsPanelContext, conversationId: string): void {
    if (!conversationId) {
        return;
    }
    // Find the project that owns this conversation.
    let touched = false;
    const now = new Date().toISOString();
    for (const project of ctx.projects) {
        const cwd = ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            continue;
        }
        const hasConversation = ctx.conversations?.threadStore.getSummariesForCwd(cwd)
            .some(s => s.id === conversationId);
        if (hasConversation) {
            // Only bump if the conversation is newer than the project's current lastActiveAt.
            const current = project.lastActiveAt ? Date.parse(project.lastActiveAt) : 0;
            if (Date.now() > current) {
                project.lastActiveAt = now;
                project.lastActive = nls.localize('qaap/mobileProjects/lastActiveNow', 'now');
            }
            touched = true;
            break;
        }
    }
    if (touched) {
        // Re-sort: most recent first.
        ctx.projects.sort((a, b) => {
            const timeA = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
            const timeB = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
            return timeB - timeA;
        });
    }
}

export function syncWorkHubProjectSkillRootsExtracted(ctx: MobileProjectsPanelContext): void {
    if (!ctx.workHubProjectSkillRoots) {
        return;
    }
    const cwds: string[] = [];
    for (const project of ctx.projects) {
        const cwd = ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
        if (cwd?.trim()) {
            cwds.push(cwd.trim());
        }
    }
    ctx.workHubProjectSkillRoots.syncProjectCwds(cwds);
}

export function tryPatchHubListBeforeRebuildExtracted(ctx: MobileProjectsPanelContext): boolean {
    if (ctx.hubQueryUi.isHomeHubView() && ctx.missionControlHubUi.tryPatchBeforeRebuild()) {
        ctx.subtitleUi.renderSubtitle();
        return true;
    }
    return ctx.hubIncrementalUi.tryPatchBeforeRebuild();
}

export function maybeInstallWorkHubPerfProbeExtracted(ctx: MobileProjectsPanelContext): void {
    const panel = ctx as MobileProjectsPanelContext & {
        transcriptSheet?: HTMLElement;
        transcriptChatHost?: HTMLElement;
        transcriptOpenSummaryId?: string;
    };
    installQaapWorkHubPerfProbe({
        scroll: panel.scroll,
        conversations: panel.conversations,
        getSessionsSidebar: () => panel.sessionsSidebar,
        getTranscriptSheet: () => panel.transcriptSheet,
        setTranscriptSheet: value => { panel.transcriptSheet = value; },
        getTranscriptChatHost: () => panel.transcriptChatHost,
        setTranscriptChatHost: value => { panel.transcriptChatHost = value; },
        getTranscriptOpenSummaryId: () => panel.transcriptOpenSummaryId,
        setTranscriptOpenSummaryId: value => { panel.transcriptOpenSummaryId = value; },
        openWorkHubSessionsSidebar: () => panel.sessionsSidebarUi.openWorkHubSessionsSidebar(),
        navigateToHomeHubForProbe: () => {
            // `navigateHubTab('home')` normalizes to `tasks` (Agents landing). Mission Control only
            // mounts when hubView is literally `home`, so set it directly for the probe.
            panel.agentsHubLegacyInbox = true;
            if (panel.agentsHubShellActive) {
                panel.teardownAgentsHubExecutionShell();
            }
            panel.hubView = 'home';
            panel.setMissionControlExpanded(true);
            panel.renderList();
        },
        expandMissionControlForProbe: () => {
            panel.setMissionControlExpanded(true);
            panel.renderList();
        },
        showTasksInboxWithTeamForProbe: () => {
            panel.navigateHubTab('tasks');
            panel.agentsHubLegacyInbox = true;
            panel.renderList();
        },
        seedMultiAgentProbeConversations: () => {
            if (!panel.conversations) {
                return;
            }
            panel.conversations.start();
            panel.activeTasks?.start();
            const workspaceCwd = panel.projectsService.getCurrentWorkspaceCwd();
            if (workspaceCwd) {
                panel.projects = ensureProbeWorkspaceProject(panel.projects, panel.projectsService, workspaceCwd);
                for (const project of panel.projects) {
                    const cwd = project.id === QAAP_PROBE_WORKSPACE_PROJECT_ID
                        ? workspaceCwd
                        : panel.preparedCwdByProjectId.get(project.id)
                        ?? panel.projectsService.getProjectCwd(project);
                    if (cwd) {
                        panel.preparedCwdByProjectId.set(project.id, cwd);
                    }
                }
            }
            const cwdSet = new Set<string>();
            for (const project of panel.projects) {
                const cwd = panel.preparedCwdByProjectId.get(project.id)
                    ?? panel.projectsService.getProjectCwd(project);
                if (cwd) {
                    cwdSet.add(cwd);
                }
            }
            if (workspaceCwd) {
                cwdSet.add(workspaceCwd);
            }
            if (cwdSet.size === 0) {
                return;
            }
            for (const cwd of cwdSet) {
                panel.conversations.perfProbeSeedSummaries(cwd, buildProbeStreamingSummaries(cwd));
            }
            panel.renderList();
        },
        tickProbeStreamingConversations: () => {
            if (!panel.conversations) {
                return;
            }
            const cwdSet = new Set<string>();
            for (const project of panel.projects) {
                const cwd = panel.preparedCwdByProjectId.get(project.id)
                    ?? panel.projectsService.getProjectCwd(project);
                if (cwd) {
                    cwdSet.add(cwd);
                }
            }
            const workspaceCwd = panel.projectsService.getCurrentWorkspaceCwd();
            if (workspaceCwd) {
                cwdSet.add(workspaceCwd);
            }
            for (const cwd of cwdSet) {
                panel.conversations.perfProbeTickStreamingSummaries(cwd);
            }
            // Conversation ticks while Agents Hub landing is active skip full list rebuilds.
            // Force a paint so probe E2E can assert progress patches (team-since / MC progress).
            const teamRoot = panel.scroll.querySelector<HTMLElement>(
                '.theia-mobile-hub-team-root.theia-mod-embedded-in-tasks',
            );
            if (teamRoot) {
                panel.hubIncrementalUi.tryPatchTeamSection(teamRoot);
            }
            if (!panel.missionControlHubUi.tryPatchBeforeRebuild()) {
                panel.renderList();
            }
        },
        renderTranscriptForProbe: (conversation, chatHost) => {
            panel.transcriptOpenSummaryId = conversation.id;
            panel.transcriptMessagesUi.renderTranscriptMessages(chatHost, conversation);
        },
        hasProjectsForProbe: () => panel.projects.length > 0,
        hasWorkspaceForProbe: () => !!panel.projectsService.getCurrentWorkspaceCwd(),
        getWorkspaceCwdForProbe: () => panel.projectsService.getCurrentWorkspaceCwd(),
        getProbeDiagnostics: (): WorkHubPerfProbeDiagnostics => ({
            projectCount: panel.projects.length,
            mcRowCount: panel.scroll.querySelectorAll('.theia-mobile-mission-control-row').length,
            teamRowCount: panel.scroll.querySelectorAll(
                '.theia-mobile-hub-team-root.theia-mod-embedded-in-tasks .theia-mobile-hub-team-row',
            ).length,
            hubView: panel.hubView,
        }),
    });
}

export function getFilteredTeamHubStateExtracted(ctx: MobileProjectsPanelContext): {
    members: WorkHubTeamMember[];
    filteredApprovals: WorkHubApprovalItem[];
} {
    return ctx.tasksHubAttentionUi.getFilteredTeamHubState();
}

export async function openDesktopIdeFromAgentsHubExtracted(ctx: MobileProjectsPanelContext): Promise<void> {
    if (ctx.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)
        && ctx.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
        await ctx.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, 'editor');
        ctx.hide();
        return;
    }
    if (!ctx.commands.getCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
        || !ctx.commands.isEnabled(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)) {
        return;
    }
    await ctx.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
    ctx.hide();
}

export function collectSessionsSidebarPinnedGroupsExtracted(ctx: MobileProjectsPanelContext, projects: MobileProjectEntry[],
    query: string,): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
    return ctx.sessionsSidebarUi.collectSessionsSidebarPinnedGroups(projects, query);
}

export function createSessionsSidebarPinnedSectionExtracted(ctx: MobileProjectsPanelContext, groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>,
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarPinnedSection(groups, onActivate, bypassConversationLimit);
}

export function getSessionsSidebarConversationDisplayLimitExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    totalCount: number,
    bypassLimit: boolean,): number {
    return ctx.sessionsSidebarUi.getSessionsSidebarConversationDisplayLimit(project, totalCount, bypassLimit);
}

export function resolveSessionsSidebarVisibleConversationsExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    bypassLimit: boolean,): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
    return ctx.sessionsSidebarUi.resolveSessionsSidebarVisibleConversations(project, conversations, bypassLimit);
}

export function appendSessionsSidebarConversationItemsExtracted(ctx: MobileProjectsPanelContext, listHost: HTMLElement,
    project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassLimit: boolean,): void {
    ctx.sessionsSidebarUi.appendSessionsSidebarConversationItems(listHost, project, conversations, onActivate, bypassLimit);
}

export function createSessionsSidebarShowMoreControlExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    hiddenCount: number,
    totalCount: number,): HTMLButtonElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarShowMoreControl(project, hiddenCount, totalCount);
}

export function createSessionsSidebarPinnedProjectGroupExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarPinnedProjectGroup(project, conversations, onActivate, bypassConversationLimit);
}

export function createSessionsSidebarProjectGroupExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarProjectGroup(project, conversations, onActivate, bypassConversationLimit);
}

export function createSessionsSidebarProjectRowHeadExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    expanded: boolean,
    onToggleExpand: () => void,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarProjectRowHead(project, expanded, onToggleExpand);
}

export function onHeaderProjectClickExtracted(ctx: MobileProjectsPanelContext, anchor: HTMLButtonElement): void {
    const project = ctx.hubHeaderUi.resolveHeaderProject();
    if (!project) {
        return;
    }
    ctx.stickyComposerWorkspaceUi.openComposerWorkspaceProjectSheet(project, false, anchor);
}

export function syncHeaderIdeViewPickerExtracted(ctx: MobileProjectsPanelContext): void {
    ctx.headerIdeViewPickerHost.hidden = true;
    ctx.headerIdeViewPickerHost.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
    ctx.headerIdeViewPickerHost.replaceChildren();
    ctx.headerIdeViewPickerBtn = undefined;
    ctx.closeHeaderIdeViewPickerMenu();
}

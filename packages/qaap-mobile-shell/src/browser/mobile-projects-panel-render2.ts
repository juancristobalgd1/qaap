// @ts-nocheck
// Extracted from mobile-projects-panel.ts

import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import * as markdownit from '@theia/core/shared/markdown-it';
import * as markdownitemoji from '@theia/core/shared/markdown-it-emoji';
import type { QuickPick } from '@theia/core/lib/common/quick-pick-service';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { AIVariable, AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatAgent, ChatService, ChatSession } from '@theia/ai-chat';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { MobileProjectChatViewWidget } from './mobile-project-ai-chat-input-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import {
    MobileProjectEntry,
    MobileProjectFilter,
    MobileProjectsHubView,
} from './mobile-projects-types';
import { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import { MobileProjectsParallelUi } from './mobile-projects-parallel-ui';
import { MobileProjectsTeamUi } from './mobile-projects-team-ui';
import { MobileProjectsTeamHubUi, type WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import { QAAP_NAVIGATE_TO_CONVERSATION_EVENT } from './qaap-turn-settle-notifier';
import type { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';
import {
    type WorkHubTeamMember,
} from '../common/qaap-work-hub-team';
import { MobileProjectsHomeUi, type WorkHubHomeNavigateTarget, type WorkHubHomeQuickActionId } from './mobile-projects-home-ui';
import { MobileProjectsService } from './mobile-projects-service';
import {
    isAgentsHubExecutionSurfacePainted,
    isAgentsHubIdleConversationSummary,
} from '../common/qaap-agents-hub-landing';
import { normalizeQaapPreviewConversationId } from '../common/qaap-preview-identity';
import { QaapChatViewStreamUpdateScheduler } from '../common/qaap-chat-view-stream-update-scheduler';
import {
    buildProbeStreamingSummaries,
    ensureProbeWorkspaceProject,
    QAAP_PROBE_WORKSPACE_PROJECT_ID,
} from './qaap-work-hub-perf-probe-host';
import { installQaapWorkHubPerfProbe } from './qaap-work-hub-perf-probe';
import type { WorkHubPerfProbeDiagnostics } from '../common/qaap-work-hub-perf-probe';
import { QaapBoundedLruMap } from './qaap-bounded-lru-map';
import {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { formatConversationForClipboard } from '../common/qaap-conversation-clipboard-text';
import {
    agentHasCliOAuthLogin,
    localizeAgentSettingsApiKeyLoginMessage,
} from '../common/qaap-agent-auth-login';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { MobileSnackbar } from './mobile-snackbar';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import {
    type QaapAgentTaskAgentOption,
    type QaapQaiqModelOption,
    type QaapAgentTaskListSnapshot,
} from '../common/qaap-agent-task-client';
import {
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    type StickyComposerContextChipView,
} from './qaap-sticky-composer-context-ui';
import {
    createComposerContextEntry,
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    buildPreviewFeedbackAttachmentRequest,
    findPreviewFeedbackEntryIndex,
    normalizeAttachComposerImages,
    type QaapAttachComposerImageAttachment,
} from '../common/qaap-preview-feedback-context';
import { URI } from '@theia/core/lib/common/uri';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import { type QaapSegmentedFieldController } from './qaap-mobile-form-ui';
import {
    buildQaapAccountMenuEntries,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    toggleQaapAccountMenu,
    type MobileViewToggleId,
} from './qaap-workbench-account-menu';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapPreviewInspectorDeps } from '@theia/qaap-adapters/lib/browser/qaap-preview-inline-inspector';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import { createAnnotationComposerSessionControls } from './qaap-preview-annotation-composer-session';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    type ExecutionSurfaceTabId,
} from '../common/qaap-execution-surface-tabs';
import { MobileProjectsExecutionSurfaceTabsUi, type MobileProjectsExecutionSurfaceTabsHost } from './mobile-projects-execution-surface-tabs-ui';
import { type MobileProjectsTranscriptOverlayHost } from './mobile-projects-transcript-overlay-host';
import { TranscriptOverlayController } from './mobile-projects-transcript-overlay-controller';
import { bindTranscriptOverlayStateAccessors } from './mobile-projects-transcript-overlay-state';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import type { MobileBottomButtonId } from './mobile-shell-bottom-bar-widget';
import { MobileProjectsTasksHubUi, type MobileProjectsTasksHubHost } from './mobile-projects-tasks-hub-ui';
import { MobileProjectsWorkHubInboxUi, type MobileProjectsWorkHubInboxHost } from './mobile-projects-work-hub-inbox-ui';
import { MobileProjectsTheiaChatSessionUi, type MobileProjectsTheiaChatSessionHost } from './mobile-projects-theia-chat-session-ui';
import { MobileProjectsHubCatalogUi, type MobileProjectsHubCatalogHost } from './mobile-projects-hub-catalog-ui';
import { MobileProjectsHubRoutineEditorUi, type MobileProjectsHubRoutineEditorHost } from './mobile-projects-hub-routine-editor-ui';
import { MobileProjectsProjectActionsUi, type MobileProjectsProjectActionsHost } from './mobile-projects-project-actions-ui';
import { MobileProjectsInboxPrUi, type MobileProjectsInboxPrHost } from './mobile-projects-inbox-pr-ui';
import { MobileProjectsCardMenuUi, type MobileProjectsCardMenuHost } from './mobile-projects-card-menu-ui';
import {
    MobileProjectsProjectRowsUi,
    MOBILE_PROJECTS_CONVERSATIONS_COLLAPSED_LIMIT,
    type MobileProjectsProjectRowsHost,
} from './mobile-projects-project-rows-ui';
import { MobileProjectsHubTeamDataUi, type MobileProjectsHubTeamDataHost } from './mobile-projects-hub-team-data-ui';
import { MobileProjectsConversationActionsUi, type MobileProjectsConversationActionsHost } from './mobile-projects-conversation-actions-ui';
import { MobileProjectsAgentsHubInlineUi, type MobileProjectsAgentsHubInlineHost } from './mobile-projects-agents-hub-inline-ui';
import {
    MobileProjectsBackgroundTaskUi,
    type MobileProjectsBackgroundTaskHost,
} from './mobile-projects-background-task-ui';
import {
    MobileProjectsChatServiceSummariesUi,
    type MobileProjectsChatServiceSummariesHost,
} from './mobile-projects-chat-service-summaries-ui';
import {
    MobileProjectsComposerHeaderUi,
    type MobileProjectsComposerHeaderHost,
} from './mobile-projects-composer-header-ui';
import {
    MobileProjectsConversationIndexUi,
    type MobileProjectsConversationIndexHost,
} from './mobile-projects-conversation-index-ui';
import {
    MobileProjectsConversationOpenUi,
    type MobileProjectsConversationOpenHost,
} from './mobile-projects-conversation-open-ui';
import {
    MobileProjectsDiffHubUi,
    type MobileProjectsDiffHubHost,
} from './mobile-projects-diff-hub-ui';
import {
    MobileProjectsHomeHubUi,
    type MobileProjectsHomeHubHost,
} from './mobile-projects-home-hub-ui';
import {
    MobileProjectsMissionControlHubUi,
} from './mobile-projects-mission-control-hub-ui';
import type {
    MissionControlLaneFilter,
    MissionControlSurfaceFilter,
} from './mobile-work-mission-control';
import {
    MobileProjectsHubHeaderUi,
    type MobileProjectsHubHeaderHost,
} from './mobile-projects-hub-header-ui';
import {
    MobileProjectsHubLandingUi,
    type MobileProjectsHubLandingHost,
} from './mobile-projects-hub-landing-ui';
import {
    MobileProjectsHubListChromeUi,
    type MobileProjectsHubListChromeHost,
} from './mobile-projects-hub-list-chrome-ui';
import {
    MobileProjectsHubQueryUi,
    type MobileProjectsHubQueryHost,
} from './mobile-projects-hub-query-ui';
import {
    MobileProjectsHubRenderUi,
    type MobileProjectsHubRenderHost,
} from './mobile-projects-hub-render-ui';
import {
    MobileProjectsOverlayFactoryUi,
    type MobileProjectsOverlayFactoryHost,
} from './mobile-projects-overlay-factory-ui';
import {
    MobileProjectsProjectDetailUi,
    type MobileProjectsProjectDetailHost,
} from './mobile-projects-project-detail-ui';
import {
    MobileProjectsProjectNavigationUi,
    type MobileProjectsProjectNavigationHost,
} from './mobile-projects-project-navigation-ui';
import {
    MobileProjectsHubIncrementalUi,
    type MobileProjectsHubIncrementalPatchHost,
} from './mobile-projects-hub-incremental-ui';
import {
    MobileProjectsRenderListUi,
    type MobileProjectsRenderListHost,
} from './mobile-projects-render-list-ui';
import {
    MobileProjectsRepoFiltersUi,
    type MobileProjectsRepoFiltersHost,
} from './mobile-projects-repo-filters-ui';
import {
    MobileProjectsRepoLifecycleUi,
    type MobileProjectsRepoLifecycleHost,
} from './mobile-projects-repo-lifecycle-ui';
import {
    MobileProjectsSubtitleUi,
    type MobileProjectsSubtitleHost,
} from './mobile-projects-subtitle-ui';
import {
    MobileProjectsTasksHubAttentionUi,
    type MobileProjectsTasksHubAttentionHost,
} from './mobile-projects-tasks-hub-attention-ui';
import {
    MobileProjectsPanelLifecycleUi,
    type MobileProjectsPanelLifecycleHost,
} from './mobile-projects-panel-lifecycle-ui';
import {
    MobileProjectsPanelChromeUi,
    type MobileProjectsPanelChromeHost,
} from './mobile-projects-panel-chrome-ui';
import {
    MobileProjectsActiveTaskActionsUi,
    type MobileProjectsActiveTaskActionsHost,
} from './mobile-projects-active-task-actions-ui';
import {
    MobileProjectsWorkHubSearchUi,
    type MobileProjectsWorkHubSearchHost,
} from './mobile-projects-work-hub-search-ui';
import {
    MobileProjectsStickyComposerContextUi,
    type MobileProjectsStickyComposerContextHost,
} from './mobile-projects-sticky-composer-context-ui';
import {
    MobileProjectsStickyComposerAgentsUi,
    type MobileProjectsStickyComposerAgentsHost,
} from './mobile-projects-sticky-composer-agents-ui';
import {
    MobileProjectsStickyComposerSheetsUi,
    type MobileProjectsStickyComposerSheetsHost,
} from './mobile-projects-sticky-composer-sheets-ui';
import {
    MobileProjectsStickyComposerWorkspaceUi,
    type MobileProjectsStickyComposerWorkspaceHost,
} from './mobile-projects-sticky-composer-workspace-ui';
import {
    MobileProjectsStickyComposerColumnUi,
    type MobileProjectsStickyComposerColumnHost,
} from './mobile-projects-sticky-composer-column-ui';
import {
    MobileProjectsStickyComposerRenderUi,
    type MobileProjectsStickyComposerRenderHost,
} from './mobile-projects-sticky-composer-render-ui';
import {
    type QaapTranscriptLiveRefreshOptions,
} from './qaap-transcript-live-controller';
import {
    MobileProjectsSessionsSidebarUi,
    type MobileProjectsSessionsSidebarHost,
} from './mobile-projects-sessions-sidebar-ui';
import { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import {
    type WorkHubHomeAttentionItem,
    type WorkHubHomeRecentItem,
    type WorkHubHomeSnapshot,
} from '../common/qaap-work-hub-home';
import {
    type QaapComposerSurface,
} from '../common/qaap-composer-surface';
import {
    QAAP_WORK_HUB_GETTING_STARTED,
    type WorkHubCatalogAction,
} from '../common/mobile-work-hub-catalog';
import {
    type QaapWorkHubRoutine,
} from '../common/qaap-work-hub-routine';
import {
    type MobileWorkHubInboxItem,
} from './mobile-work-hub-inbox';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT } from './qaap-mobile-app-tester-contribution';
import type { TranscriptFilesViewServices } from './qaap-transcript-files-view';
import type { TranscriptTerminalViewServices } from './qaap-transcript-terminal-view';
import {
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';
import {
    createHeaderIdeViewIcon as createHeaderIdeViewIconHelper,
    createHeaderIdeViewChevron as createHeaderIdeViewChevronHelper,
    appendHeaderOverflowSeparator as appendHeaderOverflowSeparatorHelper,
    positionHeaderIdeViewPickerMenu as positionHeaderIdeViewPickerMenuHelper,
    positionHeaderOverflowMenu as positionHeaderOverflowMenuHelper,
} from './mobile-projects-panel-dom-helpers';
import {
    projectOwnsActiveBootstrap as projectOwnsActiveBootstrapHelper,
    isCopyConversationEnabled as isCopyConversationEnabledHelper,
    resolveActiveConversationForCopy as resolveActiveConversationForCopyHelper,
    renderHeaderOverflowMenuItems as renderHeaderOverflowMenuItemsHelper,
    sendExternalComposerContext as sendExternalComposerContextHelper,
} from './mobile-projects-panel-helpers';

export function bindAgentFinishedToastCallbacksExtracted(ctx: any): void {
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
export function onNavigateToConversationHandler(ctx: any, event: Event): void {
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
            .find((s: any) => s.id === conversationId);
        if (summary) {
            void ctx.openConversationSummary(project, summary);
            return;
        }
    }
}

export function ensureAgentsHubExecutionShellRenderedExtracted(ctx: any): void {
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

export function syncCurrentProjectsScrollHostExtracted(ctx: any): void {
    const current = ctx.currentProjectsScrollHost();
    if (current !== ctx.scroll) {
        (ctx as unknown as { scroll: HTMLElement }).scroll = current;
    }
}

export function installAgentsHubEmptySurfaceGuardExtracted(ctx: any): void {
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

export function selectHubLandingViewExtracted(ctx: any, view: MobileProjectsHubView,
    preferredDiffProjectId?: string,
    options?: { force?: boolean },): void {
    ctx.hubLandingUi.selectHubLandingView(view, preferredDiffProjectId, options);
}

export function disposeExtracted(ctx: any): void {
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

export function hideExtracted(ctx: any): void {
    document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
    ctx.closeHeaderIdeViewPickerMenu();
    ctx.panelLifecycleUi.hide();
}

export async function activateAgentsHubProjectExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
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

export function touchProjectActivityByConversationIdExtracted(ctx: any, conversationId: string): void {
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

export function syncWorkHubProjectSkillRootsExtracted(ctx: any): void {
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

export function tryPatchHubListBeforeRebuildExtracted(ctx: any): boolean {
    if (ctx.hubQueryUi.isHomeHubView() && ctx.missionControlHubUi.tryPatchBeforeRebuild()) {
        ctx.subtitleUi.renderSubtitle();
        return true;
    }
    return ctx.hubIncrementalUi.tryPatchBeforeRebuild();
}

export function maybeInstallWorkHubPerfProbeExtracted(ctx: any): void {
    const panel = ctx as MobileProjectsPanel & {
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

export function getFilteredTeamHubStateExtracted(ctx: any): {
    members: WorkHubTeamMember[];
    filteredApprovals: WorkHubApprovalItem[];
} {
    return ctx.tasksHubAttentionUi.getFilteredTeamHubState();
}

export async function openDesktopIdeFromAgentsHubExtracted(ctx: any): Promise<void> {
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

export function collectSessionsSidebarPinnedGroupsExtracted(ctx: any, projects: MobileProjectEntry[],
    query: string,): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
    return ctx.sessionsSidebarUi.collectSessionsSidebarPinnedGroups(projects, query);
}

export function createSessionsSidebarPinnedSectionExtracted(ctx: any, groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>,
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarPinnedSection(groups, onActivate, bypassConversationLimit);
}

export function getSessionsSidebarConversationDisplayLimitExtracted(ctx: any, project: MobileProjectEntry,
    totalCount: number,
    bypassLimit: boolean,): number {
    return ctx.sessionsSidebarUi.getSessionsSidebarConversationDisplayLimit(project, totalCount, bypassLimit);
}

export function resolveSessionsSidebarVisibleConversationsExtracted(ctx: any, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    bypassLimit: boolean,): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
    return ctx.sessionsSidebarUi.resolveSessionsSidebarVisibleConversations(project, conversations, bypassLimit);
}

export function appendSessionsSidebarConversationItemsExtracted(ctx: any, listHost: HTMLElement,
    project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassLimit: boolean,): void {
    ctx.sessionsSidebarUi.appendSessionsSidebarConversationItems(listHost, project, conversations, onActivate, bypassLimit);
}

export function createSessionsSidebarShowMoreControlExtracted(ctx: any, project: MobileProjectEntry,
    hiddenCount: number,
    totalCount: number,): HTMLButtonElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarShowMoreControl(project, hiddenCount, totalCount);
}

export function createSessionsSidebarPinnedProjectGroupExtracted(ctx: any, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarPinnedProjectGroup(project, conversations, onActivate, bypassConversationLimit);
}

export function createSessionsSidebarProjectGroupExtracted(ctx: any, project: MobileProjectEntry,
    conversations: readonly QaapAgentConversationSummaryDTO[],
    onActivate: () => void,
    bypassConversationLimit = false,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarProjectGroup(project, conversations, onActivate, bypassConversationLimit);
}

export function createSessionsSidebarProjectRowHeadExtracted(ctx: any, project: MobileProjectEntry,
    expanded: boolean,
    onToggleExpand: () => void,): HTMLElement {
    return ctx.sessionsSidebarUi.createSessionsSidebarProjectRowHead(project, expanded, onToggleExpand);
}

export function onHeaderProjectClickExtracted(ctx: any, anchor: HTMLButtonElement): void {
    const project = ctx.hubHeaderUi.resolveHeaderProject();
    if (!project) {
        return;
    }
    ctx.stickyComposerWorkspaceUi.openComposerWorkspaceProjectSheet(project, false, anchor);
}

export function syncHeaderIdeViewPickerExtracted(ctx: any): void {
    ctx.headerIdeViewPickerHost.hidden = true;
    ctx.headerIdeViewPickerHost.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
    ctx.headerIdeViewPickerHost.replaceChildren();
    ctx.headerIdeViewPickerBtn = undefined;
    ctx.closeHeaderIdeViewPickerMenu();
}

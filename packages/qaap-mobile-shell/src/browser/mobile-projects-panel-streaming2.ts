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
import { isDesktopSessionsSidebarLayout } from './mobile-work-hub-sessions-sidebar';
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

export function onHeaderIdeViewPickerClickExtracted(ctx: any, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (ctx.headerIdeViewPickerMenu?.classList.contains('theia-mod-open')) {
        ctx.closeHeaderIdeViewPickerMenu();
        return;
    }
    ctx.openHeaderIdeViewPickerMenu();
}

export function openHeaderIdeViewPickerMenuExtracted(ctx: any): void {
    const picker = ctx.mobileIdeViewPicker;
    const btn = ctx.headerIdeViewPickerBtn;
    if (!picker || !btn) {
        return;
    }
    const menu = ctx.ensureHeaderIdeViewPickerMenu();
    menu.replaceChildren();
    const activeId = picker.getActiveId();
    for (const option of picker.getOptions()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qaap-work-hub-toolbar-menu-item theia-mobile-projects-ide-view-picker-item';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('aria-current', option.id === activeId ? 'true' : 'false');
        item.append(ctx.createHeaderIdeViewIcon(option.icon), document.createTextNode(option.label));
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            ctx.closeHeaderIdeViewPickerMenu();
            void Promise.resolve(picker.onSelect(option.id)).then(() => ctx.syncHeaderIdeViewPicker());
        });
        menu.append(item);
    }
    btn.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.classList.add('theia-mod-open');
    ctx.positionHeaderIdeViewPickerMenu();

    const onDismiss = (event: Event): void => {
        const target = event.target;
        if (target instanceof Node && (menu.contains(target) || btn.contains(target))) {
            return;
        }
        ctx.closeHeaderIdeViewPickerMenu();
    };
    const onReposition = (): void => ctx.positionHeaderIdeViewPickerMenu();
    window.setTimeout(() => window.addEventListener('pointerdown', onDismiss, true), 0);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    ctx.headerIdeViewPickerDismiss.dispose();
    ctx.headerIdeViewPickerDismiss = Disposable.create(() => {
        window.removeEventListener('pointerdown', onDismiss, true);
        window.removeEventListener('resize', onReposition);
        window.removeEventListener('scroll', onReposition, true);
    });
}

export function ensureHeaderIdeViewPickerMenuExtracted(ctx: any): HTMLElement {
    if (ctx.headerIdeViewPickerMenu) {
        return ctx.headerIdeViewPickerMenu;
    }
    const menu = document.createElement('div');
    menu.className = 'qaap-work-hub-toolbar-menu theia-mobile-projects-ide-view-picker-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', nls.localize('qaap/mobileBottomBar/viewSelector', 'View'));
    document.body.append(menu);
    ctx.headerIdeViewPickerMenu = menu;
    return menu;
}

export function closeHeaderIdeViewPickerMenuExtracted(ctx: any): void {
    ctx.headerIdeViewPickerBtn?.setAttribute('aria-expanded', 'false');
    if (ctx.headerIdeViewPickerMenu) {
        ctx.headerIdeViewPickerMenu.hidden = true;
        ctx.headerIdeViewPickerMenu.classList.remove('theia-mod-open');
        ctx.headerIdeViewPickerMenu.style.top = '';
        ctx.headerIdeViewPickerMenu.style.left = '';
    }
    ctx.headerIdeViewPickerDismiss.dispose();
    ctx.headerIdeViewPickerDismiss = Disposable.NULL;
}

export function onHeaderOverflowMenuClickExtracted(ctx: any, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (ctx.headerOverflowMenu?.classList.contains('theia-mod-open')) {
        ctx.closeHeaderOverflowMenu();
        return;
    }
    ctx.openHeaderOverflowMenu();
}

export function openHeaderOverflowMenuExtracted(ctx: any): void {
    const menu = ctx.ensureHeaderOverflowMenu();
    ctx.renderHeaderOverflowMenuItems(menu);
    if (!menu.childElementCount) {
        return;
    }
    ctx.headerOverflowMenuBtn.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    menu.classList.add('theia-mod-open');
    ctx.positionHeaderOverflowMenu();

    const onDismiss = (event: Event): void => {
        const target = event.target;
        if (target instanceof Node && (menu.contains(target) || ctx.headerOverflowMenuBtn.contains(target))) {
            return;
        }
        ctx.closeHeaderOverflowMenu();
    };
    const onReposition = (): void => ctx.positionHeaderOverflowMenu();
    window.setTimeout(() => window.addEventListener('pointerdown', onDismiss, true), 0);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    ctx.headerOverflowMenuDismiss.dispose();
    ctx.headerOverflowMenuDismiss = Disposable.create(() => {
        window.removeEventListener('pointerdown', onDismiss, true);
        window.removeEventListener('resize', onReposition);
        window.removeEventListener('scroll', onReposition, true);
    });
}

export function ensureHeaderOverflowMenuExtracted(ctx: any): HTMLElement {
    if (ctx.headerOverflowMenu) {
        return ctx.headerOverflowMenu;
    }
    const menu = document.createElement('div');
    menu.className = 'qaap-work-hub-toolbar-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', ctx.headerOverflowMenuBtn.title);
    document.body.append(menu);
    ctx.headerOverflowMenu = menu;
    return menu;
}

export function closeHeaderOverflowMenuExtracted(ctx: any): void {
    ctx.headerOverflowMenuBtn?.setAttribute('aria-expanded', 'false');
    if (ctx.headerOverflowMenu) {
        ctx.headerOverflowMenu.hidden = true;
        ctx.headerOverflowMenu.classList.remove('theia-mod-open');
        ctx.headerOverflowMenu.style.top = '';
        ctx.headerOverflowMenu.style.left = '';
    }
    ctx.headerOverflowMenuDismiss.dispose();
    ctx.headerOverflowMenuDismiss = Disposable.NULL;
}

export function renderHeaderOverflowMenuItemsExtracted(ctx: any, menu: HTMLElement): void {
    renderHeaderOverflowMenuItemsHelper(menu, {
        closeHeaderOverflowMenu: () => ctx.closeHeaderOverflowMenu(),
        openHeaderNewChat: () => ctx.openHeaderNewChat(),
        isHeaderNewChatVisible: () => ctx.isHeaderNewChatVisible(),
        openWorkHubSessionsSidebar: () => ctx.openWorkHubSessionsSidebar(),
        copyActiveConversationToClipboard: () => ctx.copyActiveConversationToClipboard(),
        isCopyConversationEnabled: () => ctx.isCopyConversationEnabled(),
        openAiConfigurationSheet: ctx.openAiConfigurationSheet,
        openPreferencesSheet: ctx.openPreferencesSheet,
        appendHeaderOverflowSeparator: m => ctx.appendHeaderOverflowSeparator(m),
        headerOverflowMenuGroups: ctx.headerOverflowMenuGroups,
        isHeaderOverflowMenuItemVisible: i => ctx.isHeaderOverflowMenuItemVisible(i),
        isHeaderOverflowMenuItemEnabled: i => ctx.isHeaderOverflowMenuItemEnabled(i),
        commands: ctx.commands,
    });
}

export function isHeaderOverflowMenuItemVisibleExtracted(ctx: any, item: MobileProjectsHeaderOverflowMenuItem): boolean {
    if (item.isVisible) {
        return item.isVisible();
    }
    return item.command ? ctx.commands.isVisible(item.command) : true;
}

export function isHeaderOverflowMenuItemEnabledExtracted(ctx: any, item: MobileProjectsHeaderOverflowMenuItem): boolean {
    if (item.isEnabled) {
        return item.isEnabled();
    }
    return item.command ? ctx.commands.isEnabled(item.command) : true;
}

export async function copyActiveConversationToClipboardExtracted(ctx: any): Promise<void> {
    const conv = await ctx.resolveActiveConversationForCopy();
    const text = conv ? formatConversationForClipboard(conv) : '';
    if (!text.trim()) {
        MobileSnackbar.show(
            nls.localize('qaap/workHubToolbar/copyConversationEmpty', 'No messages to copy'),
            { kind: 'warning', duration: 1800 },
        );
        return;
    }
    try {
        if (ctx.previewClipboard) {
            await ctx.previewClipboard.writeText(text);
        } else {
            await navigator.clipboard.writeText(text);
        }
        MobileSnackbar.show(
            nls.localize('qaap/workHubToolbar/copyConversationCopied', 'Conversation copied'),
            { kind: 'success', duration: 1800 },
        );
    } catch {
        MobileSnackbar.show(
            nls.localize('qaap/mobileProjects/transcriptShellCopyFailed', 'Could not copy'),
            { kind: 'warning' },
        );
    }
}

export function shouldEmbedSessionsSidebarInPanelExtracted(ctx: any): boolean {
    if (!ctx.homeMode) {
        return false;
    }
    return !isDesktopSessionsSidebarLayout()
        || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome')
        || document.body.classList.contains('theia-mobile-mod-desktop-ide');
}

export async function openConversationSummaryExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    await ctx.conversationOpenUi.openConversationSummary(project, summary);
}

export async function submitBackgroundAgentTaskExtracted(ctx: any, project: MobileProjectEntry,
    draft: string,
    options: {
        openConversation?: boolean;
        forceVps?: boolean;
        selectedAgentId?: string;
        modeId?: string;
        autoApprove?: boolean;
        approvalPolicyId?: string;
        toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
        capabilityOverrides?: Record<string, boolean>;
        genericCapabilitySelections?: GenericCapabilitySelections;
        variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
        worktree?: boolean;
        agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
    } = {},): Promise<QaapAgentConversationSummaryDTO | undefined> {
    return ctx.backgroundTaskUi.submitBackgroundAgentTask(project, draft, options);
}

export function resolveAnnotationComposerSessionExtracted(ctx: any): AnnotationComposerSessionControls | undefined {
    const state = ctx.transcriptController.state;
    // Same resolution as other Work Hub composer entry points — do not require
    // transcriptOpenProject alone (sticky / shell session may still be active).
    const project = ctx.resolveExternalComposerProject();
    const summary = state.transcriptOpenSummary
        ?? state.transcriptComposerSummary
        ?? (project ? ctx.resolveShellSummary(project) : undefined);
    if (!project || !summary) {
        return undefined;
    }
    return createAnnotationComposerSessionControls({
        agentLocked: summary.source === 'theia-chat',
        resolveAgentId: () => ctx.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(
            project,
            summary,
        ),
        resolveAgentLabel: () => ctx.transcriptComposerUi.resolveTranscriptComposerAgentLabel(),
        resolveAgentModel: () => {
            const cwd = ctx.projectsService.getProjectCwd(project) ?? summary.cwd;
            return ctx.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                ctx.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                cwd,
            );
        },
        onOpenAgentSheet: (anchor, onSelectionApplied) => {
            ctx.transcriptComposerUi.openTranscriptComposerAgentSheet(
                project,
                summary,
                anchor,
                { onSelectionApplied },
            );
        },
    });
}

export function attachExternalComposerContextExtracted(ctx: any, args: {
    readonly chipTitle: string;
    readonly contextBody: string;
    readonly dedupeKey: string;
    readonly images?: readonly QaapAttachComposerImageAttachment[];
}): boolean {
    const project = ctx.resolveExternalComposerProject();
    if (!project) {
        return false;
    }
    const attachImages = normalizeAttachComposerImages(args.images);
    if (attachImages.length && ctx.uploadComposerFeedbackImages) {
        void ctx.uploadComposerFeedbackImages(attachImages, ctx.resolveExternalComposerUploadDir(project))
            .then(requests => ctx.attachExternalFeedbackImageEntries(requests))
            .catch(() => undefined);
    }
    const useTranscript = ctx.resolveActiveComposerContextTarget() === 'transcript';
    const entries = useTranscript
        ? ctx.transcriptController.state.transcriptComposerContext
        : ctx.stickyComposerContext;
    const request = buildPreviewFeedbackAttachmentRequest(args);
    const existingIndex = findPreviewFeedbackEntryIndex(entries, args.dedupeKey);
    if (existingIndex >= 0) {
        entries[existingIndex]!.request = request;
        entries[existingIndex]!.displayName = args.chipTitle;
    } else {
        const entry = createComposerContextEntry(request);
        entry.displayName = args.chipTitle;
        entries.push(entry);
    }
    if (useTranscript) {
        ctx.transcriptStickyComposerUi.remountTranscriptStickyComposer();
    } else {
        ctx.stickyComposerRenderUi.renderStickyComposer();
    }
    const input = ctx.root.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input-editor');
    input?.focus();
    return true;
}

export async function sendExternalComposerContextExtracted(ctx: any, args: {
    readonly chipTitle: string;
    readonly contextBody: string;
    readonly dedupeKey: string;
    readonly images?: readonly QaapAttachComposerImageAttachment[];
}): Promise<boolean> {
    return sendExternalComposerContextHelper(args, {
        attachExternalComposerContext: a => ctx.attachExternalComposerContext(a),
        resolveExternalComposerProject: () => ctx.resolveExternalComposerProject(),
        uploadComposerFeedbackImages: ctx.uploadComposerFeedbackImages,
        resolveExternalComposerUploadDir: p => ctx.resolveExternalComposerUploadDir(p),
        activateMessagesSurfaceForExternalSubmit: p => ctx.activateMessagesSurfaceForExternalSubmit(p),
        transcriptControllerState: ctx.transcriptController.state,
        agentsHubInlineActive: ctx.agentsHubInlineActive,
        openInlineTranscript: (p, s) => ctx.openInlineTranscript(p, s),
        transcriptComposerUi: ctx.transcriptComposerUi,
        submitTranscriptViaBackendConversation: (p, s, c, o) => ctx.submitTranscriptViaBackendConversation(p, s, c, o),
        projectsService: ctx.projectsService,
        preparedCwdByProjectId: ctx.preparedCwdByProjectId,
        ensureAgentsHubExecutionShellRendered: () => ctx.ensureAgentsHubExecutionShellRendered(),
        resolveActiveTranscriptChatHost: () => ctx.resolveActiveTranscriptChatHost(),
        applyComposerAttachmentsToDraft: ctx.applyComposerAttachmentsToDraft,
        renderIdleSubmitOptimistic: (h, s, d, a, i, c) => ctx.renderIdleSubmitOptimistic(h, s, d, a, i, c),
        transcriptStickyComposerUi: ctx.transcriptStickyComposerUi,
        submitBackgroundAgentTask: (p, d, o) => ctx.submitBackgroundAgentTask(p, d, o),
        ensureExternalSubmitConversationRendered: () => ctx.ensureExternalSubmitConversationRendered(),
        attachExternalFeedbackImageEntries: r => ctx.attachExternalFeedbackImageEntries(r),
        removeExternalPreviewFeedbackChip: k => ctx.removeExternalPreviewFeedbackChip(k),
    });
}

export function resolveExternalComposerUploadDirExtracted(ctx: any, project: MobileProjectEntry): URI | undefined {
    if (project.uri) {
        return project.uri;
    }
    const cwd = ctx.projectsService.getProjectCwd(project);
    return cwd ? new URI().withScheme('file').withPath(cwd) : undefined;
}

export function attachExternalFeedbackImageEntriesExtracted(ctx: any, requests: readonly AIVariableResolutionRequest[]): void {
    if (!requests.length) {
        return;
    }
    const useTranscript = ctx.resolveActiveComposerContextTarget() === 'transcript';
    const entries = useTranscript
        ? ctx.transcriptController.state.transcriptComposerContext
        : ctx.stickyComposerContext;
    for (const request of requests) {
        entries.push(createComposerContextEntry(request));
    }
    if (useTranscript) {
        ctx.transcriptStickyComposerUi.remountTranscriptStickyComposer();
    } else {
        ctx.stickyComposerRenderUi.renderStickyComposer();
    }
}

export function activateMessagesSurfaceForExternalSubmitExtracted(ctx: any, project: MobileProjectEntry): void {
    ctx.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
    ctx.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('messages');
    if (ctx.agentsHubShellActive) {
        ctx.stickyComposerRenderUi.renderStickyComposer();
    }
}

export function ensureExternalSubmitConversationRenderedExtracted(ctx: any): void {
    ctx.ensureAgentsHubExecutionShellRendered();
    const state = ctx.transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary || isAgentsHubIdleConversationSummary(summary)) {
        return;
    }
    const conv = state.transcriptLastConv?.id === summary.id
        ? state.transcriptLastConv
        : ctx.transcriptConversationCache.get(summary.id);
    const chatHost = ctx.resolveActiveTranscriptChatHost();
    if (!conv || !chatHost) {
        return;
    }
    state.transcriptLastFingerprint = undefined;
    ctx.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
    ctx.transcriptLiveUi.ensureTranscriptConversationRefresh();
}

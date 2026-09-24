import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import type { MobileProjectsHeaderOverflowMenuItem } from './mobile-projects-panel-types';
// Extracted from mobile-projects-panel.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import {
    MobileProjectEntry,
} from './mobile-projects-types';
import {
    isAgentsHubIdleConversationSummary,
} from '../common/qaap-agents-hub-landing';
import {
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { formatConversationForClipboard } from '../common/qaap-conversation-clipboard-text';
import { MobileSnackbar } from './mobile-snackbar';
import { isDesktopSessionsSidebarLayout } from './mobile-work-hub-sessions-sidebar';
import {
    createComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    buildPreviewFeedbackAttachmentRequest,
    findPreviewFeedbackEntryIndex,
    normalizeAttachComposerImages,
    type QaapAttachComposerImageAttachment,
} from '../common/qaap-preview-feedback-context';
import { URI } from '@theia/core/lib/common/uri';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import { createAnnotationComposerSessionControls } from './qaap-preview-annotation-composer-session';
import {
    renderHeaderOverflowMenuItems as renderHeaderOverflowMenuItemsHelper,
    sendExternalComposerContext as sendExternalComposerContextHelper,
} from './mobile-projects-panel-helpers';

export function openHeaderIdeViewPickerMenuExtracted(ctx: MobileProjectsPanelContext): void {
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

export function ensureHeaderIdeViewPickerMenuExtracted(ctx: MobileProjectsPanelContext): HTMLElement {
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

export function closeHeaderIdeViewPickerMenuExtracted(ctx: MobileProjectsPanelContext): void {
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

export function onHeaderOverflowMenuClickExtracted(ctx: MobileProjectsPanelContext, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (ctx.headerOverflowMenu?.classList.contains('theia-mod-open')) {
        ctx.closeHeaderOverflowMenu();
        return;
    }
    ctx.openHeaderOverflowMenu();
}

export function openHeaderOverflowMenuExtracted(ctx: MobileProjectsPanelContext): void {
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

export function ensureHeaderOverflowMenuExtracted(ctx: MobileProjectsPanelContext): HTMLElement {
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

export function closeHeaderOverflowMenuExtracted(ctx: MobileProjectsPanelContext): void {
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

export function renderHeaderOverflowMenuItemsExtracted(ctx: MobileProjectsPanelContext, menu: HTMLElement): void {
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

export function isHeaderOverflowMenuItemVisibleExtracted(ctx: MobileProjectsPanelContext, item: MobileProjectsHeaderOverflowMenuItem): boolean {
    if (item.isVisible) {
        return item.isVisible();
    }
    return item.command ? ctx.commands.isVisible(item.command) : true;
}

export function isHeaderOverflowMenuItemEnabledExtracted(ctx: MobileProjectsPanelContext, item: MobileProjectsHeaderOverflowMenuItem): boolean {
    if (item.isEnabled) {
        return item.isEnabled();
    }
    return item.command ? ctx.commands.isEnabled(item.command) : true;
}

export async function copyActiveConversationToClipboardExtracted(ctx: MobileProjectsPanelContext): Promise<void> {
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

export function shouldEmbedSessionsSidebarInPanelExtracted(ctx: MobileProjectsPanelContext): boolean {
    if (!ctx.homeMode) {
        return false;
    }
    return !isDesktopSessionsSidebarLayout()
        || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome')
        || document.body.classList.contains('theia-mobile-mod-desktop-ide');
}

export async function openConversationSummaryExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    await ctx.conversationOpenUi.openConversationSummary(project, summary);
}

export async function submitBackgroundAgentTaskExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
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

export function resolveAnnotationComposerSessionExtracted(ctx: MobileProjectsPanelContext): AnnotationComposerSessionControls | undefined {
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

export function attachExternalComposerContextExtracted(ctx: MobileProjectsPanelContext, args: {
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

export async function sendExternalComposerContextExtracted(ctx: MobileProjectsPanelContext, args: {
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

export function resolveExternalComposerUploadDirExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry): URI | undefined {
    if (project.uri) {
        return project.uri;
    }
    const cwd = ctx.projectsService.getProjectCwd(project);
    return cwd ? new URI().withScheme('file').withPath(cwd) : undefined;
}

export function attachExternalFeedbackImageEntriesExtracted(ctx: MobileProjectsPanelContext, requests: readonly AIVariableResolutionRequest[]): void {
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

export function activateMessagesSurfaceForExternalSubmitExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry): void {
    ctx.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
    ctx.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('messages');
    if (ctx.agentsHubShellActive) {
        ctx.stickyComposerRenderUi.renderStickyComposer();
    }
}

export function ensureExternalSubmitConversationRenderedExtracted(ctx: MobileProjectsPanelContext): void {
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

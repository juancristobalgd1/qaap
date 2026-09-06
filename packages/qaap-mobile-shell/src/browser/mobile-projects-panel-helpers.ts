// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Business-logic helpers extracted from MobileProjectsPanel (second pass).
// These functions accept instance fields as parameters (dependency injection).

import { nls } from '@theia/core/lib/common/nls';
import type { AIVariableResolutionRequest } from '@theia/ai-core';
import { URI } from '@theia/core/lib/common/uri';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { getConversation } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { TranscriptOverlayController } from './mobile-projects-transcript-overlay-controller';
import type { MobileProjectsHeaderOverflowMenuItem } from './mobile-projects-panel';
import {
    buildAgentsHubIdleConversationSummary,
    isAgentsHubIdleConversationSummary,
} from '../common/qaap-agents-hub-landing';
import {
    buildPreviewFeedbackAttachmentRequest,
    normalizeAttachComposerImages,
    type QaapAttachComposerImageAttachment,
} from '../common/qaap-preview-feedback-context';
import { resolvePreviewFeedbackSubmitTarget } from '../common/qaap-preview-feedback-submit-target';
import { resolveWorkspaceHostFsPath } from './qaap-project-bootstrap-shell';
import { normalizeIsolationPath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task-client';

export function projectOwnsActiveBootstrap(
    project: MobileProjectEntry,
    projectBootstrap: QaapProjectBootstrapService | undefined,
    projectsService: MobileProjectsService,
    preparedCwdByProjectId: Map<string, string>,
): boolean {
    const rootUri = projectBootstrap?.descriptor?.rootUri;
    if (!rootUri) {
        return false;
    }
    const cwd = projectsService.getProjectCwd(project) ?? preparedCwdByProjectId.get(project.id);
    if (!cwd) {
        return false;
    }
    const normalize = (value: string): string => normalizeIsolationPath(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    try {
        return normalize(resolveWorkspaceHostFsPath(rootUri)) === normalize(cwd);
    } catch {
        return false;
    }
}

export function isCopyConversationEnabled(
    transcriptController: TranscriptOverlayController,
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>,
): boolean {
    const state = transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary) {
        return false;
    }
    if (state.transcriptLastConv?.id === summary.id && state.transcriptLastConv.messages.length > 0) {
        return true;
    }
    const cached = transcriptConversationCache.get(summary.id);
    if ((cached?.messages.length ?? 0) > 0) {
        return true;
    }
    return (summary.messageCount ?? 0) > 0;
}

export async function resolveActiveConversationForCopy(
    transcriptController: TranscriptOverlayController,
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>,
    conversations: MobileProjectsConversations | undefined,
): Promise<QaapAgentConversationDTO | undefined> {
    const state = transcriptController.state;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!summary) {
        return undefined;
    }
    if (state.transcriptLastConv?.id === summary.id) {
        return state.transcriptLastConv;
    }
    const cached = transcriptConversationCache.get(summary.id);
    if (cached) {
        return cached;
    }
    if (summary.source === 'theia-chat') {
        return conversations?.getTheiaConversation(summary.id);
    }
    try {
        return await getConversation(summary.id);
    } catch {
        return undefined;
    }
}

// ─── DI-extracted: renderHeaderOverflowMenuItems ────────────────────────────

export interface RenderHeaderOverflowMenuItemsDeps {
    closeHeaderOverflowMenu(): void;
    openHeaderNewChat(): void;
    isHeaderNewChatVisible(): boolean;
    openWorkHubSessionsSidebar(): void;
    copyActiveConversationToClipboard(): Promise<void>;
    isCopyConversationEnabled(): boolean;
    openAiConfigurationSheet?: () => void;
    openPreferencesSheet?: (query?: string) => Promise<void>;
    appendHeaderOverflowSeparator(menu: HTMLElement): void;
    headerOverflowMenuGroups?: () => MobileProjectsHeaderOverflowMenuItem[][];
    isHeaderOverflowMenuItemVisible(item: MobileProjectsHeaderOverflowMenuItem): boolean;
    isHeaderOverflowMenuItemEnabled(item: MobileProjectsHeaderOverflowMenuItem): boolean;
    commands: { executeCommand(command: string): void | Promise<void> | unknown };
}

export function renderHeaderOverflowMenuItems(
    menu: HTMLElement,
    deps: RenderHeaderOverflowMenuItemsDeps,
): void {
    menu.replaceChildren();
    const appendItem = (label: string, icon: string, run: () => void | Promise<void>, enabled = true): void => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qaap-work-hub-toolbar-menu-item';
        item.setAttribute('role', 'menuitem');
        item.disabled = !enabled;
        const iconEl = document.createElement('span');
        iconEl.className = `codicon ${icon}`;
        iconEl.setAttribute('aria-hidden', 'true');
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        item.append(iconEl, labelEl);
        item.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (item.disabled) {
                return;
            }
            deps.closeHeaderOverflowMenu();
            void Promise.resolve(run()).catch(() => undefined);
        });
        menu.append(item);
    };
    appendItem(
        nls.localize('qaap/workHubToolbar/newChat', 'New Chat'),
        'codicon-add',
        () => deps.openHeaderNewChat(),
        deps.isHeaderNewChatVisible(),
    );
    appendItem(
        nls.localize('qaap/workHubToolbar/showChats', 'Show Chats'),
        'codicon-history',
        () => deps.openWorkHubSessionsSidebar(),
    );
    appendItem(
        nls.localize('qaap/workHubToolbar/copyConversation', 'Copy full conversation'),
        'codicon-copy',
        () => deps.copyActiveConversationToClipboard(),
        deps.isCopyConversationEnabled(),
    );
    if (deps.openPreferencesSheet || deps.openAiConfigurationSheet) {
        deps.appendHeaderOverflowSeparator(menu);
        appendItem(
            nls.localize('qaap/workHubToolbar/aiSettings', 'AI Settings'),
            'codicon-settings-gear',
            () => {
                if (deps.openPreferencesSheet) {
                    void deps.openPreferencesSheet('ai-features');
                    return;
                }
                deps.openAiConfigurationSheet?.();
            },
        );
    }
    // Preferences (full IDE settings) stay out of Work Hub overflow — use Open IDE / AI Settings.
    for (const group of deps.headerOverflowMenuGroups?.() ?? []) {
        const visibleItems = group.filter(item => deps.isHeaderOverflowMenuItemVisible(item));
        if (!visibleItems.length) {
            continue;
        }
        deps.appendHeaderOverflowSeparator(menu);
        for (const item of visibleItems) {
            appendItem(
                item.label,
                item.icon,
                () => {
                    if (item.run) {
                        return item.run();
                    }
                    if (item.command) {
                        return deps.commands.executeCommand(item.command) as void | Promise<void>;
                    }
                },
                deps.isHeaderOverflowMenuItemEnabled(item),
            );
        }
    }
}

// ─── DI-extracted: sendExternalComposerContext (25 this. refs) ───────────────

export interface SendExternalComposerContextDeps {
    attachExternalComposerContext(args: {
        readonly chipTitle: string;
        readonly contextBody: string;
        readonly dedupeKey: string;
    }): boolean;
    resolveExternalComposerProject(): MobileProjectEntry | undefined;
    uploadComposerFeedbackImages?: (
        images: readonly QaapAttachComposerImageAttachment[],
        targetDir: URI | undefined,
    ) => Promise<AIVariableResolutionRequest[]>;
    resolveExternalComposerUploadDir(project: MobileProjectEntry): URI | undefined;
    activateMessagesSurfaceForExternalSubmit(project: MobileProjectEntry): void;
    transcriptControllerState: {
        readonly transcriptOpenSummaryId: string | undefined;
        readonly transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
        readonly transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    };
    agentsHubInlineActive: boolean;
    openInlineTranscript(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    transcriptComposerUi: {
        resolveTranscriptComposerPinnedAgentId(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): string;
        resolveTranscriptComposerAgentModel(agentId: string, cwd: string | undefined): QaapCreateAgentTaskQaiqModel | undefined;
    };
    submitTranscriptViaBackendConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        content: string,
        options: {
            selectedAgentId?: string;
            variables?: AIVariableResolutionRequest[];
            agentModel?: QaapCreateAgentTaskQaiqModel;
        },
    ): Promise<boolean>;
    projectsService: {
        getProjectCwd(project: MobileProjectEntry): string | undefined;
    };
    preparedCwdByProjectId: Map<string, string>;
    ensureAgentsHubExecutionShellRendered(): void;
    resolveActiveTranscriptChatHost(): HTMLElement | undefined;
    applyComposerAttachmentsToDraft?: (draft: string, variables?: AIVariableResolutionRequest[]) => Promise<string>;
    renderIdleSubmitOptimistic(
        chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
        draft: string,
        selectedAgentId: string,
        imagePreviews?: undefined,
        contentOverride?: string,
    ): void;
    transcriptStickyComposerUi: {
        refreshComposerActivityStack(): void;
    };
    submitBackgroundAgentTask(
        project: MobileProjectEntry,
        draft: string,
        options: {
            openConversation?: boolean;
            forceVps?: boolean;
            selectedAgentId?: string;
            variables?: AIVariableResolutionRequest[];
            agentModel?: QaapCreateAgentTaskQaiqModel;
        },
    ): Promise<QaapAgentConversationSummaryDTO | undefined>;
    ensureExternalSubmitConversationRendered(): void;
    attachExternalFeedbackImageEntries(requests: readonly AIVariableResolutionRequest[]): void;
    removeExternalPreviewFeedbackChip(dedupeKey: string): void;
}

export async function sendExternalComposerContext(
    args: {
        readonly chipTitle: string;
        readonly contextBody: string;
        readonly dedupeKey: string;
        readonly images?: readonly QaapAttachComposerImageAttachment[];
    },
    deps: SendExternalComposerContextDeps,
): Promise<boolean> {
    // Images are handled below as submit variables — keep the retry chip image-free.
    if (!deps.attachExternalComposerContext({
        chipTitle: args.chipTitle,
        contextBody: args.contextBody,
        dedupeKey: args.dedupeKey,
    })) {
        return false;
    }
    const project = deps.resolveExternalComposerProject();
    if (!project) {
        return false;
    }
    const request = buildPreviewFeedbackAttachmentRequest(args);
    const feedbackImages = normalizeAttachComposerImages(args.images);
    let imageRequests: AIVariableResolutionRequest[] = [];
    if (feedbackImages.length && deps.uploadComposerFeedbackImages) {
        try {
            imageRequests = await deps.uploadComposerFeedbackImages(
                feedbackImages,
                deps.resolveExternalComposerUploadDir(project),
            );
        } catch {
            // Send the annotations anyway; the screenshot stays on the user's clipboard.
            imageRequests = [];
        }
    }
    const prompt = nls.localize(
        'qaap/workHub/previewFeedbackSubmitPrompt',
        'Please address the attached preview feedback.',
    );
    // Annotate Send often fires from the Preview tab — land on Messages first so the
    // optimistic user bubble + sticky composer match a normal composer submit.
    deps.activateMessagesSurfaceForExternalSubmit(project);
    const state = deps.transcriptControllerState;
    const target = resolvePreviewFeedbackSubmitTarget(
        state.transcriptOpenSummary,
        state.transcriptComposerSummary,
    );
    try {
        if (target.kind === 'active') {
            const summary = target.summary;
            if (state.transcriptOpenSummaryId !== summary.id || !deps.agentsHubInlineActive) {
                await deps.openInlineTranscript(project, summary);
                deps.activateMessagesSurfaceForExternalSubmit(project);
            }
            const selectedAgentId = deps.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(
                project,
                summary,
            );
            const agentModel = deps.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                selectedAgentId,
                summary.cwd,
            );
            await deps.submitTranscriptViaBackendConversation(project, summary, prompt, {
                selectedAgentId,
                variables: [request, ...imageRequests],
                ...(agentModel ? { agentModel } : {}),
            });
        } else {
            const idleSummary = state.transcriptOpenSummary
                && isAgentsHubIdleConversationSummary(state.transcriptOpenSummary)
                ? state.transcriptOpenSummary
                : state.transcriptComposerSummary
                    && isAgentsHubIdleConversationSummary(state.transcriptComposerSummary)
                    ? state.transcriptComposerSummary
                    : buildAgentsHubIdleConversationSummary(
                        deps.projectsService.getProjectCwd(project)
                        ?? deps.preparedCwdByProjectId.get(project.id)
                        ?? '',
                    );
            const selectedAgentId = deps.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(
                project,
                idleSummary,
            );
            const agentModel = deps.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                selectedAgentId,
                idleSummary.cwd || deps.projectsService.getProjectCwd(project),
            );
            // Send usually fires from the Preview tab, where the messages shell may be
            // unmounted — ensure it exists so the optimistic paint has a live host.
            deps.ensureAgentsHubExecutionShellRendered();
            const chatHost = deps.resolveActiveTranscriptChatHost();
            if (chatHost) {
                // Paint the rich preview-feedback card immediately: resolve the attachment
                // preamble for the optimistic row instead of waiting for the server render.
                let optimisticContent = prompt;
                if (deps.applyComposerAttachmentsToDraft) {
                    try {
                        optimisticContent = await deps.applyComposerAttachmentsToDraft(prompt, [request, ...imageRequests]);
                    } catch {
                        // Fall back to the bare prompt; the server render reconciles.
                    }
                }
                deps.renderIdleSubmitOptimistic(chatHost, idleSummary, prompt, selectedAgentId, undefined, optimisticContent);
            }
            deps.transcriptStickyComposerUi.refreshComposerActivityStack();
            await deps.submitBackgroundAgentTask(project, prompt, {
                forceVps: true,
                openConversation: true,
                selectedAgentId,
                variables: [request, ...imageRequests],
                ...(agentModel ? { agentModel } : {}),
            });
            // create→openInline may preserve Preview; force Messages again after open.
            deps.activateMessagesSurfaceForExternalSubmit(project);
            deps.ensureExternalSubmitConversationRendered();
        }
    } catch {
        // Keep the chip so the user can retry from the composer; already-uploaded screenshots
        // become composer image chips so a retry still includes them.
        deps.attachExternalFeedbackImageEntries(imageRequests);
        return false;
    }
    deps.removeExternalPreviewFeedbackChip(args.dedupeKey);
    return true;
}

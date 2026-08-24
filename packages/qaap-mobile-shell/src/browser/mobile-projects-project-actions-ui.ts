// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { ChatService } from '@theia/ai-chat';
import { deleteConversation, isFailedRunSummary, type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { deleteAgentTasksForCwd } from '../common/qaap-agent-task-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectEntry } from './mobile-projects-types';
import { confirmRemoveProjectDialog } from './mobile-projects-remove-confirm';

/** Resolve which failed summaries to delete (all, or an explicit id subset). */
export function resolveFailedTasksToClear(
    failed: readonly QaapAgentConversationSummaryDTO[],
    ids?: readonly string[],
): QaapAgentConversationSummaryDTO[] {
    if (ids && ids.length > 0) {
        const selected = new Set(ids);
        return failed.filter(summary => selected.has(summary.id));
    }
    return [...failed];
}

/** Panel surface for repository card menu actions. */
export interface MobileProjectsProjectActionsHost {
    projects: MobileProjectEntry[];
    chatService: ChatService | undefined;
    conversations: MobileProjectsConversations | undefined;
    projectsService: MobileProjectsService;
    messageService: MessageService | undefined;
    delegate: { onProjectsChanged?: () => void };

    closeCardMenu(): void;
    transcriptSheetUi: import('./mobile-projects-transcript-sheet-ui').MobileProjectsTranscriptSheetUi;
    render(): void;
    renderList(): void;
    chatServiceSummariesUi: import('./mobile-projects-chat-service-summaries-ui').MobileProjectsChatServiceSummariesUi;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
    /** Frees the embedded preview iframe, terminals, and backend dev-server claim owned by a section. */
    releasePreviewForConversation?(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void;
    /** Tests stub confirmation; production uses ConfirmDialog. */
    confirmRemoveProject?(project: MobileProjectEntry): Promise<boolean | undefined>;
}

/** Repository card actions: rename, duplicate, clear tasks, clear failed tasks, remove. */
export class MobileProjectsProjectActionsUi {

    constructor(protected readonly host: MobileProjectsProjectActionsHost) { }

    /** Animate every visible representation of a project before the list renderer removes it. */
    protected animateProjectRemoval(project: MobileProjectEntry): { readonly started: boolean; readonly promise: Promise<void> } {
        if (typeof document === 'undefined') {
            return { started: false, promise: Promise.resolve() };
        }
        const cards = Array.from(document.querySelectorAll<HTMLElement>('.theia-mobile-projects-card'))
            .filter(card => card.dataset.qaapProjectId === project.id);
        if (cards.length === 0) {
            return { started: false, promise: Promise.resolve() };
        }

        for (const card of cards) {
            // Freeze the current height so the expanded card collapses smoothly instead of
            // snapping when its body is removed.
            card.style.maxHeight = `${Math.max(card.offsetHeight, 1)}px`;
            card.style.overflow = 'hidden';
            card.setAttribute('aria-busy', 'true');
            card.classList.add('theia-mod-removing');
        }

        const reducedMotion = typeof matchMedia === 'function'
            && matchMedia('(prefers-reduced-motion: reduce)').matches;
        return {
            started: true,
            promise: new Promise(resolve => window.setTimeout(resolve, reducedMotion ? 0 : 280)),
        };
    }

    async onRenameProject(project: MobileProjectEntry): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const renamed = await this.host.projectsService.renameProject(project);
        if (!renamed) {
            return;
        }
        this.host.projects = await this.host.projectsService.loadProjects();
        this.host.render();
        this.host.delegate.onProjectsChanged?.();
    }

    async onDuplicateProject(project: MobileProjectEntry): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const duplicated = await this.host.projectsService.duplicateProject(project);
        if (!duplicated) {
            return;
        }
        this.host.projects = await this.host.projectsService.loadProjects();
        this.host.render();
        this.host.delegate.onProjectsChanged?.();
    }

    async onClearProjectChats(project: MobileProjectEntry): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const conversations = this.host.conversationIndexUi.conversationsForProject(project);
        if (conversations.length === 0) {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/clearAllTasks', 'Clear all tasks'),
            msg: nls.localize(
                'qaap/mobileProjects/clearAllTasksConfirm',
                'Clear all tasks for this project? This cannot be undone.'
            ),
        }).open();
        if (!confirmed) {
            return;
        }
        try {
            for (const summary of conversations) {
                this.host.releasePreviewForConversation?.(project, summary);
                if (summary.source === 'theia-chat') {
                    if (summary.sessionId && this.host.chatService) {
                        await this.host.chatService.deleteSession(summary.sessionId);
                        this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
                    }
                } else {
                    await deleteConversation(summary.id);
                    this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
                }
            }
            await this.host.conversations?.refreshTheiaChatSessionsForProjects(this.host.projects);
            this.host.transcriptSheetUi.closeTranscriptSheet();
            await this.host.chatServiceSummariesUi.refreshChatServiceSessionSummaries();
            this.host.renderList();
        } catch (error) {
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/clearAllTasksFailed',
                'Could not clear tasks: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async onClearFailedTasks(project: MobileProjectEntry, ids?: readonly string[]): Promise<boolean> {
        this.host.cardMenuUi.closeCardMenu();
        const failed = this.host.conversationIndexUi.vpsTasksForProject(project)
            .filter(summary => isFailedRunSummary(summary));
        const targets = resolveFailedTasksToClear(failed, ids);
        if (targets.length === 0) {
            return false;
        }
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/clearFailedTasks', 'Clear failed runs'),
            msg: targets.length === 1
                ? nls.localize(
                    'qaap/mobileProjects/clearFailedTasksConfirmOne',
                    'Delete the 1 failed run for this project? This cannot be undone.'
                )
                : ids && ids.length > 0
                    ? nls.localize(
                        'qaap/mobileProjects/clearFailedTasksConfirmSelectedMany',
                        'Delete {0} selected failed runs for this project? This cannot be undone.',
                        String(targets.length)
                    )
                    : nls.localize(
                        'qaap/mobileProjects/clearFailedTasksConfirmMany',
                        'Delete all {0} failed runs for this project? This cannot be undone.',
                        String(targets.length)
                    ),
        }).open();
        if (!confirmed) {
            return false;
        }
        try {
            for (const summary of targets) {
                this.host.releasePreviewForConversation?.(project, summary);
                await deleteConversation(summary.id);
                this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
            }
            this.host.transcriptSheetUi.closeTranscriptSheet();
            this.host.renderList();
            return true;
        } catch (error) {
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/clearFailedTasksFailed',
                'Could not clear failed runs: {0}',
                error instanceof Error ? error.message : String(error)
            ));
            return false;
        }
    }

    async onRemoveProject(project: MobileProjectEntry): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        if (!this.host.projectsService.canRemove(project)) {
            return;
        }

        const confirmed = this.host.confirmRemoveProject
            ? await this.host.confirmRemoveProject(project)
            : await confirmRemoveProjectDialog(project);
        if (!confirmed) {
            return;
        }

        const previousProjects = this.host.projects;
        const removalAnimation = this.animateProjectRemoval(project);
        this.host.projects = previousProjects.filter(candidate => candidate.id !== project.id);
        if (!removalAnimation.started) {
            this.host.render();
        }
        this.host.delegate.onProjectsChanged?.();

        // Release every section's embedded preview + backend dev-server claim owned by this
        // project before the project (and its conversations) go away, so removing a project does
        // not leave parked iframes / VPS dev servers running for its tasks.
        const projectConversations = this.host.conversationIndexUi?.conversationsForProject(project) ?? [];
        for (const summary of projectConversations) {
            this.host.releasePreviewForConversation?.(project, summary);
        }

        try {
            for (const summary of projectConversations) {
                if (summary.source === 'theia-chat') {
                    if (summary.sessionId && this.host.chatService) {
                        await this.host.chatService.deleteSession(summary.sessionId);
                        this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
                    }
                } else if (summary.id) {
                    await deleteConversation(summary.id);
                    this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
                }
            }
            const projectCwd = this.host.projectsService.getProjectCwd?.(project)
                ?? projectConversations.map(summary => summary.cwd).find(Boolean);
            if (projectCwd) {
                await deleteAgentTasksForCwd(projectCwd);
            }
            const removed = await this.host.projectsService.removeProject(project);
            if (!removed) {
                throw new Error(nls.localize('qaap/mobileProjects/removeRejected', 'The project could not be removed.'));
            }
            await removalAnimation.promise;
            // Reconcile with storage in the background after the optimistic paint. The service
            // keeps removed recent workspaces hidden even if its upstream list is momentarily stale.
            this.host.projects = await this.host.projectsService.loadProjects();
            this.host.render();
            this.host.delegate.onProjectsChanged?.();
        } catch (error) {
            await removalAnimation.promise;
            this.host.projects = previousProjects;
            this.host.render();
            this.host.delegate.onProjectsChanged?.();
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/removeFailed',
                'Could not remove project: {0}',
                error instanceof Error ? error.message : String(error),
            ));
        }
    }
}

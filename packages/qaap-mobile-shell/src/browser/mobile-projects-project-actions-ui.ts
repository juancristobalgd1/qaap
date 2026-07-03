// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { ChatService } from '@theia/ai-chat';
import { deleteConversation } from '../common/qaap-agent-conversation-client';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectEntry } from './mobile-projects-types';

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
}

/** Repository card actions: rename, duplicate, clear tasks, clear failed tasks, remove. */
export class MobileProjectsProjectActionsUi {

    constructor(protected readonly host: MobileProjectsProjectActionsHost) { }

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

    async onClearFailedTasks(project: MobileProjectEntry): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const failed = this.host.conversationIndexUi.vpsTasksForProject(project)
            .filter(summary => summary.status === 'failed');
        if (failed.length === 0) {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/clearFailedTasks', 'Clear failed runs'),
            msg: failed.length === 1
                ? nls.localize(
                    'qaap/mobileProjects/clearFailedTasksConfirmOne',
                    'Delete the 1 failed run for this project? This cannot be undone.'
                )
                : nls.localize(
                    'qaap/mobileProjects/clearFailedTasksConfirmMany',
                    'Delete all {0} failed runs for this project? This cannot be undone.',
                    String(failed.length)
                ),
        }).open();
        if (!confirmed) {
            return;
        }
        try {
            for (const summary of failed) {
                await deleteConversation(summary.id);
                this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
            }
            this.host.transcriptSheetUi.closeTranscriptSheet();
            this.host.renderList();
        } catch (error) {
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/clearFailedTasksFailed',
                'Could not clear failed runs: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async onRemoveProject(project: MobileProjectEntry): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const removed = await this.host.projectsService.removeProject(project);
        if (!removed) {
            return;
        }
        this.host.projects = await this.host.projectsService.loadProjects();
        this.host.render();
        this.host.delegate.onProjectsChanged?.();
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import { ChatRequestModel, ChatService, ChatSession } from '@theia/ai-chat';
import {
    cancelConversation,
    conversationToSummary,
    deleteConversation,
    forkConversation,
    isConversationAutoApproveEnabled,
    renameConversation,
    retryConversation,
    updateConversation,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { reportQaapClientError } from '../common/qaap-client-error-report';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';
import type { MobileProjectsTranscriptSheetUi } from './mobile-projects-transcript-sheet-ui';
import type { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import type { MobileProjectEntry } from './mobile-projects-types';

/** Panel surface for task card menu actions (rename, fork, pause, cancel, delete, …). */
export interface MobileProjectsConversationActionsHost {
    messageService: MessageService | undefined;
    chatService: ChatService | undefined;
    conversationFlags: MobileProjectsConversationFlags | undefined;
    conversations: MobileProjectsConversations | undefined;
    projects: MobileProjectEntry[];
    sessionsSidebar: MobileWorkHubSessionsSidebar | undefined;
    transcriptAutoApproveBusy: boolean;

    closeCardMenu(): void;
    renderList(): void;
    transcriptSheetUi: MobileProjectsTranscriptSheetUi;
    getOrRestoreProjectChatSession(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<ChatSession | undefined>;
    applyTaskStartedToProject(cwd: string, title: string, taskId: string): void;
    isWatchingOpenTranscript(conversationId: string): boolean;
    transcriptLiveUi: MobileProjectsTranscriptLiveUi;
    resolveActiveTranscriptChatHost(): HTMLElement | undefined;
    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
    /** Frees the embedded preview iframe, terminals, and backend dev-server claim owned by a section. */
    releasePreviewForConversation?(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void;
}

/** Task card actions invoked from project lists and the sessions sidebar. */
export class MobileProjectsConversationActionsUi {

    constructor(protected readonly host: MobileProjectsConversationActionsHost) { }

    async onForkConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        try {
            const full = await forkConversation(summary.id);
            const forked = conversationToSummary(full);
            this.host.conversations?.recordSnapshot(forked);
            this.refreshConversationLists();
            await this.host.transcriptSheetUi.openTranscriptSheet(project, forked);
        } catch (error) {
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/forkTaskFailed',
                'Could not fork task: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async onRenameConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        if (summary.source === 'theia-chat' && (!summary.sessionId || !this.host.chatService)) {
            return;
        }
        const dialog = new SingleTextInputDialog({
            title: nls.localize('qaap/mobileProjects/renameTaskDialog', 'Rename task'),
            initialValue: summary.title,
            placeholder: nls.localize('qaap/mobileProjects/renameTaskPlaceholder', 'Task name'),
            validate: (value, mode) => {
                if (mode !== 'preview' && !value.trim()) {
                    return nls.localize('qaap/mobileProjects/renameTaskRequired', 'Enter a task name');
                }
                return true;
            },
        });
        const value = await dialog.open();
        const title = value?.trim();
        if (!title || title === summary.title) {
            return;
        }

        const optimistic = { ...summary, title, updatedAt: Date.now() };
        this.host.conversations?.recordSnapshot(optimistic);
        this.refreshConversationLists();
        try {
            if (summary.source === 'theia-chat') {
                await this.host.getOrRestoreProjectChatSession(project, summary);
                await this.host.chatService!.renameSession(summary.sessionId!, title);
                await this.host.conversations?.refreshTheiaChatSessionsForProjects(this.host.projects);
            } else {
                const full = await renameConversation(summary.id, title);
                this.host.conversations?.recordSnapshot(conversationToSummary(full));
            }
            this.refreshConversationLists();
        } catch (error) {
            this.host.conversations?.recordSnapshot(summary);
            this.refreshConversationLists();
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/renameTaskFailed',
                'Could not rename task: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async onSetConversationPriority(
        summary: QaapAgentConversationSummaryDTO,
        priority: boolean,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const optimistic = { ...summary, priority: priority || undefined, updatedAt: Date.now() };
        this.host.conversations?.recordSnapshot(optimistic);
        this.refreshConversationLists();
        try {
            if (summary.source === 'theia-chat') {
                if (!this.host.conversationFlags) {
                    this.host.conversations?.recordSnapshot(summary);
                    this.refreshConversationLists();
                    return;
                }
                this.host.conversationFlags.set(summary.id, { priority });
            } else {
                const full = await updateConversation(summary.id, { priority });
                this.host.conversations?.recordSnapshot(conversationToSummary(full));
            }
            this.refreshConversationLists();
        } catch (error) {
            this.host.conversations?.recordSnapshot(summary);
            this.refreshConversationLists();
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/priorityFailed',
                'Could not update task priority: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async onSetConversationPaused(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        paused: boolean,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const optimistic = {
            ...summary,
            paused: paused || undefined,
            status: paused && summary.status === 'streaming' ? 'idle' as const : summary.status,
            updatedAt: Date.now(),
        };
        this.host.conversations?.recordSnapshot(optimistic);
        this.refreshConversationLists();
        try {
            if (paused && summary.status === 'streaming') {
                await this.onCancelConversation(project, summary);
            }
            if (summary.source === 'theia-chat') {
                if (!this.host.conversationFlags) {
                    this.host.conversations?.recordSnapshot(summary);
                    this.refreshConversationLists();
                    return;
                }
                this.host.conversationFlags.set(summary.id, { paused });
            } else {
                const full = await updateConversation(summary.id, { paused });
                this.host.conversations?.recordSnapshot(conversationToSummary(full));
            }
            this.refreshConversationLists();
        } catch (error) {
            this.host.conversations?.recordSnapshot({
                ...summary,
                status: optimistic.status,
                updatedAt: Date.now(),
            });
            this.refreshConversationLists();
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/pauseFailed',
                'Could not change task pause state: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async toggleConversationAutoApproveById(conversationId: string): Promise<void> {
        const summary = this.host.conversations?.findSummaryById(conversationId);
        if (!summary || summary.source === 'theia-chat') {
            return;
        }
        await this.onSetConversationAutoApprove(summary, !isConversationAutoApproveEnabled(summary));
    }

    async onSetConversationAutoApprove(
        summary: QaapAgentConversationSummaryDTO,
        autoApprove: boolean,
    ): Promise<void> {
        if (this.host.transcriptAutoApproveBusy) {
            return;
        }
        this.host.cardMenuUi.closeCardMenu();
        this.host.transcriptAutoApproveBusy = true;
        try {
            const full = await updateConversation(summary.id, { autoApprove });
            const next = conversationToSummary(full);
            this.host.conversations?.recordSnapshot(next);
            this.host.renderList();
            MobileSnackbar.show(
                autoApprove
                    ? nls.localize('qaap/mobileProjects/taskAutoApproveEnabled', 'Auto-approve enabled for this task')
                    : nls.localize('qaap/mobileProjects/taskAutoApproveDisabled', 'Auto-approve disabled — tool calls may wait for approval'),
                { kind: 'success', duration: 2200 },
            );
        } catch (error) {
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/taskAutoApproveFailed',
                'Could not update auto-approve: {0}',
                error instanceof Error ? error.message : String(error),
            ));
        } finally {
            this.host.transcriptAutoApproveBusy = false;
        }
    }

    onCancelConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        this.host.cardMenuUi.closeCardMenu();

        this.host.conversations?.recordSnapshot({ ...summary, status: 'idle', updatedAt: Date.now() });
        this.host.transcriptLiveUi.applyOptimisticConversationCancel(summary);
        this.refreshConversationLists();

        if (summary.source === 'theia-chat') {
            const sessionId = summary.sessionId;
            if (sessionId && this.host.chatService) {
                const session = this.host.chatService.getSession(sessionId);
                const request = [...(session?.model.getRequests() ?? [])]
                    .reverse()
                    .find(candidate => ChatRequestModel.isInProgress(candidate));
                if (session && request) {
                    this.host.chatService.cancelRequest(session.id, request.id).catch(err => {
                        this.host.messageService?.error(nls.localize(
                            'qaap/mobileProjects/cancelTaskFailed',
                            'Could not cancel run: {0}',
                            err instanceof Error ? err.message : String(err)
                        ));
                    });
                    return;
                }
            }
            this.host.getOrRestoreProjectChatSession(project, summary).then(session => {
                const request = [...(session?.model.getRequests() ?? [])]
                    .reverse()
                    .find(candidate => ChatRequestModel.isInProgress(candidate));
                if (session && request) {
                    this.host.chatService?.cancelRequest(session.id, request.id).catch(err => {
                        this.host.messageService?.error(nls.localize(
                            'qaap/mobileProjects/cancelTaskFailed',
                            'Could not cancel run: {0}',
                            err instanceof Error ? err.message : String(err)
                        ));
                    });
                }
            }).catch(() => { /* already updated local state */ });
        } else {
            cancelConversation(summary.id).catch(err => {
                reportQaapClientError('conversation-cancel', err);
                this.host.messageService?.error(nls.localize(
                    'qaap/mobileProjects/cancelTaskFailed',
                    'Could not cancel run: {0}',
                    err instanceof Error ? err.message : String(err)
                ));
            });
        }
    }

    async onRetryConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const rollbackSnapshot = { ...summary };
        const rollbackConv = this.host.transcriptLiveUi.readOpenTranscriptRollbackSnapshot(summary.id);
        const retriedTurnContent = rollbackConv
            ? [...rollbackConv.messages].reverse().find(message => message.role === 'user')?.content ?? summary.title
            : summary.title;

        this.host.transcriptLiveUi.applyOptimisticFailedTaskRetry(summary);
        this.host.conversations?.recordSnapshot({ ...summary, status: 'streaming', updatedAt: Date.now() });
        this.host.applyTaskStartedToProject(summary.cwd, retriedTurnContent, summary.id);
        this.refreshConversationLists();

        try {
            const retried = await retryConversation(summary.id);
            this.host.conversations?.recordSnapshot(conversationToSummary(retried));
            const retriedTurn = [...retried.messages].reverse().find(message => message.role === 'user');
            this.host.applyTaskStartedToProject(retried.cwd, retriedTurn?.content ?? retried.title, retried.id);
            if (this.host.isWatchingOpenTranscript(summary.id)) {
                const chatHost = this.host.resolveActiveTranscriptChatHost();
                if (chatHost) {
                    this.host.transcriptLiveUi.scheduleTranscriptConversationRefresh(project, summary, chatHost);
                }
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/taskRetried', 'Task restarted'),
                { kind: 'success', duration: 1400 }
            );
        } catch (error) {
            this.host.conversations?.recordSnapshot(rollbackSnapshot);
            this.refreshConversationLists();
            if (rollbackConv && this.host.isWatchingOpenTranscript(summary.id)) {
                this.host.transcriptLiveUi.restoreOpenTranscriptSnapshot(rollbackConv);
            }
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/retryTaskFailed',
                'Could not retry: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    async onArchiveConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const nextArchived = !summary.archived;
        // Optimistically update the snapshot so the UI hides/shows immediately.
        this.host.conversations?.recordSnapshot({ ...summary, archived: nextArchived || undefined });
        this.refreshConversationLists();

        try {
            const updated = await updateConversation(summary.id, { archived: nextArchived });
            this.host.conversations?.recordSnapshot(conversationToSummary(updated));
            this.refreshConversationLists();
            MobileSnackbar.show(
                nextArchived
                    ? nls.localize('qaap/mobileProjects/taskArchived', 'Task archived')
                    : nls.localize('qaap/mobileProjects/taskUnarchived', 'Task restored'),
                { kind: 'success', duration: 1400 },
            );
        } catch (error) {
            // Roll back on failure.
            this.host.conversations?.recordSnapshot(summary);
            this.refreshConversationLists();
            void reportQaapClientError(error, 'onArchiveConversation');
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/archiveTaskFailed',
                'Could not archive: {0}',
                error instanceof Error ? error.message : String(error),
            ));
        }
    }

    async onDeleteConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const confirmed = await new ConfirmDialog({
            title: nls.localize('qaap/mobileProjects/deleteTask', 'Delete task'),
            msg: nls.localize('qaap/mobileProjects/deleteTaskConfirm', 'Delete this task? This cannot be undone.'),
        }).open();
        if (!confirmed) {
            return;
        }

        if (summary.source === 'theia-chat' && (!summary.sessionId || !this.host.chatService)) {
            return;
        }

        // Paint the deletion before waiting for storage/backend I/O. The sessions sidebar has
        // its own DOM/fingerprint cache, so renderList() alone cannot remove the visible row.
        this.host.conversations?.removeSnapshot(summary.id, summary.cwd, summary.source);
        this.host.transcriptSheetUi.closeTranscriptSheet();
        // Free this section's embedded preview iframe, terminal slides, and backend dev-server
        // claim so closing a task does not leave parked iframes / terminals / VPS dev servers
        // running (per-section isolation).
        this.host.releasePreviewForConversation?.(project, summary);
        this.refreshConversationLists();

        try {
            if (summary.source === 'theia-chat') {
                await this.host.chatService!.deleteSession(summary.sessionId!);
                await this.host.conversations?.refreshTheiaChatSessionsForProjects(this.host.projects);
            } else {
                await deleteConversation(summary.id);
            }
            this.refreshConversationLists();
        } catch (error) {
            // Restore the exact row when persistence fails, including flags and display metadata.
            this.host.conversations?.restoreSnapshot(summary);
            this.refreshConversationLists();
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/deleteTaskFailed',
                'Could not delete task: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    protected refreshConversationLists(): void {
        this.host.renderList();
        if (this.host.sessionsSidebar?.isVisible()) {
            this.host.sessionsSidebar.refreshList({ force: true });
        }
    }
}

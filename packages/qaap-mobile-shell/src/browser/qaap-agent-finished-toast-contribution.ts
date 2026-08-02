// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileSnackbar } from './mobile-snackbar';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { QaapConversationChangeEvent } from '../common/qaap-conversation-change';
import type { MobileProjectEntry } from './mobile-projects-types';

/**
 * Panel callback registry — the panel (not DI-constructed) registers itself here so the
 * contribution can check the active conversation and navigate to a finished one.
 */
export interface QaapAgentFinishedToastPanelCallbacks {
    resolveOpenConversationId: () => string | undefined;
    openConversation: (project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO) => void;
    resolveProjectForConversation: (conversationId: string) => { project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO } | undefined;
}

/**
 * Shows a snackbar toast when a background agent finishes its turn (streaming → settled/idle/failed)
 * while the user is NOT viewing that conversation. The toast includes an "Open" action that navigates
 * to the finished conversation. This closes the multi-tasking gap: today the user has no signal that
 * an agent in another section completed.
 */
@injectable()
export class QaapAgentFinishedToastContribution implements FrontendApplicationContribution {

    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;

    protected callbacks: QaapAgentFinishedToastPanelCallbacks | undefined;
    protected readonly previousStatusByConversationId = new Map<string, string>();

    onStart(): void {
        this.conversations.start();
        this.conversations.onDidChangeDetail(change => this.handleConversationChange(change));
    }

    /** Wired by the panel after construction. */
    bindPanelCallbacks(callbacks: QaapAgentFinishedToastPanelCallbacks): void {
        this.callbacks = callbacks;
    }

    protected handleConversationChange(change: QaapConversationChangeEvent): void {
        if (!change.conversationId) {
            return;
        }
        const conversationId = change.conversationId;
        const summary = this.conversations.threadStore.findSummaryById(conversationId);
        if (!summary) {
            this.previousStatusByConversationId.delete(conversationId);
            return;
        }
        const previousStatus = this.previousStatusByConversationId.get(conversationId);
        const currentStatus = summary.status;
        this.previousStatusByConversationId.set(conversationId, currentStatus);

        // Only fire on the transition streaming → non-streaming (agent finished its turn).
        if (previousStatus !== 'streaming' || currentStatus === 'streaming') {
            return;
        }

        // Don't toast if the user is already viewing this conversation.
        const openId = this.callbacks?.resolveOpenConversationId();
        if (openId === conversationId) {
            return;
        }

        // Resolve the project + summary for the "Open" action.
        const resolved = this.callbacks?.resolveProjectForConversation(conversationId);
        if (!resolved) {
            return;
        }

        const isFailed = currentStatus === 'failed';
        const kind: 'success' | 'warning' = isFailed ? 'warning' : 'success';
        const message = isFailed
            ? nls.localize(
                'qaap/mobileProjects/agentFinishedFailed',
                'Agent failed: {0}',
                summary.title,
            )
            : nls.localize(
                'qaap/mobileProjects/agentFinished',
                'Agent finished: {0}',
                summary.title,
            );
        const actionLabel = nls.localize('qaap/mobileProjects/agentFinishedOpen', 'Open');

        MobileSnackbar.show(message, {
            kind,
            duration: 6000,
            actionLabel,
            onAction: () => this.callbacks?.openConversation(resolved.project, resolved.summary),
        });
    }
}

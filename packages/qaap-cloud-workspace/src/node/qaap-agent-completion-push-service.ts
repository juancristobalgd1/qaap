// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { resolveAgentLogDisplayText } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { isGoalLoopActive } from '../common/qaap-agent-goal-loop';
import { buildAgentTurnPushNotifyRequest } from '../common/qaap-web-push-payload';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapWebPushService } from './qaap-web-push-service';

/** Rich Web Push when VPS agent turns settle or need manual approval. */
@injectable()
export class QaapAgentCompletionPushService {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    @inject(QaapWebPushService)
    protected readonly webPush: QaapWebPushService;

    @postConstruct()
    protected init(): void {
        this.store.onTurnSettled(event => {
            void this.onTurnSettled(event.conversationId, event.conv, event.userMessageId);
        });
        this.taskRunner.onApprovalNeeded(event => {
            void this.notifyApprovalNeeded(event.taskId);
        });
    }

    async notifyApprovalNeeded(taskId: string): Promise<void> {
        const conversationId = this.store.findConversationIdForTask(taskId);
        if (!conversationId) {
            return;
        }
        const conv = this.store.get(conversationId);
        if (!conv) {
            return;
        }
        const projectName = conv.cwd.split(/[/\\]/).filter(Boolean).pop() ?? conv.cwd;
        await this.webPush.notify(buildAgentTurnPushNotifyRequest({
            ok: false,
            title: conv.title,
            conversationId,
            agentId: conv.agentId,
            projectName,
            taskId,
            needsApproval: true,
        }));
    }

    protected async onTurnSettled(
        conversationId: string,
        conv: QaapAgentConversation,
        userMessageId: string,
    ): Promise<void> {
        if (isGoalLoopActive(conv.goalLoop)) {
            return;
        }
        const userMessage = conv.messages.find(message => message.id === userMessageId);
        const taskId = userMessage?.taskId;
        const ok = conv.status !== 'failed' && !userMessage?.error;
        let logHint: string | undefined;
        if (!ok && taskId) {
            const detail = await this.taskRunner.detail(taskId);
            const log = (detail?.log ?? '').trim();
            if (log) {
                logHint = resolveAgentLogDisplayText(conv.agentId, log).slice(-160);
            }
        }
        const projectName = conv.cwd.split(/[/\\]/).filter(Boolean).pop() ?? conv.cwd;
        await this.webPush.notify(buildAgentTurnPushNotifyRequest({
            ok,
            title: conv.title,
            conversationId,
            agentId: conv.agentId,
            projectName,
            ...(taskId ? { taskId } : {}),
            linesAdded: conv.gitDiffAdded,
            linesRemoved: conv.gitDiffRemoved,
            ...(logHint ? { logHint } : {}),
        }));
    }
}

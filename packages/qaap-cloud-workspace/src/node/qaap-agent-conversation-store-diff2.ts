// Extracted from qaap-agent-conversation-store.ts

import {
    QaapAgentConversation,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

export async function rewindToMessageExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, messageId: string): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const plan = planConversationRewind(conv, messageId);
        for (const taskId of plan.taskIdsToCancel) {
            ctx.taskRunner.cancel(taskId);
            ctx.agentStreamByTaskId.delete(taskId);
            ctx.agUiStreamByTaskId.delete(taskId);
            ctx.taskToConversation.delete(taskId);
        }
        let next: QaapAgentConversation = {
            ...conv,
            status: 'idle',
            messages: plan.trimmedMessages,
            checkpoints: plan.trimmedCheckpoints,
            updatedAt: Date.now(),
            gitDiffAdded: undefined,
            gitDiffRemoved: undefined,
        };
        if (plan.restoreCheckpoint) {
            const repositoryCheck = ctx.mutatingGitSync(
                conv.cwd,
                ['rev-parse', '--is-inside-work-tree'],
            );
            if (repositoryCheck.status !== 0) {
                throw new Error('The conversation workspace is not a git repository.');
            }
            const undo = ctx.captureCheckpoint(conv.cwd, conversationId, messageId, 'Before rewind');
            const restore = ctx.mutatingGitSync(
                conv.cwd,
                ['restore', '--source', plan.restoreCheckpoint.commit, '--worktree', '--', '.'],
            );
            if (restore.status !== 0) {
                throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
            }
            if (undo) {
                next = { ...next, checkpoints: [...(next.checkpoints ?? []), undo] };
            }
        }
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export async function restoreCheckpointExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, checkpointId: string): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const checkpoint = conv.checkpoints?.find(c => c.id === checkpointId);
        if (!checkpoint) {
            throw new Error('Checkpoint not found.');
        }
        const repositoryCheck = ctx.mutatingGitSync(
            conv.cwd,
            ['rev-parse', '--is-inside-work-tree'],
        );
        if (repositoryCheck.status !== 0) {
            throw new Error('The conversation workspace is not a git repository.');
        }
        const undo = ctx.captureCheckpoint(conv.cwd, conversationId, checkpoint.messageId, 'Before restore');
        const restore = ctx.mutatingGitSync(conv.cwd, ['restore', '--source', checkpoint.commit, '--worktree', '--', '.']);
        if (restore.status !== 0) {
            throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
        }
        let next = conv;
        if (undo) {
            next = { ...conv, checkpoints: [...(conv.checkpoints ?? []), undo], updatedAt: Date.now() };
            ctx.conversations.set(conversationId, next);
            ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
            void ctx.persist();
        }
        return next;
}

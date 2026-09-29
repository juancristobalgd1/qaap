// Extracted from qaap-agent-conversation-store.ts

import {
    QaapAgentConversation,
    QaapConversationCheckpoint,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { QAAP_GIT_ADD_ALL_TIMEOUT_MS } from './qaap-agent-conversation-store-git';

/**
 * Capture an undo checkpoint and restore the worktree to `commit`, as one job on the
 * per-repository git chain so it never interleaves with a turn-settle checkpoint.
 */
function captureUndoAndRestore(ctx: QaapAgentConversationStoreContext, cwd: string, conversationId: string,
    messageId: string, undoLabel: string, commit: string): Promise<QaapConversationCheckpoint | undefined> {
    return ctx.runSerializedGit(cwd, async () => {
        const repositoryCheck = await ctx.mutatingGit(
            cwd,
            ['rev-parse', '--is-inside-work-tree'],
        );
        if (repositoryCheck.status !== 0) {
            throw new Error('The conversation workspace is not a git repository.');
        }
        const undo = await ctx.captureCheckpoint(cwd, conversationId, messageId, undoLabel);
        const restore = await ctx.mutatingGit(
            cwd,
            ['restore', '--source', commit, '--worktree', '--', '.'],
            undefined,
            QAAP_GIT_ADD_ALL_TIMEOUT_MS,
        );
        if (restore.status !== 0) {
            throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
        }
        return undo;
    });
}

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
            const undo = await captureUndoAndRestore(ctx, conv.cwd, conversationId, messageId, 'Before rewind', plan.restoreCheckpoint.commit);
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
        const undo = await captureUndoAndRestore(ctx, conv.cwd, conversationId, checkpoint.messageId, 'Before restore', checkpoint.commit);
        // Re-read across the git await: a peer run may have streamed into this conversation meanwhile.
        const current = ctx.conversations.get(conversationId) ?? conv;
        let next = current;
        if (undo) {
            next = { ...current, checkpoints: [...(current.checkpoints ?? []), undo], updatedAt: Date.now() };
            ctx.conversations.set(conversationId, next);
            ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
            void ctx.persist();
        }
        return next;
}

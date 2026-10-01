// Extracted from qaap-agent-conversation-store.ts

import {
    QaapAgentConversation,
    QaapConversationCheckpoint,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapRewindPreviewDTO, QaapRewindRestoreOptions } from '@theia/qaap-shared-core/lib/common/qaap-conversation-rewind-preview';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { QAAP_GIT_ADD_ALL_TIMEOUT_MS } from './qaap-agent-conversation-store-git';
import { computeRewindPreview, planRewindRestore, type QaapRewindGitRunner } from './qaap-agent-conversation-rewind-preview-git';

/** Tenant-wrapped async git in `cwd` (same invocation as `mutatingGit`, 64 MiB output buffer). */
function rewindGitRunner(ctx: QaapAgentConversationStoreContext, cwd: string): QaapRewindGitRunner {
    return (args, env, timeoutMs) => ctx.mutatingGit(cwd, args, env, timeoutMs);
}

/**
 * Capture an undo checkpoint and restore the worktree to `checkpoint`, as one job on the
 * per-repository git chain so it never interleaves with a turn-settle checkpoint. With `options`
 * the restore is selective (safe/all) and re-validated against a fresh classification first.
 * `onValidated` runs once every check passed and before anything changes (e.g. cancel running turns),
 * so a rejected restore (409) has no side effect.
 */
function captureUndoAndRestore(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation, messageId: string,
    undoLabel: string, checkpoint: QaapConversationCheckpoint, options?: QaapRewindRestoreOptions,
    onValidated?: () => void): Promise<QaapConversationCheckpoint | undefined> {
    const cwd = conv.cwd;
    return ctx.runSerializedGit(cwd, async () => {
        const repositoryCheck = await ctx.mutatingGit(
            cwd,
            ['rev-parse', '--is-inside-work-tree'],
        );
        if (repositoryCheck.status !== 0) {
            throw new Error('The conversation workspace is not a git repository.');
        }
        // Validate the selective restore (may throw for unconfirmed unsafe files) before any side effect.
        const applySelective = options
            ? await planRewindRestore(rewindGitRunner(ctx, cwd), conv, checkpoint, options)
            : undefined;
        onValidated?.();
        const undo = await ctx.captureCheckpoint(cwd, conv.id, messageId, undoLabel);
        if (applySelective) {
            await applySelective();
        } else {
            const restore = await ctx.mutatingGit(
                cwd,
                ['restore', '--source', checkpoint.commit, '--worktree', '--', '.'],
                undefined,
                QAAP_GIT_ADD_ALL_TIMEOUT_MS,
            );
            if (restore.status !== 0) {
                throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
            }
        }
        return undo ? { ...undo, restoredFrom: checkpoint.commit } : undefined;
    });
}

/**
 * Dry run for a checkpoint restore (`checkpointId`) or a message rewind (`messageId`): the files
 * the restore would touch, classified safe/unsafe (see `qaap-conversation-rewind-preview.ts`).
 */
export async function previewRewindExtracted(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    target: { readonly checkpointId?: string; readonly messageId?: string },
): Promise<QaapRewindPreviewDTO | undefined> {
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return undefined;
    }
    let checkpoint: QaapConversationCheckpoint | undefined;
    if (target.checkpointId) {
        checkpoint = conv.checkpoints?.find(c => c.id === target.checkpointId);
        if (!checkpoint) {
            throw new Error('Checkpoint not found.');
        }
    } else if (target.messageId) {
        checkpoint = planConversationRewind(conv, target.messageId).restoreCheckpoint;
    } else {
        throw new Error('checkpoint or messageId is required.');
    }
    // Serialized so the working-tree snapshot never observes a half-applied checkpoint/restore.
    const computation = await ctx.runSerializedGit(conv.cwd, () => computeRewindPreview(rewindGitRunner(ctx, conv.cwd), conv, checkpoint));
    return computation.preview;
}

export async function rewindToMessageExtracted(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    messageId: string,
    options?: QaapRewindRestoreOptions,
): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const plan = planConversationRewind(conv, messageId);
        const cancelRewoundTurns = (): void => {
            for (const taskId of plan.taskIdsToCancel) {
                ctx.taskRunner.cancel(taskId);
                ctx.agentStreamByTaskId.delete(taskId);
                ctx.agUiStreamByTaskId.delete(taskId);
                ctx.taskToConversation.delete(taskId);
            }
        };
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
            // Running turns are cancelled only once the restore is validated: a rejected rewind (409,
            // not a git repository) leaves the conversation and its agent untouched.
            const undo = await captureUndoAndRestore(ctx, conv, messageId, 'Before rewind', plan.restoreCheckpoint, options, cancelRewoundTurns);
            if (undo) {
                next = { ...next, checkpoints: [...(next.checkpoints ?? []), undo] };
            }
        } else {
            cancelRewoundTurns();
        }
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export async function restoreCheckpointExtracted(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    checkpointId: string,
    options?: QaapRewindRestoreOptions,
): Promise<QaapAgentConversation | undefined> {
        const conv = ctx.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const checkpoint = conv.checkpoints?.find(c => c.id === checkpointId);
        if (!checkpoint) {
            throw new Error('Checkpoint not found.');
        }
        const undo = await captureUndoAndRestore(ctx, conv, checkpoint.messageId, 'Before restore', checkpoint, options);
        // Re-read across the git await: a peer run may have streamed into this conversation meanwhile.
        const current = ctx.conversations.get(conversationId) ?? conv;
        let next = current;
        if (undo) {
            next = {
                ...current,
                checkpoints: [...(current.checkpoints ?? []), undo],
                updatedAt: Date.now(),
                // The cancelled turn's changes were just discarded; do not offer it again.
                ...(current.discardCheckpointId === checkpointId ? { discardCheckpointId: undefined } : {}),
            };
            ctx.conversations.set(conversationId, next);
            ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
            void ctx.persist();
        }
        return next;
}

// Extracted from qaap-agent-conversation-store.ts

import { spawnSync } from 'child_process';
import {
    QaapAgentConversation,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import type { QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import type { QaapRewindPreviewDTO, QaapRewindRestoreOptions } from '@theia/qaap-shared-core/lib/common/qaap-conversation-rewind-preview';
import { computeRewindPreview, planRewindRestore, type QaapRewindGitRunner } from './qaap-agent-conversation-rewind-preview-git';

/** Rewind preview/restore git output (diff-tree, ls-files) can exceed Node's 1 MiB default. */
const REWIND_GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** Same tenant-wrapped invocation as `mutatingGitSync`, with a larger output buffer. */
function rewindGitRunner(ctx: QaapAgentConversationStoreContext, cwd: string): QaapRewindGitRunner {
    return (args, env) => {
        const wrapped = ctx.tenantSpawn.wrapShellForTenant(
            cwd,
            'git',
            ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
        );
        const runEnv = { ...(env ?? process.env), ...ctx.tenantSpawn.tenantHomeEnvOverlay(cwd) };
        return spawnSync(wrapped.file, wrapped.args, { cwd, env: runEnv, encoding: 'utf8', maxBuffer: REWIND_GIT_MAX_BUFFER });
    };
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
    return computeRewindPreview(rewindGitRunner(ctx, conv.cwd), conv, checkpoint).preview;
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
            // Validate the selective restore (may throw for unconfirmed unsafe files) before any side effect.
            const applySelective = options
                ? planRewindRestore(rewindGitRunner(ctx, conv.cwd), conv, plan.restoreCheckpoint, options)
                : undefined;
            const undo = ctx.captureCheckpoint(conv.cwd, conversationId, messageId, 'Before rewind');
            if (applySelective) {
                applySelective();
            } else {
                const restore = ctx.mutatingGitSync(
                    conv.cwd,
                    ['restore', '--source', plan.restoreCheckpoint.commit, '--worktree', '--', '.'],
                );
                if (restore.status !== 0) {
                    throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
                }
            }
            if (undo) {
                next = { ...next, checkpoints: [...(next.checkpoints ?? []), { ...undo, restoredFrom: plan.restoreCheckpoint.commit }] };
            }
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
        const repositoryCheck = ctx.mutatingGitSync(
            conv.cwd,
            ['rev-parse', '--is-inside-work-tree'],
        );
        if (repositoryCheck.status !== 0) {
            throw new Error('The conversation workspace is not a git repository.');
        }
        const applySelective = options
            ? planRewindRestore(rewindGitRunner(ctx, conv.cwd), conv, checkpoint, options)
            : undefined;
        const undo = ctx.captureCheckpoint(conv.cwd, conversationId, checkpoint.messageId, 'Before restore');
        if (applySelective) {
            applySelective();
        } else {
            const restore = ctx.mutatingGitSync(conv.cwd, ['restore', '--source', checkpoint.commit, '--worktree', '--', '.']);
            if (restore.status !== 0) {
                throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
            }
        }
        let next = conv;
        if (undo) {
            const undoWithSource: QaapConversationCheckpoint = { ...undo, restoredFrom: checkpoint.commit };
            next = { ...conv, checkpoints: [...(conv.checkpoints ?? []), undoWithSource], updatedAt: Date.now() };
            ctx.conversations.set(conversationId, next);
            ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
            void ctx.persist();
        }
        return next;
}

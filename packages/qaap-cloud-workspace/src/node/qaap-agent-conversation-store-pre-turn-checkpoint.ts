// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    type QaapAgentConversation,
    type QaapAgentMessage,
    type QaapConversationCheckpoint,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

/**
 * How long a turn's agent spawn waits for its pre-turn snapshot. A snapshot that misses the budget
 * is dropped (the agent may already be writing, so it would not be a true "before" state).
 */
export const QAAP_PRE_TURN_CHECKPOINT_BUDGET_MS = 3_000;

/** How long "Discard changes" publication waits for a cancelled turn's process to exit. */
export const QAAP_DISCARD_PROCESS_EXIT_TIMEOUT_MS = 60_000;

/**
 * Start a pre-turn worktree snapshot for `userMessage` and return the gate the task runner awaits
 * before spawning the agent. The gate resolves when the snapshot is recorded, when it fails
 * (non-git workspace, git error) or when {@link QAAP_PRE_TURN_CHECKPOINT_BUDGET_MS} elapses —
 * whichever comes first — and never rejects.
 */
export function capturePreTurnCheckpointGate(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    cwd: string,
    userMessage: Pick<QaapAgentMessage, 'id' | 'content'>,
    budgetMs: number = QAAP_PRE_TURN_CHECKPOINT_BUDGET_MS,
): Promise<void> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>(resolve => {
        timer = setTimeout(() => {
            expired = true;
            resolve();
        }, budgetMs);
    });
    const label = `Before: ${ctx.checkpointLabel(userMessage.content ?? '')}`;
    const recorded = Promise.resolve()
        .then(() => ctx.runSerializedGit(cwd, () => ctx.captureCheckpoint(cwd, conversationId, userMessage.id, label)))
        .catch(() => undefined)
        .then(checkpoint => {
            if (!checkpoint) {
                return;
            }
            if (expired || !recordPreTurnCheckpoint(ctx, conversationId, { ...checkpoint, kind: 'pre-turn' })) {
                void ctx.runSerializedGit(cwd, () => ctx.discardCheckpointRef(cwd, checkpoint.ref)).catch(() => undefined);
            }
        });
    return Promise.race([recorded, budget]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

/** Append a pre-turn checkpoint when its user message still exists; `false` when it was dropped. */
export function recordPreTurnCheckpoint(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    checkpoint: QaapConversationCheckpoint,
): boolean {
    const conv = ctx.conversations.get(conversationId);
    if (!conv || !conv.messages.some(message => message.id === checkpoint.messageId)) {
        return false;
    }
    ctx.conversations.set(conversationId, {
        ...conv,
        checkpoints: [...(conv.checkpoints ?? []), checkpoint],
    });
    void ctx.persist();
    return true;
}

/** Newest pre-turn checkpoint captured for `userMessageId`. */
export function findPreTurnCheckpoint(
    conv: Pick<QaapAgentConversation, 'checkpoints'>,
    userMessageId: string,
): QaapConversationCheckpoint | undefined {
    return [...(conv.checkpoints ?? [])].reverse()
        .find(checkpoint => checkpoint.kind === 'pre-turn' && checkpoint.messageId === userMessageId && !!checkpoint.commit);
}

/**
 * The checkpoint "Discard changes" may offer for a cancelled run of `userMessageId`: its pre-turn
 * snapshot, but only while that run is still the latest user turn and nothing is streaming.
 */
export function resolveDiscardCheckpointId(
    conv: Pick<QaapAgentConversation, 'checkpoints' | 'messages' | 'status'>,
    userMessageId: string,
): string | undefined {
    if (conv.status === 'streaming') {
        return undefined;
    }
    const lastUser = [...conv.messages].reverse().find(message => message.role === 'user');
    if (lastUser?.id !== userMessageId) {
        return undefined;
    }
    return findPreTurnCheckpoint(conv, userMessageId)?.id;
}

/**
 * After a turn was cancelled, wait for its agent process to exit (a stopping CLI may still flush a
 * write during its graceful-stop window), then publish the pre-turn checkpoint as
 * `discardCheckpointId` so the UI can offer "Discard changes".
 */
export async function publishDiscardCheckpointAfterExit(
    ctx: QaapAgentConversationStoreContext,
    conversationId: string,
    userMessageId: string,
    taskIds: readonly string[],
    timeoutMs: number = QAAP_DISCARD_PROCESS_EXIT_TIMEOUT_MS,
): Promise<void> {
    const exited = await (ctx.taskRunner.waitForProcessExit?.(taskIds, timeoutMs) ?? Promise.resolve(true));
    if (!exited) {
        return;
    }
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return;
    }
    const discardCheckpointId = resolveDiscardCheckpointId(conv, userMessageId);
    if (!discardCheckpointId || conv.discardCheckpointId === discardCheckpointId) {
        return;
    }
    const next: QaapAgentConversation = { ...conv, discardCheckpointId };
    ctx.conversations.set(conversationId, next);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** The checkpoint fields the diff helpers read. */
export interface QaapTurnDiffCheckpointLike {
    readonly messageId: string;
    readonly commit: string;
    readonly kind?: 'pre-turn';
    readonly added?: number;
    readonly removed?: number;
}

/** The conversation fields the diff helpers read. */
export interface QaapTurnDiffConversationLike {
    readonly messages: ReadonlyArray<{ readonly id: string; readonly role: string }>;
    readonly checkpoints?: ReadonlyArray<QaapTurnDiffCheckpointLike>;
}

/**
 * Task baseline commit: the first pre-turn snapshot of the conversation's first user message. Same rule as
 * the backend's `resolveBaselineCommit`, so the client and the server name the same baseline.
 */
export function resolveTaskBaselineCommit(conv: QaapTurnDiffConversationLike): string | undefined {
    const firstUser = conv.messages.find(message => message.role === 'user');
    if (!firstUser) {
        return undefined;
    }
    return (conv.checkpoints ?? [])
        .find(checkpoint => checkpoint.kind === 'pre-turn' && checkpoint.messageId === firstUser.id && !!checkpoint.commit)
        ?.commit;
}

/**
 * Line totals of the one turn that produced `agentMessageId`, from the post-turn checkpoint the backend wrote
 * when that turn settled (the user message before the agent reply owns it). Undefined when there is none.
 */
export function resolveTurnCheckpointStats(conv: QaapTurnDiffConversationLike, agentMessageId: string): { readonly added: number; readonly removed: number } | undefined {
    const index = conv.messages.findIndex(message => message.id === agentMessageId);
    if (index < 0) {
        return undefined;
    }
    let userMessageId: string | undefined;
    for (let position = index - 1; position >= 0; position--) {
        if (conv.messages[position].role === 'user') {
            userMessageId = conv.messages[position].id;
            break;
        }
    }
    if (!userMessageId) {
        return undefined;
    }
    const settled = (conv.checkpoints ?? []).filter(checkpoint =>
        checkpoint.messageId === userMessageId && checkpoint.kind !== 'pre-turn'
        && checkpoint.added !== undefined && checkpoint.removed !== undefined);
    const last = settled[settled.length - 1];
    return last ? { added: last.added ?? 0, removed: last.removed ?? 0 } : undefined;
}

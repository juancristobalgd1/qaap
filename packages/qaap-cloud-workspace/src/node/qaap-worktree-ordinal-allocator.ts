// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    isQaapWorktreeConversation,
    nextQaapWorktreeOrdinal,
    normalizeWorktreeCwd,
    qaapWorktreeNumberingKey,
    resolveQaapWorktreeOrdinals,
} from '@theia/qaap-shared-core/lib/common/qaap-worktree-label';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';

/** SQLite key (agent-conversations namespace) holding the per-project high-water marks. */
export const QAAP_WORKTREE_ORDINAL_HIGH_WATER_KEY = 'worktreeOrdinalHighWater';

/** State the allocator needs from the conversation store. */
export interface QaapWorktreeOrdinalState {
    readonly conversations: Map<string, QaapAgentConversation>;
    /** Highest ordinal ever handed out per numbering key — never decreases, survives deletes. */
    readonly worktreeOrdinalHighWater?: Map<string, number>;
}

/**
 * Allocate the next `<projectName>_<n>` ordinal for a conversation created in a worktree of
 * {@link baseCwd}. Returns `undefined` when {@link cwd} is not a worktree of another repository.
 * Synchronous on purpose: callers invoke it right before inserting the conversation, so two
 * concurrent creates can never observe the same maximum.
 */
export const allocateQaapWorktreeOrdinal = (
    state: QaapWorktreeOrdinalState,
    cwd: string,
    baseCwd: string | undefined,
    ownerLogin: string | undefined,
): number | undefined => {
    if (!baseCwd || !isQaapWorktreeConversation({ cwd, parallelBaseCwd: baseCwd })) {
        return undefined;
    }
    const key = qaapWorktreeNumberingKey(baseCwd, ownerLogin);
    // The number belongs to the worktree directory: a conversation that joins an existing worktree
    // (e.g. created in its cwd) shares that worktree's label instead of consuming a new number.
    const cwdKey = normalizeWorktreeCwd(cwd);
    const conversations = [...state.conversations.values()];
    const existing = resolveQaapWorktreeOrdinals(conversations);
    for (const conv of conversations) {
        const shared = existing.get(conv.id);
        if (shared !== undefined && normalizeWorktreeCwd(conv.cwd) === cwdKey
            && qaapWorktreeNumberingKey(conv.parallelBaseCwd!, conv.ownerLogin) === key) {
            return shared;
        }
    }
    const highWater = state.worktreeOrdinalHighWater;
    const ordinal = nextQaapWorktreeOrdinal(conversations, baseCwd, ownerLogin, highWater?.get(key) ?? 0);
    highWater?.set(key, ordinal);
    return ordinal;
};

/**
 * Freeze labels of legacy worktree conversations (created before ordinals existed): number them in
 * creation order per source project, write the ordinal onto the conversation and raise the
 * high-water marks. Returns true when anything changed (caller persists).
 */
export const backfillQaapWorktreeOrdinals = (state: QaapWorktreeOrdinalState): boolean => {
    const ordinals = resolveQaapWorktreeOrdinals([...state.conversations.values()]);
    let changed = false;
    for (const [id, ordinal] of ordinals) {
        const conv = state.conversations.get(id);
        if (!conv) {
            continue;
        }
        const key = qaapWorktreeNumberingKey(conv.parallelBaseCwd!, conv.ownerLogin);
        const highWater = state.worktreeOrdinalHighWater;
        if (highWater && (highWater.get(key) ?? 0) < ordinal) {
            highWater.set(key, ordinal);
            changed = true;
        }
        if (conv.worktreeOrdinal !== ordinal) {
            state.conversations.set(id, { ...conv, worktreeOrdinal: ordinal });
            changed = true;
        }
    }
    return changed;
};

/** Parse the persisted high-water record, ignoring malformed entries. */
export const parseQaapWorktreeOrdinalHighWater = (raw: unknown): Map<string, number> => {
    const result = new Map<string, number>();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return result;
    }
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
            result.set(key, value);
        }
    }
    return result;
};

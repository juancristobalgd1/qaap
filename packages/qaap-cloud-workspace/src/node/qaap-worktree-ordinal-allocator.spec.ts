// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { toConversationSummary } from '../common/qaap-agent-conversation';
import {
    allocateQaapWorktreeOrdinal,
    backfillQaapWorktreeOrdinals,
    parseQaapWorktreeOrdinalHighWater,
    QaapWorktreeOrdinalState,
} from './qaap-worktree-ordinal-allocator';

const BASE = '/workspace/repos/alice/claude-of-duty';

const conversation = (id: string, cwd: string, createdAt: number, extra: Partial<QaapAgentConversation> = {}): QaapAgentConversation => ({
    id,
    cwd,
    agentId: 'qaiq',
    title: id,
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
    messages: [],
    ownerLogin: 'alice',
    ...extra,
});

const stateOf = (...conversations: QaapAgentConversation[]): QaapWorktreeOrdinalState & { worktreeOrdinalHighWater: Map<string, number> } => ({
    conversations: new Map(conversations.map(conv => [conv.id, conv])),
    worktreeOrdinalHighWater: new Map(),
});

/** Simulate the store inserting a freshly created worktree conversation. */
const create = (state: QaapWorktreeOrdinalState, id: string, hash: string): number | undefined => {
    const cwd = `/tmp/qaap-worktrees/alice/${hash}`;
    const ordinal = allocateQaapWorktreeOrdinal(state, cwd, BASE, 'alice');
    state.conversations.set(id, conversation(id, cwd, Date.now(), { parallelBaseCwd: BASE, worktreeOrdinal: ordinal }));
    return ordinal;
};

describe('qaap-worktree-ordinal-allocator', () => {
    it('allocates 1, 2, 3 per source project and nothing for non-worktree conversations', () => {
        const state = stateOf();
        expect(create(state, 'a', 'e895ac21')).to.equal(1);
        expect(create(state, 'b', 'bcd8daa6')).to.equal(2);
        expect(allocateQaapWorktreeOrdinal(state, BASE, undefined, 'alice')).to.equal(undefined);
        expect(allocateQaapWorktreeOrdinal(state, BASE, BASE, 'alice')).to.equal(undefined);
        expect(create(state, 'c', 'ffff0000')).to.equal(3);
    });

    it('keeps survivors stable and does not reuse numbers after deletes', () => {
        const state = stateOf();
        create(state, 'a', 'aaaa');
        create(state, 'b', 'bbbb');
        create(state, 'c', 'cccc');
        state.conversations.delete('b');
        state.conversations.delete('c');
        expect(state.conversations.get('a')?.worktreeOrdinal).to.equal(1);
        expect(create(state, 'd', 'dddd')).to.equal(4);
    });

    it('reuses the number of an existing worktree directory instead of consuming a new one', () => {
        const state = stateOf();
        create(state, 'a', 'aaaa');
        expect(create(state, 'a-second-chat', 'aaaa')).to.equal(1);
        expect(create(state, 'b', 'bbbb')).to.equal(2);
    });

    it('survives a reload: persisted high-water marks round-trip through JSON', () => {
        const state = stateOf();
        create(state, 'a', 'aaaa');
        create(state, 'b', 'bbbb');
        state.conversations.delete('b');
        const persisted = JSON.parse(JSON.stringify(Object.fromEntries(state.worktreeOrdinalHighWater)));
        const reloaded = stateOf(state.conversations.get('a')!);
        for (const [key, value] of parseQaapWorktreeOrdinalHighWater(persisted)) {
            reloaded.worktreeOrdinalHighWater.set(key, value);
        }
        expect(backfillQaapWorktreeOrdinals(reloaded)).to.equal(false);
        expect(create(reloaded, 'c', 'cccc')).to.equal(3);
        expect(parseQaapWorktreeOrdinalHighWater({ ok: 2, bad: 'x', zero: 0 })).to.deep.equal(new Map([['ok', 2]]));
    });

    it('backfills legacy hash-named worktrees in creation order and exposes the ordinal on summaries', () => {
        const state = stateOf(
            conversation('late', '/tmp/qaap-worktrees/alice/bcd8daa6', 20, { parallelBaseCwd: BASE, worktreeBranch: 'qaap/worktree/bcd8daa6' }),
            conversation('early', '/tmp/qaap-worktrees/alice/e895ac21', 10, { parallelBaseCwd: BASE, worktreeBranch: 'qaap/worktree/e895ac21' }),
            conversation('plain', BASE, 5),
        );
        expect(backfillQaapWorktreeOrdinals(state)).to.equal(true);
        expect(state.conversations.get('early')?.worktreeOrdinal).to.equal(1);
        expect(state.conversations.get('late')?.worktreeOrdinal).to.equal(2);
        expect(state.conversations.get('plain')?.worktreeOrdinal).to.equal(undefined);
        expect(toConversationSummary(state.conversations.get('late')!).worktreeOrdinal).to.equal(2);
        // Idempotent: a second restore changes nothing, and the next worktree continues the sequence.
        expect(backfillQaapWorktreeOrdinals(state)).to.equal(false);
        expect(create(state, 'new', 'ffff')).to.equal(3);
    });
});

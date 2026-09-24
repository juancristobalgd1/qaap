// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    expandConversationSlots,
    isIsolatedWorktreeFork,
    partitionAgentConversations,
} from './qaap-isolated-fork-grouping';

describe('qaap-isolated-fork-grouping', () => {

    const parent = { id: 'p1', worktreeBranch: undefined as string | undefined };
    const fork = {
        id: 'f1',
        forkedFromId: 'p1',
        worktreeBranch: 'qaap/worktree/abcd1234',
    };
    const orphan = {
        id: 'f2',
        forkedFromId: 'missing',
        worktreeBranch: 'qaap/worktree/orphan',
    };
    const variant = {
        id: 'v1',
        parallelRunId: 'run-1',
        worktreeBranch: 'qaap/parallel/run-1/qaiq',
    };
    const chatFork = {
        id: 'c2',
        forkedFromId: 'p1',
    };

    it('detects isolated Parallel worktree forks only', () => {
        expect(isIsolatedWorktreeFork(fork)).to.equal(true);
        expect(isIsolatedWorktreeFork(parent)).to.equal(false);
        expect(isIsolatedWorktreeFork(variant)).to.equal(false);
        expect(isIsolatedWorktreeFork(chatFork)).to.equal(false);
    });

    it('nests isolated forks under a parent that is still in the list', () => {
        const partitioned = partitionAgentConversations([parent, fork, orphan, variant, chatFork]);
        expect(partitioned.roots.map(item => item.id)).to.deep.equal(['p1', 'f2', 'c2']);
        expect([...partitioned.forksByParentId.keys()]).to.deep.equal(['p1']);
        expect(partitioned.forksByParentId.get('p1')?.map(item => item.id)).to.deep.equal(['f1']);
        expect(partitioned.variantRuns.get('run-1')?.map(item => item.id)).to.deep.equal(['v1']);
    });

    it('keeps a fork as a root when its parent is absent', () => {
        const partitioned = partitionAgentConversations([fork]);
        expect(partitioned.roots.map(item => item.id)).to.deep.equal(['f1']);
        expect(partitioned.forksByParentId.size).to.equal(0);
    });

    it('expands visible roots with nested forks for fingerprint slots', () => {
        const partitioned = partitionAgentConversations([parent, fork, variant]);
        const slots = expandConversationSlots(partitioned.roots, partitioned.forksByParentId);
        expect(slots.map(item => item.id)).to.deep.equal(['p1', 'f1']);
    });
});

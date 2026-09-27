// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    formatQaapWorktreeLabel,
    isQaapWorktreeConversation,
    nextQaapWorktreeOrdinal,
    QaapWorktreeLabelFields,
    qaapWorktreeProjectName,
    resolveQaapWorktreeLabelsByCwd,
    resolveQaapWorktreeOrdinals,
} from './qaap-worktree-label';

const BASE = '/workspace/repos/alice/claude-of-duty';
const OTHER_BASE = '/workspace/repos/alice/other-repo';

const worktree = (id: string, hash: string, createdAt: number, extra: Partial<QaapWorktreeLabelFields> = {}): QaapWorktreeLabelFields => ({
    id,
    cwd: `/tmp/qaap-worktrees/alice/${hash}`,
    createdAt,
    parallelBaseCwd: BASE,
    ...extra,
});

describe('qaap-worktree-label', () => {
    it('recognizes only conversations whose cwd differs from the source repository', () => {
        expect(isQaapWorktreeConversation({ cwd: '/tmp/qaap-worktrees/alice/e895ac21', parallelBaseCwd: BASE })).to.equal(true);
        expect(isQaapWorktreeConversation({ cwd: BASE, parallelBaseCwd: `${BASE}/` })).to.equal(false);
        expect(isQaapWorktreeConversation({ cwd: BASE })).to.equal(false);
    });

    it('formats <projectName>_<n> from the source repository basename', () => {
        expect(qaapWorktreeProjectName(BASE)).to.equal('claude-of-duty');
        expect(qaapWorktreeProjectName('C:\\repos\\claude-of-duty\\')).to.equal('claude-of-duty');
        expect(formatQaapWorktreeLabel('claude-of-duty', 2)).to.equal('claude-of-duty_2');
    });

    it('numbers new worktrees per project starting at 1', () => {
        const items: QaapWorktreeLabelFields[] = [];
        expect(nextQaapWorktreeOrdinal(items, BASE, 'alice')).to.equal(1);
        items.push(worktree('a', 'e895ac21', 1, { worktreeOrdinal: 1, ownerLogin: 'alice' }));
        expect(nextQaapWorktreeOrdinal(items, BASE, 'alice')).to.equal(2);
        // Another project (and another owner) keeps its own sequence.
        expect(nextQaapWorktreeOrdinal(items, OTHER_BASE, 'alice')).to.equal(1);
        expect(nextQaapWorktreeOrdinal(items, BASE, 'bob')).to.equal(1);
    });

    it('never renumbers survivors and never reuses a deleted top number (high-water mark)', () => {
        const items = [
            worktree('a', 'aaaa', 1, { worktreeOrdinal: 1 }),
            worktree('c', 'cccc', 3, { worktreeOrdinal: 3 }),
        ];
        // `_2` was deleted: the others keep their numbers.
        const ordinals = resolveQaapWorktreeOrdinals(items);
        expect(ordinals.get('a')).to.equal(1);
        expect(ordinals.get('c')).to.equal(3);
        // `_3` deleted too, but the persisted high-water mark (3) still wins.
        expect(nextQaapWorktreeOrdinal([items[0]], BASE, undefined, 3)).to.equal(4);
    });

    it('derives stable labels for legacy hash-named worktrees in creation order', () => {
        const legacy = [
            worktree('late', 'bcd8daa6', 20),
            worktree('early', 'e895ac21', 10),
        ];
        const first = resolveQaapWorktreeOrdinals(legacy);
        expect(first.get('early')).to.equal(1);
        expect(first.get('late')).to.equal(2);
        // Same input order-independent result on every reload.
        expect([...resolveQaapWorktreeOrdinals([...legacy].reverse())]).to.have.deep.members([...first]);
        // Legacy numbering continues after already persisted ordinals of the same project.
        const mixed = resolveQaapWorktreeOrdinals([worktree('new', 'ffff', 30, { worktreeOrdinal: 1 }), ...legacy]);
        expect(mixed.get('early')).to.equal(2);
        expect(mixed.get('late')).to.equal(3);
    });

    it('gives conversations that share one worktree directory the same number', () => {
        const ordinals = resolveQaapWorktreeOrdinals([
            worktree('parent', 'e895ac21', 10),
            worktree('fork', 'e895ac21', 11),
            worktree('other', 'bcd8daa6', 12),
        ]);
        expect(ordinals.get('parent')).to.equal(1);
        expect(ordinals.get('fork')).to.equal(1);
        expect(ordinals.get('other')).to.equal(2);
    });

    it('labels worktree directories, preferring the source project display name', () => {
        const labels = resolveQaapWorktreeLabelsByCwd(
            [worktree('a', 'e895ac21', 1, { worktreeOrdinal: 1 }), worktree('b', 'bcd8daa6', 2, { worktreeOrdinal: 2 })],
            base => base === BASE ? 'Claude Of Duty' : undefined,
        );
        expect(labels.get('/tmp/qaap-worktrees/alice/e895ac21')).to.equal('Claude Of Duty_1');
        expect(labels.get('/tmp/qaap-worktrees/alice/bcd8daa6')).to.equal('Claude Of Duty_2');
        const fallback = resolveQaapWorktreeLabelsByCwd([worktree('a', 'e895ac21', 1, { worktreeOrdinal: 4 })]);
        expect(fallback.get('/tmp/qaap-worktrees/alice/e895ac21')).to.equal('claude-of-duty_4');
    });
});

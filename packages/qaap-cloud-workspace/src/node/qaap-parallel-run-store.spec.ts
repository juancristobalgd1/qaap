// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapParallelRunStore } from './qaap-parallel-run-store';

class TestableQaapParallelRunStore extends QaapParallelRunStore {
    maxVariants = 4;

    normalize(input: readonly string[]): string[] {
        return this.normalizeAgents(input);
    }

    protected override maxParallelVariants(): number {
        return this.maxVariants;
    }

    configure(conversationStore: unknown, tenantSpawn: unknown): void {
        Object.assign(this, { conversationStore, tenantSpawn });
    }

    protected override isDirectory(): boolean {
        return true;
    }

    protected override async assertGitRepo(): Promise<void> { /* no-op */ }
    protected override async mutatingGit(): Promise<string> { return ''; }
    protected override async commitWorktree(): Promise<void> { /* no-op */ }
    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async pushLiveStats(): Promise<void> { /* no-op */ }

    hasRun(id: string): boolean {
        return this.runs.has(id);
    }
}

describe('QaapParallelRunStore choose merge', () => {
    const run = (store: TestableQaapParallelRunStore, merged: Record<string, unknown>): Array<unknown[]> => {
        const calls: Array<unknown[]> = [];
        store.configure({ create: () => ({ id: 'conversation-1' }), delete: () => true }, { provisionTenantDir: () => undefined });
        Object.assign(store, {
            worktrees: {
                mergeBranchSafely: async (...args: unknown[]) => {
                    calls.push(args);
                    return merged;
                },
            },
        });
        return calls;
    };

    it('lands the winner through the shared safe merge-back and finalizes the run', async () => {
        const store = new TestableQaapParallelRunStore();
        const calls = run(store, { ok: true, branch: 'b' });
        const created = await store.create({ cwd: '/repo', prompt: 'solve it', agents: ['qaiq'] }, 'alice');
        const result = await store.choose(created.id, 'conversation-1', 'merge');
        expect(result.ok).to.equal(true);
        expect(calls).to.deep.equal([[created.cwd, created.variants[0].branch, 'alice']]);
        expect(store.hasRun(created.id)).to.equal(false);
    });

    it('keeps the run and its variants when the merge-back is refused', async () => {
        const store = new TestableQaapParallelRunStore();
        const refusal = { ok: false, reason: 'conflict', conflicts: ['a.ts'], error: 'Merge conflicts in a.ts.' };
        run(store, refusal);
        const created = await store.create({ cwd: '/repo', prompt: 'solve it', agents: ['qaiq'] }, 'alice');
        expect(await store.choose(created.id, 'conversation-1', 'merge')).to.deep.equal(refusal);
        expect(store.hasRun(created.id)).to.equal(true);
    });
});

describe('QaapParallelRunStore fan-out admission', () => {
    it('trims and deduplicates agent ids before allocating worktrees', () => {
        const store = new TestableQaapParallelRunStore();
        expect(store.normalize(['qaiq', ' QAIQ ', '', 'codex'])).to.deep.equal(['qaiq', 'codex']);
    });

    it('rejects fan-out above the backend limit', () => {
        const store = new TestableQaapParallelRunStore();
        store.maxVariants = 2;
        expect(() => store.normalize(['qaiq', 'codex', 'claude']))
            .to.throw('at most 2 variants');
    });

    it('propagates the run owner to every variant conversation', async () => {
        const owners: Array<string | undefined> = [];
        const store = new TestableQaapParallelRunStore();
        store.configure({
            create: (_request: unknown, ownerLogin?: string) => {
                owners.push(ownerLogin);
                return { id: `conversation-${owners.length}` };
            },
        }, {
            provisionTenantDir: () => undefined,
        });

        await store.create({ cwd: '/repo', prompt: 'solve it', agents: ['qaiq', 'codex'] }, 'alice');
        expect(owners).to.deep.equal(['alice', 'alice']);
    });
});

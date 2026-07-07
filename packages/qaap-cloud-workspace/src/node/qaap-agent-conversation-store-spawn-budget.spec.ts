// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

/** Exposes the shared loop-spawn budget helpers (no disk / DI needed for these). */
class TestConversationStore extends QaapAgentConversationStore {
    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* no-op */ }
    protected override startTurnWatchdog(): void { /* no-op */ }

    hasBudget(id: string): boolean {
        return (this as unknown as { hasLoopSpawnBudget(id: string): boolean }).hasLoopSpawnBudget(id);
    }

    record(id: string): void {
        (this as unknown as { recordLoopSpawn(id: string): void }).recordLoopSpawn(id);
    }
}

describe('QaapAgentConversationStore shared loop-spawn budget (#12)', () => {
    it('allows re-spawns up to the ceiling, then denies further ones for that user message', () => {
        const store = new TestConversationStore();
        const id = 'user-msg-1';
        let spawns = 0;
        // Drain the budget the way the two loops would: check-then-record.
        while (store.hasBudget(id)) {
            store.record(id);
            spawns += 1;
            if (spawns > 20) {
                break; // safety: must not be unbounded
            }
        }
        expect(spawns).to.be.greaterThan(0);
        expect(spawns).to.be.lessThan(20);
        expect(store.hasBudget(id)).to.equal(false);
    });

    it('scopes the budget per user message (one exhausted turn does not starve another)', () => {
        const store = new TestConversationStore();
        while (store.hasBudget('user-msg-a')) {
            store.record('user-msg-a');
        }
        expect(store.hasBudget('user-msg-a')).to.equal(false);
        expect(store.hasBudget('user-msg-b')).to.equal(true);
    });
});

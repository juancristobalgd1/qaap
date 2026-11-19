// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as sinon from 'sinon';
import { QaapSqliteConnectionRegistry, QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import {
    QAAP_CONVERSATION_LEGACY_NAMESPACE,
    QAAP_CONVERSATION_ROWS_NAMESPACE,
    conversationRowKey,
    hashConversationRow,
} from './qaap-agent-conversation-store-rows';

const CONVERSATIONS = 363;
const CONVERSATION_CHARS = 200 * 1024;
/** Budget of one persist that writes 1-3 conversations out of a store this size. */
const PERSIST_BUDGET_MS = 50;

class PerfTestStore extends QaapAgentConversationStore {

    private legacyForTest: QaapSqliteStore | undefined;
    private rowsForTest: QaapSqliteStore | undefined;

    constructor(readonly databasePath: string) {
        super();
        (this as unknown as { taskRunner: unknown }).taskRunner = { whenRecovered: async (): Promise<void> => undefined };
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE */ });
    }

    override getSqliteStore(): QaapSqliteStore {
        return this.legacyForTest ??= new QaapSqliteStore({ databasePath: this.databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
    }

    override getSqliteStoreV2(): QaapSqliteStore {
        return this.rowsForTest ??= new QaapSqliteStore({ databasePath: this.databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
    }

    override isTurnGraphEnabled(): boolean {
        return false;
    }

    override startTurnWatchdog(): void {
        /* no-op: no timers in these specs */
    }

    override captureGitSha(): string | undefined {
        return undefined;
    }
}

function bigConversation(index: number): QaapAgentConversation {
    const createdAt = 1_000 + index;
    const id = `conv-${String(index).padStart(4, '0')}`;
    const messages = [];
    const perMessage = 2_000;
    for (let i = 0; i < Math.floor(CONVERSATION_CHARS / perMessage); i++) {
        messages.push({
            id: `${id}-m${i}`,
            role: i % 2 === 0 ? 'user' : 'agent',
            content: `${i}:`.padEnd(perMessage - 150, 'x'),
            createdAt: createdAt + i,
        });
    }
    return {
        id, cwd: '/tmp/project', agentId: 'qaiq', title: `Conversation ${id}`, status: 'idle',
        interactionModeId: 'agent', createdAt, updatedAt: createdAt, messages,
    } as QaapAgentConversation;
}

describe('QaapAgentConversationStore persistence cost with a large store', function (): void {
    this.timeout(120_000);
    let directory: string;
    let databasePath: string;
    let store: PerfTestStore | undefined;
    let consoleWarn: sinon.SinonStub;
    let consoleInfo: sinon.SinonStub;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-conversation-perf-'));
        databasePath = path.join(directory, 'index.sqlite');
        consoleWarn = sinon.stub(console, 'warn');
        consoleInfo = sinon.stub(console, 'info');
    });

    afterEach(() => {
        store?.onStop();
        store = undefined;
        consoleWarn.restore();
        consoleInfo.restore();
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    /** Seeds the v2 namespace directly (already migrated), then restores a store from it. */
    async function restoreLargeStore(): Promise<PerfTestStore> {
        const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
        rows.withTransaction(() => {
            for (let i = 0; i < CONVERSATIONS; i++) {
                const conversation = bigConversation(i);
                rows.applyRawBatch([[conversationRowKey(conversation.id), JSON.stringify(conversation)]], []);
            }
            rows.recordMigration(QAAP_CONVERSATION_LEGACY_NAMESPACE);
        });
        store = new PerfTestStore(databasePath);
        await store.restoreFromDisk();
        await store.persist();
        return store;
    }

    async function timedPersist(target: PerfTestStore): Promise<number> {
        const startedAt = performance.now();
        await target.persist();
        return performance.now() - startedAt;
    }

    it('restores 363 conversations of ~200 KB without marking any row dirty', async () => {
        const target = await restoreLargeStore();
        expect(target.conversations.size).to.equal(CONVERSATIONS);
        expect(target.conversations.hasPendingWrites()).to.equal(false);
    });

    it(`persists one changed conversation in under ${PERSIST_BUDGET_MS} ms (a full rewrite took ~950 ms)`, async () => {
        const target = await restoreLargeStore();
        const applyBatch = sinon.spy(target.getSqliteStoreV2(), 'applyRawBatch');
        const timings: number[] = [];
        for (let round = 0; round < 5; round++) {
            const id = 'conv-0007';
            target.conversations.set(id, { ...target.conversations.get(id)!, title: `changed ${round}`, updatedAt: 5_000 + round });
            timings.push(await timedPersist(target));
        }
        timings.sort((a, b) => a - b);
        const median = timings[Math.floor(timings.length / 2)];
        console.log(`        one dirty conversation out of ${CONVERSATIONS}: median ${median.toFixed(1)} ms, max ${timings[timings.length - 1].toFixed(1)} ms`);
        expect(applyBatch.callCount).to.equal(5);
        for (const call of applyBatch.getCalls()) {
            expect(call.args[0]).to.have.length(1);
        }
        expect(median).to.be.lessThan(PERSIST_BUDGET_MS);
    });

    it(`persists a streaming turn (one read + one set per tick) in under ${PERSIST_BUDGET_MS} ms, with API-style reads of other conversations in between`, async () => {
        const target = await restoreLargeStore();
        const timings: number[] = [];
        for (let round = 0; round < 5; round++) {
            // The HTTP layer reads a handful of other conversations between ticks.
            for (let i = 10; i < 13; i++) {
                target.conversations.get(`conv-${String(i).padStart(4, '0')}`);
            }
            const id = 'conv-0001';
            target.conversations.set(id, { ...target.conversations.get(id)!, updatedAt: 9_000 + round });
            timings.push(await timedPersist(target));
        }
        timings.sort((a, b) => a - b);
        const median = timings[Math.floor(timings.length / 2)];
        console.log(`        streaming tick with 3 foreign reads: median ${median.toFixed(1)} ms, max ${timings[timings.length - 1].toFixed(1)} ms`);
        expect(median).to.be.lessThan(PERSIST_BUDGET_MS);
    });

    it('recovers every conversation after a restart, byte for byte', async () => {
        const target = await restoreLargeStore();
        target.conversations.set('conv-0100', { ...target.conversations.get('conv-0100')!, title: 'edited' });
        target.conversations.delete('conv-0200');
        await target.persist();
        const expected = new Map([...target.conversations].map(([id, conversation]) => [id, hashConversationRow(JSON.stringify(conversation))]));
        target.onStop();
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);

        store = new PerfTestStore(databasePath);
        await store.restoreFromDisk();
        const actual = new Map([...store.conversations].map(([id, conversation]) => [id, hashConversationRow(JSON.stringify(conversation))]));
        expect(actual.size).to.equal(CONVERSATIONS - 1);
        expect(actual.has('conv-0200')).to.equal(false);
        expect([...actual]).to.have.deep.members([...expected]);
    });

    it('does not rewrite the store on every restart: the restore backfill is written once and then stable', async () => {
        const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
        rows.withTransaction(() => {
            for (let i = 0; i < 20; i++) {
                const conversation = bigConversation(i);
                rows.applyRawBatch([[conversationRowKey(conversation.id), JSON.stringify(conversation)]], []);
            }
            rows.recordMigration(QAAP_CONVERSATION_LEGACY_NAMESPACE);
        });
        for (let start = 0; start < 3; start++) {
            store = new PerfTestStore(databasePath);
            await store.restoreFromDisk();
            const pendingAfterRestart = store.conversations.pendingWrites().upserts.length;
            await store.persist();
            if (start > 0) {
                expect(pendingAfterRestart, `restart ${start + 1}`).to.equal(0);
            }
            store.onStop();
            QaapSqliteConnectionRegistry.shared.closeUnder(directory);
            store = undefined;
        }
    });
});

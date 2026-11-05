// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as sinon from 'sinon';
import { QaapSqliteConnectionRegistry, QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import {
    QAAP_CONVERSATION_HIGH_WATER_ROW_KEY,
    QAAP_CONVERSATION_LEGACY_NAMESPACE,
    QAAP_CONVERSATION_ROWS_NAMESPACE,
    QAAP_CONVERSATION_FULL_SWEEP_MS,
    QaapConversationMigrationError,
    syncConversationRowsWithLegacy,
    QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY,
    conversationRowKey,
    resolveQaapConversationSetting,
    flushConversationRowsSync,
    sweepConversationRows,
} from './qaap-agent-conversation-store-rows';

const LEGACY_KEY = 'conversations';
const rollbackScript = path.resolve(__dirname, '../../../../scripts/qaap-conversations-v2-to-legacy.js');

/**
 * Store wired to a temporary SQLite file. Both namespaces point at `databasePath`, so nothing
 * reads or writes the real `~/.qaap` directory.
 */
class RowTestStore extends QaapAgentConversationStore {

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

    getForOwnerForTest(ownerLogin: string): string[] {
        return [...this.conversations.values()].filter(conv => conv.ownerLogin === ownerLogin).map(conv => conv.id);
    }
}

function conversation(id: string, createdAt: number, overrides?: Partial<QaapAgentConversation>): QaapAgentConversation {
    return {
        id,
        cwd: '/tmp/project',
        agentId: 'qaiq',
        title: `Conversation ${id}`,
        status: 'idle',
        interactionModeId: 'agent',
        createdAt,
        updatedAt: createdAt,
        messages: [
            { id: `${id}-u1`, role: 'user', content: 'hello', createdAt },
        ],
        ...overrides,
    } as QaapAgentConversation;
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value as Record<string, unknown>)) {
            deepFreeze(child);
        }
    }
    return value;
}

function rawRows(databasePath: string, namespace: string): Array<{ key: string; value: string }> {
    const database = new DatabaseSync(databasePath);
    try {
        return database.prepare('SELECT key, value FROM qaap_kv WHERE namespace = ? ORDER BY key')
            .all(namespace) as Array<{ key: string; value: string }>;
    } finally {
        database.close();
    }
}

function seedLegacyAggregate(databasePath: string, conversations: QaapAgentConversation[]): void {
    const store = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
    store.set(LEGACY_KEY, conversations);
}

describe('QaapAgentConversationStore row-per-conversation persistence', () => {
    let directory: string;
    let databasePath: string;
    let stores: RowTestStore[];
    let consoleWarn: sinon.SinonStub;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-conversation-rows-'));
        databasePath = path.join(directory, 'index.sqlite');
        stores = [];
        consoleWarn = sinon.stub(console, 'warn');
    });

    afterEach(() => {
        for (const store of stores) {
            store.onStop();
        }
        consoleWarn.restore();
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);
        fs.rmSync(directory, { recursive: true, force: true });
        delete process.env.QAAP_CONVERSATION_FULL_SWEEP_MS;
    });

    function openStore(): RowTestStore {
        const store = new RowTestStore(databasePath);
        stores.push(store);
        return store;
    }

    async function restoreStore(): Promise<RowTestStore> {
        const store = openStore();
        await store.restoreFromDisk();
        return store;
    }

    it('imports the legacy aggregate once into one row per conversation, keeping the legacy row byte-identical', async () => {
        // Written out of creation order on purpose: the load must restore the creation order.
        seedLegacyAggregate(databasePath, [conversation('c', 3), conversation('a', 1), conversation('b', 2)]);
        const legacyBefore = rawRows(databasePath, QAAP_CONVERSATION_LEGACY_NAMESPACE);

        const store = await restoreStore();

        expect([...store.conversations.keys()]).to.deep.equal(['a', 'b', 'c']);
        const rows = rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).map(row => row.key);
        expect(rows).to.include.members([conversationRowKey('a'), conversationRowKey('b'), conversationRowKey('c')]);
        expect(rawRows(databasePath, QAAP_CONVERSATION_LEGACY_NAMESPACE)).to.deep.equal(legacyBefore);
        expect(new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE }).hasMigration()).to.equal(true);
    });

    it('does not import the legacy aggregate again on a second start', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
        const first = await restoreStore();
        const v2 = first.getSqliteStoreV2();
        v2.applyRawBatch([], [conversationRowKey('b')]);

        const second = await restoreStore();

        expect([...second.conversations.keys()]).to.deep.equal(['a']);
    });

    describe('return from a rollback', () => {
        /** What an earlier build does: rewrites the aggregate, stamping the row now. */
        function writeLegacyAsEarlierBuild(conversations: QaapAgentConversation[]): void {
            new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE })
                .replace([[LEGACY_KEY, conversations]]);
            const database = new DatabaseSync(databasePath);
            database.prepare('UPDATE qaap_kv SET updated_at = ? WHERE namespace = ?').run(Date.now() + 1000, QAAP_CONVERSATION_LEGACY_NAMESPACE);
            database.close();
        }

        it('ignores a legacy row that was not written after the mark', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const first = await restoreStore();
            first.conversations.set('a', { ...first.conversations.peek('a')!, title: 'v2 is newer', updatedAt: 50 });
            await first.persist();
            const applyBatch = sinon.spy(new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE }), 'readValueChunk');

            const second = await restoreStore();

            expect(second.conversations.peek('a')!.title).to.equal('v2 is newer');
            expect(applyBatch.callCount).to.equal(0);
        });

        it('merges by updatedAt when the legacy row is newer than the mark, once', async () => {
            const longAgo = Date.now() - 1000;
            seedLegacyAggregate(databasePath, [
                conversation('old-in-legacy', 1, { updatedAt: longAgo }),
                conversation('newer-in-v2', 2, { updatedAt: longAgo }),
                conversation('deleted-in-v2', 3, { updatedAt: longAgo }),
            ]);
            const first = await restoreStore();
            first.conversations.set('newer-in-v2', { ...first.conversations.peek('newer-in-v2')!, title: 'v2', updatedAt: longAgo + 500 });
            first.conversations.set('only-in-v2', conversation('only-in-v2', 4));
            first.conversations.delete('deleted-in-v2');
            await first.persist();
            first.onStop();

            const after = Date.now() + 500;
            writeLegacyAsEarlierBuild([
                conversation('old-in-legacy', 1, { title: 'changed during the rollback', updatedAt: after }),
                conversation('newer-in-v2', 2, { title: 'stale', updatedAt: longAgo }),
                conversation('deleted-in-v2', 3, { updatedAt: longAgo }),
                conversation('created-during-rollback', 5, { updatedAt: after }),
            ]);

            const second = await restoreStore();

            expect(second.conversations.peek('old-in-legacy')!.title).to.equal('changed during the rollback');
            expect(second.conversations.peek('newer-in-v2')!.title).to.equal('v2');
            expect(second.conversations.has('only-in-v2'), 'kept: missing from legacy').to.equal(true);
            expect(second.conversations.has('created-during-rollback')).to.equal(true);
            expect(second.conversations.has('deleted-in-v2'), 'deleted before the rollback stays deleted').to.equal(false);
            second.onStop();

            // The merge moved the mark past the legacy row, so another start reads nothing from it.
            second.conversations.clear();
            const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
            expect(syncConversationRowsWithLegacy(legacy, rows).kind).to.equal('none');
        });

        it('detects a legacy row written by an earlier build whose clock is behind the mark', async () => {
            const longAgo = Date.now() - 60_000;
            seedLegacyAggregate(databasePath, [conversation('a', 1, { updatedAt: longAgo }), conversation('deleted-in-v2', 2, { updatedAt: longAgo })]);
            const first = await restoreStore();
            first.conversations.delete('deleted-in-v2');
            await first.persist();
            first.onStop();

            // The earlier build stamps its writes an hour in the past, before the recorded mark.
            const behind = Date.now() - 3_600_000;
            new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE }).replace([[LEGACY_KEY, [
                conversation('a', 1, { title: 'changed during the rollback', updatedAt: longAgo + 1 }),
                conversation('deleted-in-v2', 2, { updatedAt: longAgo }),
                conversation('created-during-rollback', 3, { updatedAt: behind }),
            ]]]);
            const database = new DatabaseSync(databasePath);
            database.prepare('UPDATE qaap_kv SET updated_at = ? WHERE namespace = ?').run(behind, QAAP_CONVERSATION_LEGACY_NAMESPACE);
            database.close();

            const second = await restoreStore();

            expect(second.conversations.peek('a')!.title).to.equal('changed during the rollback');
            expect(second.conversations.has('created-during-rollback'), 'new to legacy: taken whatever its clock').to.equal(true);
            expect(second.conversations.has('deleted-in-v2'), 'known to legacy and not changed: stays deleted').to.equal(false);
            second.onStop();
            const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
            expect(syncConversationRowsWithLegacy(legacy, rows).kind, 'same stamp: nothing to read').to.equal('none');
        });

        it('syncs once a database migrated before the stamp was recorded, then not again', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const first = await restoreStore();
            first.onStop();
            first.getSqliteStoreV2().applyRawBatch([], [QAAP_CONVERSATION_LEGACY_OBSERVED_ROW_KEY]);
            const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });

            expect(syncConversationRowsWithLegacy(legacy, rows).kind).to.equal('merged');
            expect(syncConversationRowsWithLegacy(legacy, rows).kind).to.equal('none');
        });

        it('does not bring back messages v2 removed when an earlier build rewrote the aggregate without touching that conversation', async () => {
            const base = Date.now() - 1000;
            seedLegacyAggregate(databasePath, [
                conversation('retried', 1, { updatedAt: base }),
                conversation('other', 2, { updatedAt: base }),
            ]);
            const first = await restoreStore();
            const retried = first.conversations.peek('retried')!;
            // A retry drops the failed turn's messages in v2.
            first.conversations.set('retried', { ...retried, messages: [], updatedAt: base + 1 });
            await first.persist();
            first.onStop();
            const legacyRaw = rawRows(databasePath, QAAP_CONVERSATION_LEGACY_NAMESPACE).find(row => row.key === LEGACY_KEY)!.value;
            const aggregate = JSON.parse(legacyRaw) as QaapAgentConversation[];
            // The earlier build changes only `other` but rewrites the whole aggregate.
            writeLegacyAsEarlierBuild([aggregate[0], { ...aggregate[1], title: 'changed during the rollback', updatedAt: Date.now() + 500 }]);

            const second = await restoreStore();

            expect(second.conversations.peek('retried')!.messages, 'unchanged legacy copy is not merged').to.deep.equal([]);
            expect(second.conversations.peek('other')!.title).to.equal('changed during the rollback');
        });

        it('keeps messages only the losing copy has, when a stale conversation was touched after the rollback', async () => {
            const base = Date.now() - 1000;
            seedLegacyAggregate(databasePath, [conversation('a', 1, { updatedAt: base })]);
            const first = await restoreStore();
            const current = first.conversations.peek('a')!;
            first.conversations.set('a', {
                ...current,
                updatedAt: base + 1,
                messages: [...current.messages, { id: 'a-only-in-v2', role: 'agent', content: 'do not lose me', createdAt: base + 1 } as QaapAgentConversation['messages'][number]],
            });
            await first.persist();
            first.onStop();

            // An earlier build started from the stale aggregate and its zombie sweep bumped updatedAt.
            writeLegacyAsEarlierBuild([conversation('a', 1, { updatedAt: Date.now() + 500, status: 'idle' })]);

            const second = await restoreStore();

            expect(second.conversations.peek('a')!.messages.map(message => message.id)).to.deep.equal(['a-u1', 'a-only-in-v2']);
        });

        it('reads back what the rollback script wrote, as an earlier build would, and returns unchanged', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
            const first = await restoreStore();
            first.conversations.set('created-after-migration', conversation('created-after-migration', 3));
            first.worktreeOrdinalHighWater!.set('repo', 7);
            await first.persist();
            first.onStop();
            QaapSqliteConnectionRegistry.shared.closeUnder(directory);

            const run = spawnSync(process.execPath, [rollbackScript, '--yes', databasePath], { encoding: 'utf8' });
            expect(run.status, run.stderr).to.equal(0);
            expect(fs.readdirSync(directory).filter(name => name.startsWith('index.sqlite.pre-rollback-')), 'backup made first').to.have.length(1);

            const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            const aggregate = legacy.get<QaapAgentConversation[]>(LEGACY_KEY)!;
            expect(aggregate.map(conv => conv.id)).to.deep.equal(['a', 'b', 'created-after-migration']);
            expect(legacy.get('worktreeOrdinalHighWater')).to.deep.equal({ repo: 7 });

            const second = await restoreStore();
            expect([...second.conversations.keys()]).to.deep.equal(['a', 'b', 'created-after-migration']);
        });

        it('makes the rollback script skip a database that was never migrated', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            QaapSqliteConnectionRegistry.shared.closeUnder(directory);

            const run = spawnSync(process.execPath, [rollbackScript, '--yes', databasePath], { encoding: 'utf8' });

            expect(run.status).to.equal(0);
            expect(run.stdout).to.contain('skipped');
        });

        describe('rollback script safety', () => {
            async function migratedWithLegacyOnly(): Promise<void> {
                seedLegacyAggregate(databasePath, [conversation('a', 1)]);
                const first = await restoreStore();
                first.conversations.set('b', conversation('b', 2));
                await first.persist();
                first.onStop();
                // Only the aggregate has this one (an earlier build wrote it after the last sync).
                const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
                legacy.replace([[LEGACY_KEY, [conversation('a', 1), conversation('legacy-only', 3)]]]);
                QaapSqliteConnectionRegistry.shared.closeUnder(directory);
            }

            function legacyIds(): string[] {
                const database = new DatabaseSync(databasePath, { readOnly: true });
                try {
                    const row = database.prepare('SELECT value FROM qaap_kv WHERE namespace = ? AND key = ?').get(QAAP_CONVERSATION_LEGACY_NAMESPACE, LEGACY_KEY) as { value: string };
                    return (JSON.parse(row.value) as QaapAgentConversation[]).map(conv => conv.id);
                } finally {
                    database.close();
                }
            }

            it('only reports without --yes, and lists what only the aggregate has', async () => {
                await migratedWithLegacyOnly();

                const run = spawnSync(process.execPath, [rollbackScript, databasePath], { encoding: 'utf8' });

                expect(run.status, run.stderr).to.equal(0);
                expect(run.stdout).to.contain('dry run').and.to.contain('legacy-only');
                expect(legacyIds()).to.deep.equal(['a', 'legacy-only']);
                expect(fs.readdirSync(directory).some(name => name.includes('pre-rollback'))).to.equal(false);
            });

            it('refuses while a backend has the database open, and changes nothing', async () => {
                await migratedWithLegacyOnly();
                const backend = new DatabaseSync(databasePath);
                try {
                    backend.prepare('SELECT count(*) FROM qaap_kv').get();

                    const run = spawnSync(process.execPath, [rollbackScript, '--yes', databasePath], { encoding: 'utf8' });

                    expect(run.status).to.equal(4);
                    expect(run.stderr).to.contain('Stop the backend');
                } finally {
                    backend.close();
                }
                expect(legacyIds()).to.deep.equal(['a', 'legacy-only']);
                expect(fs.readdirSync(directory).some(name => name.includes('pre-rollback'))).to.equal(false);
            });

            it('drops what only the aggregate has by default, keeping it in the backup', async () => {
                await migratedWithLegacyOnly();

                const run = spawnSync(process.execPath, [rollbackScript, '--yes', databasePath], { encoding: 'utf8' });

                expect(run.status, run.stderr).to.equal(0);
                expect(legacyIds()).to.deep.equal(['a', 'b']);
                const backup = fs.readdirSync(directory).find(name => name.startsWith('index.sqlite.pre-rollback-'))!;
                const copy = new DatabaseSync(path.join(directory, backup), { readOnly: true });
                try {
                    const row = copy.prepare('SELECT value FROM qaap_kv WHERE namespace = ? AND key = ?').get(QAAP_CONVERSATION_LEGACY_NAMESPACE, LEGACY_KEY) as { value: string };
                    expect((JSON.parse(row.value) as QaapAgentConversation[]).map(conv => conv.id)).to.deep.equal(['a', 'legacy-only']);
                } finally {
                    copy.close();
                }
            });

            it('keeps what only the aggregate has with --import-missing', async () => {
                await migratedWithLegacyOnly();

                const run = spawnSync(process.execPath, [rollbackScript, '--yes', '--import-missing', databasePath], { encoding: 'utf8' });

                expect(run.status, run.stderr).to.equal(0);
                expect(legacyIds()).to.deep.equal(['a', 'b', 'legacy-only']);
            });
        });
    });

    describe('failed restore', () => {
        it('turns a corrupt legacy row into a visible failure, with writes off and creates refused', async () => {
            const store = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            store.applyRawBatch([[LEGACY_KEY, '[{"id":"a"},{"id":']], []);
            const consoleError = sinon.stub(console, 'error');
            try {
                const failed = await restoreStore();

                expect(consoleError.args.flat().join(' ')).to.contain('restore failed');
                expect(failed.storageHealth().failure).to.contain('ended early');
                expect(failed.conversationRowsReady).to.equal(false);
                expect(() => failed.create({ cwd: '/tmp/project' } as Parameters<QaapAgentConversationStore['create']>[0]))
                    .to.throw('Conversation storage is unavailable');

                failed.conversations.set('early', conversation('early', 1));
                await failed.persist();
                expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE)).to.deep.equal([]);
                expect(new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE }).hasMigration()).to.equal(false);
            } finally {
                consoleError.restore();
            }
        });

        it('refuses the first import when the volume has no room, changing nothing', () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });

            expect(() => syncConversationRowsWithLegacy(legacy, rows, { freeBytes: () => 1024 })).to.throw(QaapConversationMigrationError, 'Not enough free disk space');

            expect(rows.hasMigration()).to.equal(false);
            expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE)).to.deep.equal([]);
        });

        it('reports the write failure on the health state until a write succeeds', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const store = await restoreStore();

            store.conversations.set('a', { ...store.conversations.peek('a')!, title: 5n as unknown as string });
            await store.persist();
            expect(store.storageHealth().writeFailed).to.equal(true);

            store.conversations.set('a', { ...store.conversations.peek('a')!, title: 'fixed' });
            await store.persist();
            expect(store.storageHealth().writeFailed).to.equal(false);
        });
    });

    describe('owners', () => {
        it('keeps the owner on each row and the owner filter over the same file', async () => {
            seedLegacyAggregate(databasePath, [
                conversation('of-alice', 1, { ownerLogin: 'alice' }),
                conversation('of-bob', 2, { ownerLogin: 'bob' }),
            ]);

            const store = await restoreStore();

            expect(store.getForOwnerForTest('alice')).to.deep.equal(['of-alice']);
            expect(store.getForOwnerForTest('bob')).to.deep.equal(['of-bob']);
            expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).filter(row => row.key.startsWith('conv:')).map(row => JSON.parse(row.value).ownerLogin)).to.have.members(['alice', 'bob']);
        });

        it('resolves a duplicated id like the map of the aggregate did: the last entry wins', async () => {
            seedLegacyAggregate(databasePath, [conversation('same', 1, { ownerLogin: 'alice' }), conversation('same', 2, { ownerLogin: 'bob' })]);

            const store = await restoreStore();

            expect(store.conversations.peek('same')!.ownerLogin).to.equal('bob');
            expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).filter(row => row.key.startsWith('conv:'))).to.have.length(1);
        });
    });

    it('writes only the conversation that changed (one upsert, no deletes)', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
        const store = await restoreStore();
        await store.persist();
        const applyBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');

        store.conversations.set('a', { ...store.conversations.get('a')!, title: 'changed' });
        await store.persist();

        expect(applyBatch.callCount).to.equal(1);
        expect(applyBatch.firstCall.args[0].map(([key]) => key)).to.deep.equal([conversationRowKey('a')]);
        expect(applyBatch.firstCall.args[1]).to.deep.equal([]);
    });

    it('writes nothing for a set that does not change the row', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1)]);
        const store = await restoreStore();
        await store.persist();
        const applyBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');

        const same = store.conversations.get('a')!;
        store.conversations.set('a', same);
        store.conversations.set('a', same);
        await store.persist();

        expect(applyBatch.callCount).to.equal(0);
        expect(store.conversations.hasPendingWrites()).to.equal(false);
    });

    it('writes a deletion as one delete and no upsert', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
        const store = await restoreStore();
        await store.persist();
        const applyBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');

        store.conversations.delete('a');
        await store.persist();

        expect(applyBatch.callCount).to.equal(1);
        expect(applyBatch.firstCall.args[0]).to.have.length(0);
        expect(applyBatch.firstCall.args[1]).to.deep.equal([conversationRowKey('a')]);
    });

    it('catches an in-place change of an object just passed to set at the next persist', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1)]);
        const store = await restoreStore();
        const next = { ...store.conversations.peek('a')!, title: 'set' };
        store.conversations.set('a', next);
        await store.persist();

        (next as { title: string }).title = 'changed after set';
        await store.persist();

        const row = rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).find(entry => entry.key === conversationRowKey('a'))!;
        expect(JSON.parse(row.value).title).to.equal('changed after set');
    });

    it('writes nothing when nothing changed', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1)]);
        const store = await restoreStore();
        await store.persist();
        const applyBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');

        await store.persist();

        expect(applyBatch.callCount).to.equal(0);
    });

    it('keeps the change pending when the batch fails, and the next persist writes it', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1)]);
        const store = await restoreStore();
        await store.persist();
        const v2 = store.getSqliteStoreV2();

        // BigInt cannot be serialized, so the whole batch rolls back.
        store.conversations.set('a', { ...store.conversations.get('a')!, title: 5n as unknown as string });
        await store.persist();

        expect(store.conversations.pendingWrites().upserts.map(([id]) => id)).to.deep.equal(['a']);
        expect(v2.get<QaapAgentConversation>(conversationRowKey('a'))!.title).to.equal('Conversation a');

        store.conversations.set('a', { ...store.conversations.get('a')!, title: 'fixed' });
        await store.persist();

        expect(store.conversations.pendingWrites().upserts).to.have.length(0);
        expect(v2.get<QaapAgentConversation>(conversationRowKey('a'))!.title).to.equal('fixed');
    });

    it('round-trips through a new instance in creation order', async () => {
        const originals = [conversation('late', 30), conversation('early', 10), conversation('mid', 20)];
        seedLegacyAggregate(databasePath, originals);
        const first = await restoreStore();
        first.conversations.set('mid', { ...first.conversations.get('mid')!, title: 'renamed' });
        first.conversations.delete('late');
        await first.persist();
        first.onStop();

        const second = await restoreStore();

        expect([...second.conversations.values()]).to.deep.equal([
            first.conversations.get('early'),
            first.conversations.get('mid'),
        ]);
        expect([...second.conversations.keys()]).to.deep.equal(['early', 'mid']);
    });

    it('rewrites a conversation changed by the restore backfill', async () => {
        // A worktree conversation without an ordinal: the restore backfill assigns one.
        seedLegacyAggregate(databasePath, [conversation('w', 1, { cwd: '/tmp/project-worktree', parallelBaseCwd: '/tmp/project', worktreeOrdinal: undefined })]);

        await restoreStore();

        const row = rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).find(entry => entry.key === conversationRowKey('w'));
        expect(row).to.not.equal(undefined);
        expect(JSON.parse(row!.value).worktreeOrdinal).to.be.a('number');
    });

    it('clears the migration only on a fresh database, and writes nothing before the restore finished', async () => {
        const store = openStore();
        const applyBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');
        store.conversations.set('early', conversation('early', 1));

        await store.persist();

        expect(applyBatch.callCount).to.equal(0);
        expect(store.conversations.pendingWrites().upserts).to.have.length(1);
    });

    it('persists the high-water mark once and only when it changes', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1)]);
        const store = await restoreStore();
        store.worktreeOrdinalHighWater!.set('repo', 2);
        await store.persist();
        const applyBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');

        await store.persist();
        expect(applyBatch.callCount).to.equal(0);

        store.worktreeOrdinalHighWater!.set('repo', 3);
        await store.persist();
        expect(applyBatch.callCount).to.equal(1);
        expect(applyBatch.firstCall.args[0].map(([key]) => key)).to.deep.equal([QAAP_CONVERSATION_HIGH_WATER_ROW_KEY]);
    });

    it('guards against in-place mutation: restored conversations are frozen and the flows still run', async () => {
        seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
        const store = openStore();
        // Freeze each conversation as it is loaded; any in-place write in the restore path throws in strict mode.
        const load = store.conversations.load.bind(store.conversations);
        store.conversations.load = (id: string, value: QaapAgentConversation, hash: string): void => load(id, deepFreeze(value), hash);

        await store.restoreFromDisk();
        store.conversations.set('a', { ...store.conversations.get('a')!, title: 'renamed' });
        await store.persist();
        await sweepConversationRows(store);
        store.onStop();

        expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE)
            .map(row => JSON.parse(row.value).title)).to.include.members(['renamed', 'Conversation b']);
    });

    describe('in-place mutation guard through a turn', () => {
        /** Freezes everything that goes into the map, so any later in-place write throws. */
        async function frozenStore(): Promise<{ store: RowTestStore; created: string[] }> {
            seedLegacyAggregate(databasePath, [conversation('a', 1, { agentId: 'shell', status: 'idle' })]);
            const store = openStore();
            const created: string[] = [];
            let nextTask = 1;
            (store as unknown as { taskRunner: unknown }).taskRunner = {
                whenRecovered: async (): Promise<void> => undefined,
                normalizeAgentId: (token: string | undefined): string | undefined => token?.trim().toLowerCase() === 'shell' ? 'shell' : undefined,
                create: (): QaapAgentTask => {
                    const id = `task-${nextTask++}`;
                    created.push(id);
                    return { id, state: 'running', agentId: 'shell' } as unknown as QaapAgentTask;
                },
                cancel: (): undefined => undefined,
                list: (): QaapAgentTask[] => [],
                get: (): undefined => undefined,
                detail: async (): Promise<{ log: string }> => ({ log: 'done' }),
                recordTaskClosingDiff: (): undefined => undefined,
                markTaskBlocked: (): undefined => undefined,
            };
            const load = store.conversations.load.bind(store.conversations);
            store.conversations.load = (id: string, value: QaapAgentConversation, hash: string): void => load(id, deepFreeze(value), hash);
            const set = store.conversations.set.bind(store.conversations);
            store.conversations.set = (id: string, value: QaapAgentConversation) => set(id, deepFreeze(value));
            await store.restoreFromDisk();
            return { store, created };
        }

        it('post then settle: no in-place write, and the settled turn is persisted', async () => {
            const { store, created } = await frozenStore();

            store.postUserMessage('a', 'hello', 'shell');
            expect(created).to.have.length(1);
            store.onTaskChanged({ type: 'completed', task: { id: created[0], state: 'completed', agentId: 'shell', exitCode: 0 } as unknown as QaapAgentTask });
            await waitFor(() => store.get('a')?.status !== 'streaming', 1500)
                .catch(error => { throw new Error(`${error.message}; logged: ${consoleWarn.args.flat().join(' ')}`); });
            await store.persist();

            const row = rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).find(entry => entry.key === conversationRowKey('a'))!;
            const stored = JSON.parse(row.value) as QaapAgentConversation;
            expect(stored.messages.some(message => message.role === 'user' && message.content === 'hello')).to.equal(true);
            expect(stored.status).to.not.equal('streaming');
            expect(consoleWarn.args.flat().join(' ')).to.not.contain('changed without set()');
        });

        it('post then cancel: no in-place write, and the cancelled turn is persisted', async () => {
            const { store, created } = await frozenStore();

            store.postUserMessage('a', 'hello', 'shell');
            expect(created).to.have.length(1);
            store.cancel('a');
            store.onTaskChanged({ type: 'cancelled', task: { id: created[0], state: 'cancelled', agentId: 'shell' } as unknown as QaapAgentTask });
            await waitFor(() => store.get('a')?.status !== 'streaming');
            await store.persist();

            const row = rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).find(entry => entry.key === conversationRowKey('a'))!;
            expect((JSON.parse(row.value) as QaapAgentConversation).status).to.not.equal('streaming');
            expect(consoleWarn.args.flat().join(' ')).to.not.contain('changed without set()');
        });
    });

    describe('full sweep, batching and shutdown', () => {
        it('saves an in-place change of an object from get() at the next persist, and logs it', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const store = await restoreStore();

            (store.conversations.get('a') as { title: string }).title = 'mutated in place';
            await store.persist();

            expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).map(row => JSON.parse(row.value).title)).to.include('mutated in place');
            expect(consoleWarn.args.flat().join(' ')).to.contain('changed without set()');
        });

        it('saves an in-place change of an object from get() at shutdown', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const store = await restoreStore();

            (store.conversations.get('a') as { title: string }).title = 'mutated in place';
            store.onStop();

            expect(rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).map(row => JSON.parse(row.value).title)).to.include('mutated in place');
        });

        it('saves an in-place change of an object from iterating the map on the sweep timer, and logs it', async () => {
            process.env.QAAP_CONVERSATION_FULL_SWEEP_MS = '5';
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const store = await restoreStore();

            (store.conversations.values().next().value as { title: string }).title = 'mutated in place';

            await waitFor(() => rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).some(row => row.key === conversationRowKey('a') && JSON.parse(row.value).title === 'mutated in place'));
            expect(consoleWarn.args.flat().join(' ')).to.contain('changed without set()');
        });

        it('reports a failed sweep on the health state, and clears it on the next good pass', async () => {
            process.env.QAAP_CONVERSATION_FULL_SWEEP_MS = '5';
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const store = await restoreStore();
            const applyRawBatch = sinon.stub(store.getSqliteStoreV2(), 'applyRawBatch').throws(new Error('disk I/O error'));
            (store.conversations.values().next().value as { title: string }).title = 'mutated in place';

            await waitFor(() => store.storageHealth().writeFailed);
            expect(consoleWarn.args.flat().join(' ')).to.contain('conversation sweep failed');

            applyRawBatch.restore();
            await waitFor(() => !store.storageHealth().writeFailed);
        });

        it('reports a failed shutdown flush on the health state', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1)]);
            const store = await restoreStore();
            store.conversations.set('a', { ...store.conversations.peek('a')!, title: 'pending' });
            sinon.stub(store.getSqliteStoreV2(), 'applyRawBatch').throws(new Error('disk I/O error'));
            const consoleError = sinon.stub(console, 'error');
            try {
                store.onStop();
            } finally {
                consoleError.restore();
            }
            expect(store.storageHealth().writeFailed).to.equal(true);
        });

        it('writes nothing on a sweep when no hash changed, and continues where the limit stopped it', async () => {
            const body = 'x'.repeat(1000);
            const conversations = Array.from({ length: 10 }, (_, index) => conversation(`c${index}`, index + 1, { title: body }));
            seedLegacyAggregate(databasePath, conversations);
            const store = await restoreStore();
            const applyRawBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');
            const stringify = sinon.spy(JSON, 'stringify');
            try {
                // About three conversations' worth per run.
                expect(await sweepConversationRows(store, 3000)).to.equal(0);
                expect(stringify.callCount).to.be.lessThan(6);
                expect(applyRawBatch.callCount).to.equal(0);
                expect(store.conversationSweepQueue.length).to.be.greaterThan(0);
                for (let run = 0; run < 5 && store.conversationSweepQueue.length > 0; run++) {
                    await sweepConversationRows(store, 3000);
                }
                expect(store.conversationSweepQueue.length).to.equal(0);
                expect(applyRawBatch.callCount).to.equal(0);
            } finally {
                stringify.restore();
            }
        });

        it('flushes pending writes synchronously on shutdown', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
            const store = await restoreStore();
            await store.persist();

            store.conversations.set('a', { ...store.conversations.get('a')!, title: 'shutdown rename' });
            store.conversations.delete('b');
            store.onStop();

            const rows = rawRows(databasePath, QAAP_CONVERSATION_ROWS_NAMESPACE).filter(row => row.key.startsWith('conv:'));
            expect(rows.map(row => row.key)).to.deep.equal([conversationRowKey('a')]);
            expect(JSON.parse(rows[0].value).title).to.equal('shutdown rename');
        });

        it('writes only the pending rows on shutdown, without serializing the others', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2), conversation('c', 3)]);
            const store = await restoreStore();
            await store.persist();
            store.conversations.set('a', { ...store.conversations.peek('a')!, title: 'pending' });
            const stringify = sinon.spy(JSON, 'stringify');
            const applyRawBatch = sinon.spy(store.getSqliteStoreV2(), 'applyRawBatch');
            try {
                store.onStop();
                expect(applyRawBatch.callCount).to.equal(1);
                expect(applyRawBatch.firstCall.args[0].map(([key]) => key)).to.deep.equal([conversationRowKey('a')]);
                expect(stringify.args.filter(([value]) => (value as QaapAgentConversation | undefined)?.id !== undefined && (value as QaapAgentConversation).id !== 'a')).to.have.length(0);
            } finally {
                stringify.restore();
            }
        });

        it('stops the shutdown flush at the budget, newest first, and says how many rows it left', async () => {
            seedLegacyAggregate(databasePath, [conversation('a', 1), conversation('b', 2)]);
            const store = await restoreStore();
            await store.persist();
            store.conversations.set('a', { ...store.conversations.peek('a')!, title: 'pending', updatedAt: 10 });
            store.conversations.set('b', { ...store.conversations.peek('b')!, title: 'pending', updatedAt: 20 });
            const consoleError = sinon.stub(console, 'error');
            try {
                expect(flushConversationRowsSync(store, 0)).to.equal(2);
                expect(consoleError.args.flat().join(' ')).to.contain('2 conversation row(s) unwritten');
            } finally {
                consoleError.restore();
            }
            expect(store.conversations.hasPendingWrites()).to.equal(true);
        });

        it('resolves settings from the environment with the default as fallback', () => {
            expect(resolveQaapConversationSetting(undefined, QAAP_CONVERSATION_FULL_SWEEP_MS)).to.equal(10 * 60 * 1000);
            expect(resolveQaapConversationSetting('0', QAAP_CONVERSATION_FULL_SWEEP_MS)).to.equal(10 * 60 * 1000);
            expect(resolveQaapConversationSetting('250', QAAP_CONVERSATION_FULL_SWEEP_MS)).to.equal(250);
        });
    });
});

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('condition not met in time');
        }
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QaapSqliteConnectionRegistry, QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QAAP_CONVERSATION_LEGACY_NAMESPACE, QAAP_CONVERSATION_ROWS_NAMESPACE, conversationRowKey, syncConversationRowsWithLegacy } from './qaap-agent-conversation-store-rows';

const STORE_MODULE = require.resolve('@theia/qaap-persistence/lib/node/qaap-sqlite-store');
const ROWS_MODULE = path.join(__dirname, 'qaap-agent-conversation-store-rows.js');
const CONVERSATIONS = 40;

/** Child preamble: both stores on the file given as the first argument. */
const OPEN_STORES = `
    const { QaapSqliteStore } = require(${JSON.stringify(STORE_MODULE)});
    const rowsModule = require(${JSON.stringify(ROWS_MODULE)});
    const databasePath = process.argv[1];
    const legacy = new QaapSqliteStore({ databasePath, namespace: rowsModule.QAAP_CONVERSATION_LEGACY_NAMESPACE });
    const rows = new QaapSqliteStore({ databasePath, namespace: rowsModule.QAAP_CONVERSATION_ROWS_NAMESPACE });
`;

function integrityCheck(databasePath: string): string {
    const database = new DatabaseSync(databasePath);
    try {
        return (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    } finally {
        database.close();
    }
}

describe('Conversation rows after a real SIGKILL', function (): void {
    this.timeout(60_000);

    let directory: string;
    let databasePath: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-rows-crash-'));
        databasePath = path.join(directory, 'index.sqlite');
    });

    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    function seedLegacy(): void {
        const conversations = Array.from({ length: CONVERSATIONS }, (_, index) => ({
            id: `c${index}`, createdAt: index + 1, updatedAt: index + 1, messages: [{ id: `m${index}`, createdAt: index + 1, text: 'x'.repeat(20_000) }],
        }));
        const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
        legacy.set('conversations', conversations);
        QaapSqliteConnectionRegistry.shared.closeUnder(directory);
    }

    for (const killAfter of [0, 1, CONVERSATIONS - 1]) {
        it(`leaves nothing behind when killed inside the import, after ${killAfter + 1} of ${CONVERSATIONS}, and the next start imports everything`, () => {
            seedLegacy();
            const child = spawnSync(process.execPath, ['-e', `${OPEN_STORES}
                rowsModule.syncConversationRowsWithLegacy(legacy, rows, {
                    onConversation: index => { if (index === ${killAfter}) { process.kill(process.pid, 'SIGKILL'); } },
                });
                console.log('survived');
            `, databasePath], { encoding: 'utf8' });

            expect(child.signal).to.equal('SIGKILL');
            expect(child.stdout).to.not.contain('survived');
            expect(integrityCheck(databasePath)).to.equal('ok');

            const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
            const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
            expect(rows.hasMigration(), 'mark of a killed import').to.equal(false);
            expect(rows.hasKeyWithPrefix('conv:'), 'rows of a killed import').to.equal(false);

            const result = syncConversationRowsWithLegacy(legacy, rows);

            expect(result.kind).to.equal('imported');
            expect(result.written).to.equal(CONVERSATIONS);
            expect(rows.hasMigration()).to.equal(true);
            expect(legacy.get<unknown[]>('conversations')).to.have.length(CONVERSATIONS);
        });
    }

    it('truncates the WAL after the import', () => {
        seedLegacy();
        const legacy = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_LEGACY_NAMESPACE });
        const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });

        const result = syncConversationRowsWithLegacy(legacy, rows);

        expect(result.walTruncated).to.equal(true);
        expect(fs.statSync(`${databasePath}-wal`).size).to.equal(0);
    });

    it('keeps every acknowledged write and an intact database when killed while writing turns', async () => {
        seedLegacy();
        const setup = spawnSync(process.execPath, ['-e', `${OPEN_STORES}
            rowsModule.syncConversationRowsWithLegacy(legacy, rows);
        `, databasePath], { encoding: 'utf8' });
        expect(setup.status, setup.stderr).to.equal(0);

        const writer = spawn(process.execPath, ['-e', `${OPEN_STORES}
            let turn = 0;
            const tick = () => {
                turn++;
                const key = rowsModule.conversationRowKey('c' + (turn % ${CONVERSATIONS}));
                rows.applyRawBatch([[key, JSON.stringify({ id: 'c' + (turn % ${CONVERSATIONS}), turn, body: 'y'.repeat(20000) })]], []);
                process.stdout.write(turn + '\\n');
                setImmediate(tick);
            };
            tick();
        `, databasePath], { stdio: ['ignore', 'pipe', 'inherit'] });

        const acknowledged = await new Promise<number>((resolve, reject) => {
            let output = '';
            writer.stdout!.on('data', chunk => {
                output += chunk;
                const lines = output.split('\n');
                if (lines.length > 60 && !writer.killed) {
                    writer.kill('SIGKILL');
                }
            });
            writer.on('error', reject);
            writer.on('close', () => {
                const complete = output.endsWith('\n') ? output.split('\n').slice(0, -1) : output.split('\n').slice(0, -1);
                resolve(Number(complete[complete.length - 1]));
            });
        });

        expect(acknowledged).to.be.greaterThan(50);
        expect(integrityCheck(databasePath)).to.equal('ok');
        const rows = new QaapSqliteStore({ databasePath, namespace: QAAP_CONVERSATION_ROWS_NAMESPACE });
        // Each of the last turns touched a different row: all must be there, at that turn or a later one.
        for (let turn = Math.max(1, acknowledged - CONVERSATIONS + 1); turn <= acknowledged; turn++) {
            const row = rows.get<{ turn: number }>(conversationRowKey(`c${turn % CONVERSATIONS}`));
            expect(row?.turn, `turn ${turn}`).to.be.at.least(turn);
        }
    });
});

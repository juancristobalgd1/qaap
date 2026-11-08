// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// All fixtures are synthetic and written to a temporary directory.

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { DatabaseSync } from 'node:sqlite';
import { QaapUsageScanner } from './qaap-usage-scanner';
import { QaapUsageRoots } from './qaap-usage-roots';
import type { QaapUsageLedgerEntry } from './qaap-usage-ledger';

class TestUsageScanner extends QaapUsageScanner {
    constructor(roots: QaapUsageRoots) {
        super();
        this.roots = roots;
    }
}

function entriesOf(scanner: QaapUsageScanner): QaapUsageLedgerEntry[] {
    return [...scanner.getLedger().allEntries()];
}

function claudeLine(messageId: string, timestamp: string, input: number): string {
    return JSON.stringify({
        type: 'assistant',
        sessionId: 'claude-session',
        requestId: `req-${messageId}`,
        timestamp,
        message: { id: messageId, model: 'claude-haiku-4-5', usage: { input_tokens: input, output_tokens: 1 } },
    }) + '\n';
}

describe('QaapUsageScanner', () => {

    let root: string;
    let roots: QaapUsageRoots;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-usage-scan-'));
        roots = QaapUsageRoots.resolve({}, root);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function writeFile(file: string, content: string | Buffer): void {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }

    it('reads new Claude lines and only the appended bytes on the next scan', async () => {
        const file = path.join(roots.claudeProjects, 'project', 'session.jsonl');
        const timestamp = new Date().toISOString();
        writeFile(file, claudeLine('m1', timestamp, 10) + claudeLine('m2', timestamp, 20));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        expect(scanner.hasCompletedScan()).to.be.true;
        expect(entriesOf(scanner).map(entry => entry.tokens.input).sort((a, b) => a - b)).to.deep.equal([10, 20]);

        const offsetBefore = scanner.getLedger().get(file)?.offset ?? -1;
        fs.appendFileSync(file, claudeLine('m3', timestamp, 30));
        await scanner.scan();
        expect(entriesOf(scanner)).to.have.length(3);
        expect(scanner.getLedger().get(file)?.offset).to.be.greaterThan(offsetBefore);
    });

    it('waits for a newline before consuming a partial trailing line', async () => {
        const file = path.join(roots.claudeProjects, 'partial.jsonl');
        const timestamp = new Date().toISOString();
        const full = claudeLine('p1', timestamp, 5);
        writeFile(file, full + full.slice(0, 40));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        expect(entriesOf(scanner)).to.have.length(1);
        expect(scanner.getLedger().get(file)?.offset).to.equal(Buffer.byteLength(full));

        fs.appendFileSync(file, full.slice(40));
        await scanner.scan();
        expect(entriesOf(scanner)).to.have.length(1);
        expect(scanner.getLedger().skippedRecords()).to.equal(0);
    });

    it('replaces a rewritten file instead of appending to it', async () => {
        const file = path.join(roots.claudeProjects, 'rewrite.jsonl');
        const timestamp = new Date().toISOString();
        writeFile(file, claudeLine('r1', timestamp, 7));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        writeFile(file, claudeLine('r2', timestamp, 9));
        fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
        await scanner.scan();
        expect(entriesOf(scanner).map(entry => entry.tokens.input)).to.deep.equal([9]);
    });

    it('ignores logs older than the retention window', async () => {
        const file = path.join(roots.claudeProjects, 'old.jsonl');
        writeFile(file, claudeLine('o1', new Date().toISOString(), 3));
        const old = new Date(Date.now() - 100 * 86_400_000);
        fs.utimesSync(file, old, old);
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        expect(entriesOf(scanner)).to.have.length(0);
    });

    it('counts skipped records per file', async () => {
        const file = path.join(roots.claudeProjects, 'bad.jsonl');
        writeFile(file, '{not json\n' + claudeLine('b1', new Date().toISOString(), 4));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        expect(scanner.getLedger().skippedRecords()).to.equal(1);
        expect(entriesOf(scanner)).to.have.length(1);
    });

    it('reads compressed Codex rollouts when this Node build can decompress zstd', async function (): Promise<void> {
        const compress = (zlib as unknown as { zstdCompressSync?: (buffer: Buffer) => Buffer }).zstdCompressSync;
        if (typeof compress !== 'function') {
            this.skip();
        }
        const lines = [
            { type: 'session_meta', payload: { id: 'codex-zst' } },
            { type: 'turn_context', payload: { model: 'gpt-5-codex' } },
            { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 3, reasoning_output_tokens: 0, total_tokens: 15 } } } },
        ].map(line => JSON.stringify(line)).join('\n');
        writeFile(path.join(roots.codexSessions, '2026', 'rollout-test.jsonl.zst'), compress!(Buffer.from(lines)));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        const [entry] = entriesOf(scanner);
        expect(entry).to.deep.include({ provider: 'codex', sessionId: 'codex-zst', model: 'gpt-5-codex' });
        expect(entry.tokens).to.deep.equal({ input: 10, cachedInput: 2, cacheWrite: 0, output: 3, reasoning: 0 });
    });

    it('joins OpenCode parts with their message files', async () => {
        writeFile(path.join(roots.opencodeMessages, 'ses_1', 'msg_1.json'), JSON.stringify({
            id: 'msg_1', sessionID: 'ses_1', time: { created: Date.now() }, model: { providerID: 'p', modelID: 'glm-4.7' },
        }));
        writeFile(path.join(roots.opencodeParts, 'msg_1', 'prt_1.json'), JSON.stringify({
            id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'step-finish', cost: 0.25,
            tokens: { input: 8, output: 2, reasoning: 0, cache: { read: 1, write: 0 } },
        }));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        const [entry] = entriesOf(scanner);
        expect(entry).to.deep.include({ provider: 'opencode', model: 'glm-4.7', reportedCostUsd: 0.25 });
    });

    it('reads Grok turn files', async () => {
        writeFile(path.join(roots.grokSessions, 'abc', 'usage.json'), JSON.stringify({
            sessionId: 'grok-1',
            updatedAt: new Date().toISOString(),
            turns: [{ turnNumber: 1, endedAt: new Date().toISOString(), inputTokens: 4, outputTokens: 1, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, primaryModelId: 'grok-4.7' }],
        }));
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        expect(entriesOf(scanner)[0]).to.deep.include({ provider: 'grok', model: 'grok-4.7', sessionId: 'grok-1' });
    });

    it('reads Copilot usage rows from a read-only database', async () => {
        fs.mkdirSync(path.dirname(roots.copilotDatabase), { recursive: true });
        const db = new DatabaseSync(roots.copilotDatabase);
        db.exec(`CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, input_tokens INTEGER,
            output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, created_at TEXT)`);
        db.prepare('INSERT INTO assistant_usage_events VALUES (1, ?, ?, 20, 5, 4, 0, 1, ?)').run('cp-1', 'copilot-model', '2026-03-01 10:00:00');
        db.close();
        const scanner = new TestUsageScanner(roots);
        await scanner.scan();
        expect(entriesOf(scanner)[0]).to.deep.include({ provider: 'copilot', sessionId: 'cp-1', model: 'copilot-model' });
        expect(entriesOf(scanner)[0].tokens).to.deep.equal({ input: 16, cachedInput: 4, cacheWrite: 0, output: 5, reasoning: 1 });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentRunLedger, QaapAgentRunRow, QaapAgentRunState } from './qaap-agent-run-ledger';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import * as atomic from './qaap-write-json-atomic';

class LedgerTestRunner extends QaapAgentTaskRunner {
    // Fixtures never discover providers or spawn agents.
    public override resolveAgentId(): string {
        return 'shell';
    }
    recover(): Promise<void> {
        return this.restoreFromDisk();
    }
    save(): Promise<void> {
        return this.persist();
    }
}

interface RunnerHost {
    readonly runner: LedgerTestRunner;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly queuedCreateRequests: Map<string, QaapCreateAgentTaskRequest>;
    readonly clientRequestTaskIds: Map<string, string>;
    readonly spawned: string[];
}

function run(runId: string, owner: string | undefined, state: QaapAgentRunState = 'queued'): QaapAgentRunRow {
    return { runId, owner, cwd: '/repo', state, createdAt: 1, task: { id: runId, cwd: '/repo', command: 'x', state: 'queued', createdAt: 1, ownerLogin: owner } };
}

describe('QaapAgentRunLedger', () => {
    let tmpDir: string;
    let databasePath: string;
    let legacyPath: string;
    let previousFlag: string | undefined;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-run-ledger-'));
        databasePath = path.join(tmpDir, 'tenant.sqlite');
        legacyPath = path.join(tmpDir, 'index.json');
        previousFlag = process.env[QaapAgentRunLedger.FLAG_ENV];
    });

    afterEach(() => {
        sinon.restore();
        if (previousFlag === undefined) {
            delete process.env[QaapAgentRunLedger.FLAG_ENV];
        } else {
            process.env[QaapAgentRunLedger.FLAG_ENV] = previousFlag;
        }
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function openLedger(): QaapAgentRunLedger {
        return new QaapAgentRunLedger({ databasePath, legacyPath });
    }

    function runnerHost(ledger: QaapAgentRunLedger | undefined): RunnerHost {
        const runner = Object.create(LedgerTestRunner.prototype) as LedgerTestRunner;
        const host: RunnerHost = {
            runner,
            tasks: new Map(),
            queuedCreateRequests: new Map(),
            clientRequestTaskIds: new Map(),
            spawned: [],
        };
        Object.assign(runner, {
            tasks: host.tasks,
            queuedCreateRequests: host.queuedCreateRequests,
            clientRequestTaskIds: host.clientRequestTaskIds,
            processes: new Map(),
            stoppingTaskIds: new Set(),
            agentRunLedger: ledger,
            recoveryState: 'ready',
            storageWriteFailed: false,
            persistChain: Promise.resolve(),
            maxConcurrentAgents: () => 1,
            ownerAtConcurrencyCap: () => false,
            repoAtConcurrencyCap: () => false,
            resolveAgentModelForRequest: () => undefined,
            isDirectory: () => true,
            drainQueuedTasks: () => undefined,
            spawnProcessWhenReady: async (task: QaapAgentTask) => { host.spawned.push(task.id); },
            onDidChangeTaskEmitter: { fire: () => undefined },
        });
        return host;
    }

    it('returns the stored run for a duplicate receipt, also after a restart', async () => {
        const ledger = openLedger();
        const first = ledger.commit({ receipt: { owner: 'alice', commandId: 'cmd-1', runId: 'run-1', result: { taskId: 'run-1' } }, runUpserts: [run('run-1', 'alice')] });
        const retry = ledger.commit({ receipt: { owner: 'Alice', commandId: 'cmd-1', runId: 'run-2', result: { taskId: 'run-2' } }, runUpserts: [run('run-2', 'alice')] });
        expect(first).to.deep.equal({ duplicate: false, runId: 'run-1', result: { taskId: 'run-1' } });
        expect(retry).to.deep.equal({ duplicate: true, runId: 'run-1', result: { taskId: 'run-1' } });
        expect(ledger.getRun('alice', 'run-2')).to.equal(undefined);

        process.env[QaapAgentRunLedger.FLAG_ENV] = 'on';
        const before = runnerHost(ledger);
        const request = { command: 'echo hi', cwd: '/repo', clientRequestId: 'mobile-42' };
        const created = before.runner.create(request, 'alice');
        expect(before.clientRequestTaskIds.size, 'the 512-entry cache is not used').to.equal(0);
        expect(before.runner.create(request, 'alice').id).to.equal(created.id);

        // Restart: a fresh runner restores from the same database and gets the same id back.
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        const after = runnerHost(openLedger());
        await after.runner.recover();
        const restored = after.tasks.size;
        const retried = after.runner.create(request, 'alice');
        expect(retried.id).to.equal(created.id);
        expect(after.tasks.size).to.equal(restored);
        expect(after.runner.create(request, 'bob').id, 'receipts are per owner').to.not.equal(created.id);
    });

    it('rolls back the whole commit when a step fails midway: no run, receipt or outbox row', () => {
        const ledger = openLedger();
        expect(() => ledger.commit({
            receipt: { owner: 'alice', commandId: 'cmd-1', runId: 'run-1' },
            runUpserts: [run('run-1', 'alice')],
            effects: [
                { effectId: 'turn.start:run-1', runId: 'run-1', owner: 'alice', kind: 'turn.start' },
                { effectId: 'turn.start:ghost', runId: 'ghost', owner: 'alice', kind: 'turn.start' },
            ],
        })).to.throw(/does not exist/);
        expect(ledger.getRun('alice', 'run-1')).to.equal(undefined);
        expect(ledger.listEffects('alice')).to.deep.equal([]);
        expect(ledger.findReceipt('alice', 'cmd-1')).to.equal(undefined);

        expect(() => ledger.commit({
            runUpserts: [run('run-2', 'alice'), run('run-3', 'alice', 'bogus' as unknown as QaapAgentRunState)],
        })).to.throw();
        expect(ledger.listRuns('alice')).to.deep.equal([]);

        // A receipt whose run never lands fails at COMMIT (deferred foreign key), not silently.
        expect(() => ledger.commit({ receipt: { owner: 'alice', commandId: 'cmd-2', runId: 'missing' } })).to.throw();
        expect(ledger.findReceipt('alice', 'cmd-2')).to.equal(undefined);

        const ok = ledger.commit({
            runUpserts: [run('run-4', 'alice')],
            effects: [{ effectId: 'turn.start:run-4', runId: 'run-4', owner: 'alice', kind: 'turn.start', payload: { runId: 'run-4' } }],
        });
        expect(ok.duplicate).to.equal(false);
        ledger.commit({ effects: [{ effectId: 'turn.start:run-4', runId: 'run-4', owner: 'alice', kind: 'turn.start' }] });
        expect(ledger.listEffects('alice', 'run-4').map(effect => [effect.effectId, effect.status])).to.deep.equal([['turn.start:run-4', 'pending']]);
        ledger.commit({ cancelEffectsFor: [{ owner: 'alice', runId: 'run-4' }] });
        expect(ledger.listEffects('alice', 'run-4')[0].status).to.equal('cancelled');
    });

    it('imports index.json once with queued and running tasks and keeps the file', async () => {
        const queuedRequest = { command: 'echo queued', cwd: '/repo' };
        const index = {
            version: 2,
            tasks: [
                { id: 'running-1', cwd: '/repo', command: 'long', state: 'running', createdAt: 1, ownerLogin: 'alice', clientRequestId: 'c-run' },
                { id: 'queued-1', cwd: '/repo', command: 'echo queued', state: 'queued', createdAt: 2, queuePosition: 1, ownerLogin: 'alice' },
                { id: 'done-1', cwd: '/repo', command: 'ok', state: 'completed', createdAt: 0, finishedAt: 3, ownerLogin: 'bob' },
            ],
            queuedRequests: { 'queued-1': queuedRequest },
        };
        // Windows checkouts and editors may leave a BOM and CRLF line endings.
        const raw = '﻿' + JSON.stringify(index, undefined, 2).replace(/\n/g, '\r\n');
        fs.writeFileSync(legacyPath, raw);
        process.env[QaapAgentRunLedger.FLAG_ENV] = 'on';
        const ledger = openLedger();
        const host = runnerHost(ledger);
        await host.runner.recover();

        expect(host.runner.storageHealth().ready).to.equal(true);
        expect(host.tasks.get('queued-1')?.state).to.equal('queued');
        expect(host.queuedCreateRequests.get('queued-1')).to.deep.equal(queuedRequest);
        expect(host.tasks.get('running-1')?.state, 'a lost process is never resumed as running').to.equal('interrupted');
        expect(host.tasks.get('done-1')?.state).to.equal('completed');
        expect(ledger.getRun('alice', 'queued-1')).to.include({ state: 'queued', queuePosition: 1 });
        expect(ledger.getRun('alice', 'running-1')?.state).to.equal('interrupted');
        expect(ledger.getRun('bob', 'done-1')?.state).to.equal('succeeded');
        expect(ledger.findReceipt('alice', 'c-run')?.runId).to.equal('running-1');
        expect(fs.readFileSync(legacyPath, 'utf8'), 'the legacy file is kept for rollback').to.equal(raw);
        expect(ledger.isLegacyImported()).to.equal(true);

        // Later edits to index.json are never re-imported, and persist() no longer rewrites it.
        fs.writeFileSync(legacyPath, JSON.stringify({ version: 2, tasks: [{ id: 'late', cwd: '/repo', state: 'queued', createdAt: 9 }], queuedRequests: {} }));
        const write = sinon.spy(atomic, 'writeJsonAtomic');
        const again = runnerHost(ledger);
        await again.runner.recover();
        await again.runner.save();
        expect(again.tasks.has('late')).to.equal(false);
        expect(again.tasks.size).to.equal(3);
        expect(write.called).to.equal(false);
    });

    it('never shows or modifies one owner\'s rows to another owner', () => {
        const ledger = openLedger();
        ledger.commit({
            receipt: { owner: 'alice', commandId: 'shared-cmd', runId: 'alice-run' },
            runUpserts: [run('alice-run', 'alice', 'running')],
            effects: [{ effectId: 'turn.start:alice-run', runId: 'alice-run', owner: 'alice', kind: 'turn.start' }],
        });
        expect(ledger.listRuns('bob')).to.deep.equal([]);
        expect(ledger.getRun('bob', 'alice-run')).to.equal(undefined);
        expect(ledger.findReceipt('bob', 'shared-cmd')).to.equal(undefined);
        expect(ledger.listEffects('bob')).to.deep.equal([]);

        // Same client command id from another owner is a different command.
        const bob = ledger.commit({ receipt: { owner: 'bob', commandId: 'shared-cmd', runId: 'bob-run' }, runUpserts: [run('bob-run', 'bob')] });
        expect(bob).to.include({ duplicate: false, runId: 'bob-run' });
        expect(ledger.listRuns('bob').map(row => row.runId)).to.deep.equal(['bob-run']);

        expect(() => ledger.commit({ runUpserts: [run('alice-run', 'bob', 'cancelled')] })).to.throw(/another owner/);
        expect(() => ledger.commit({ effects: [{ effectId: 'evil', runId: 'alice-run', owner: 'bob', kind: 'turn.start' }] })).to.throw();
        ledger.commit({ cancelEffectsFor: [{ owner: 'bob', runId: 'alice-run' }], runDeletes: [{ owner: 'bob', runId: 'alice-run' }] });
        expect(ledger.getRun('alice', 'alice-run')?.state).to.equal('running');
        expect(ledger.listEffects('alice').map(effect => effect.status)).to.deep.equal(['pending']);
        expect(ledger.listRuns('alice').map(row => row.runId)).to.deep.equal(['alice-run']);
    });

    it('with the flag off keeps the index.json path and never touches the ledger', async () => {
        delete process.env[QaapAgentRunLedger.FLAG_ENV];
        expect(QaapAgentRunLedger.isEnabled()).to.equal(false);
        const ledger = openLedger();
        const commit = sinon.spy(QaapAgentRunLedger.prototype, 'commit');
        const importLegacy = sinon.spy(QaapAgentRunLedger.prototype, 'importLegacy');
        const findReceipt = sinon.spy(QaapAgentRunLedger.prototype, 'findReceipt');
        const read = sinon.stub(fsp, 'readFile').resolves(JSON.stringify({
            version: 2,
            tasks: [{ id: 'old', cwd: '/repo', command: 'x', state: 'running', createdAt: 1 }],
            queuedRequests: {},
        }));
        sinon.stub(fsp, 'mkdir').resolves();
        sinon.stub(fsp, 'chmod').resolves();
        const write = sinon.stub(atomic, 'writeJsonAtomic').resolves();
        // Even a ledger left on the runner is dropped while the flag is off.
        const host = runnerHost(ledger);
        await host.runner.recover();
        expect(read.called).to.equal(true);
        expect(host.runner.agentRunLedger).to.equal(undefined);
        expect(host.tasks.get('old')?.state).to.equal('interrupted');

        const request = { command: 'echo hi', cwd: '/repo', clientRequestId: 'c-1' };
        const created = host.runner.create(request, 'alice');
        expect(host.runner.create(request, 'alice').id).to.equal(created.id);
        expect(host.clientRequestTaskIds.get('alice:c-1')).to.equal(created.id);
        await host.runner.save();
        expect(write.called).to.equal(true);
        expect(commit.called || importLegacy.called || findReceipt.called).to.equal(false);
        expect(ledger.listRunsForRecovery()).to.deep.equal([]);
    });
});

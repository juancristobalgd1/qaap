// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentEffect, QaapAgentRunLedger, QaapAgentRunRow, QaapAgentRunState } from './qaap-agent-run-ledger';
import { QaapAgentRunOutbox, QaapAgentTurnContinuationRequest } from './qaap-agent-run-outbox';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { holdQueueAfterFailureExtracted } from './qaap-agent-task-runner-ledger';

class OutboxTestRunner extends QaapAgentTaskRunner {
    // Fixtures never discover providers or spawn agents.
    public override resolveAgentId(): string {
        return 'codex';
    }
    recover(): Promise<void> {
        return this.restoreFromDisk();
    }
}

interface RunnerHost {
    readonly runner: OutboxTestRunner;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly spawned: string[];
}

const POLICY = { enabled: true, maxResumes: 2 };
/** A fixed clock after every insert (effects become available at their insert time). */
const NOW = Date.now() + 60_000;

function run(runId: string, owner: string | undefined, state: QaapAgentRunState, extra: Partial<QaapAgentRunRow> = {}): QaapAgentRunRow {
    const taskState = state === 'succeeded' ? 'completed' : state === 'starting' ? 'running' : state;
    return {
        runId, owner, cwd: '/repo', state, createdAt: 1, ...extra,
        task: { id: runId, cwd: '/repo', command: 'x', state: taskState, createdAt: 1, ownerLogin: owner },
    };
}

function effect(effectId: string, runId: string, owner: string | undefined, kind: string, threadKey?: string): QaapAgentEffect {
    return { effectId, runId, owner, kind, ...(threadKey ? { threadKey } : {}) };
}

describe('QaapAgentRunOutbox', () => {
    let tmpDir: string;
    let databasePath: string;
    let previousFlag: string | undefined;
    const outboxes: QaapAgentRunOutbox[] = [];
    const registries: QaapSqliteConnectionRegistry[] = [];

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-run-outbox-'));
        databasePath = path.join(tmpDir, 'tenant.sqlite');
        previousFlag = process.env[QaapAgentRunLedger.FLAG_ENV];
    });

    afterEach(() => {
        sinon.restore();
        outboxes.splice(0).forEach(outbox => outbox.stop());
        if (previousFlag === undefined) {
            delete process.env[QaapAgentRunLedger.FLAG_ENV];
        } else {
            process.env[QaapAgentRunLedger.FLAG_ENV] = previousFlag;
        }
        registries.splice(0).forEach(registry => registry.closeUnder(tmpDir));
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /** A ledger with its own connection registry: a separate backend process on the same file. */
    function openLedger(): QaapAgentRunLedger {
        const registry = new QaapSqliteConnectionRegistry();
        registries.push(registry);
        return new QaapAgentRunLedger({ databasePath, legacyPath: path.join(tmpDir, 'index.json'), registry });
    }

    function outboxFor(ledger: QaapAgentRunLedger, leaseOwner: string, now: () => number = () => NOW): QaapAgentRunOutbox {
        const outbox = new QaapAgentRunOutbox({ ledger, leaseOwner, now });
        outboxes.push(outbox);
        return outbox;
    }

    function runnerHost(ledger: QaapAgentRunLedger | undefined): RunnerHost {
        const runner = Object.create(OutboxTestRunner.prototype) as OutboxTestRunner;
        const host: RunnerHost = { runner, tasks: new Map(), spawned: [] };
        Object.assign(runner, {
            tasks: host.tasks,
            queuedCreateRequests: new Map(),
            clientRequestTaskIds: new Map(),
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
        outboxes.push({ stop: () => runner.agentRunOutbox?.stop() } as QaapAgentRunOutbox);
        return host;
    }

    it('claims each effect exactly once across two backend processes on the same database', async () => {
        const seed = openLedger();
        const runs = ['r1', 'r2', 'r3'].map(id => run(id, 'alice', 'running'));
        seed.commit({ runUpserts: runs });
        const effects = runs.flatMap(row => [0, 1].map(n => effect(`${row.runId}:${n}`, row.runId, 'alice', 'checkpoint.capture')));
        seed.commit({ effects });

        const first = openLedger();
        const second = openLedger();
        const claimedBy = new Map<string, string>();
        for (;;) {
            const a = first.claimNextEffect('boot-a', NOW, ['checkpoint.capture']);
            const b = second.claimNextEffect('boot-b', NOW, ['checkpoint.capture']);
            if (!a && !b) {
                break;
            }
            for (const [claim, lease] of [[a, 'boot-a'], [b, 'boot-b']] as const) {
                if (claim) {
                    expect(claimedBy.has(claim.effectId), `${claim.effectId} claimed twice`).to.equal(false);
                    claimedBy.set(claim.effectId, lease);
                }
            }
        }
        // Per-thread FIFO: one running effect per run (the default thread), the oldest of each.
        expect([...claimedBy.keys()].sort()).to.deep.equal(['r1:0', 'r2:0', 'r3:0']);
        expect(new Set(claimedBy.values()).size).to.equal(2);
        // A lease holder cannot settle the other process's claim.
        const [stolenId] = [...claimedBy.entries()].find(([, lease]) => lease === 'boot-a')!;
        expect(second.settleEffect(stolenId, 'boot-b', { status: 'succeeded' })).to.equal(false);

        // Two live workers draining at once still run every effect once.
        const fresh = openLedger();
        fresh.commit({ runUpserts: [run('w', 'alice', 'running')] });
        const many = Array.from({ length: 12 }, (_, n) => effect(`w:${n}`, 'w', 'alice', 'push.notify', `thread-${n % 4}`));
        fresh.commit({ effects: many });
        const handled: string[] = [];
        const handler = async (claimed: QaapAgentEffect): Promise<void> => {
            await new Promise(resolve => setImmediate(resolve));
            handled.push(claimed.effectId);
        };
        const workerA = outboxFor(first, 'boot-a');
        const workerB = outboxFor(second, 'boot-b');
        workerA.register('push.notify', handler);
        workerB.register('push.notify', handler);
        await Promise.all([workerA.drain(), workerB.drain()]);
        await Promise.all([workerA.drain(), workerB.drain()]);
        expect([...handled].sort()).to.deep.equal(many.map(item => item.effectId).sort());
        expect(fresh.listEffects('alice').filter(item => item.runId === 'w').every(item => item.status === 'succeeded')).to.equal(true);
    });

    it('runs one thread in FIFO order while other threads proceed, without sleeping', async () => {
        const ledger = openLedger();
        ledger.commit({ runUpserts: [run('r1', 'alice', 'running'), run('r2', 'alice', 'running')] });
        ledger.commit({
            effects: [
                effect('t1-first', 'r1', 'alice', 'push.notify', 'conv-1'),
                effect('t1-second', 'r2', 'alice', 'push.notify', 'conv-1'),
                effect('t2-only', 'r2', 'alice', 'push.notify', 'conv-2'),
            ],
        });
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
        const outbox = outboxFor(ledger, 'boot-1');
        outbox.register('push.notify', async claimed => {
            events.push(`start:${claimed.effectId}`);
            if (claimed.effectId === 't1-first') {
                await firstGate;
            }
            events.push(`end:${claimed.effectId}`);
        });
        const drained = outbox.drain();
        await new Promise(resolve => setImmediate(resolve));
        expect(events).to.deep.equal(['start:t1-first', 'start:t2-only', 'end:t2-only']);
        releaseFirst();
        await drained;
        expect(events.indexOf('start:t1-second')).to.be.greaterThan(events.indexOf('end:t1-first'));
        // Threads are scoped per owner: bob's `conv-1` is never blocked by alice's.
        ledger.commit({ runUpserts: [run('b1', 'bob', 'running')] });
        ledger.commit({ effects: [effect('a-block', 'r1', 'alice', 'checkpoint.capture', 'conv-1'), effect('b-free', 'b1', 'bob', 'push.notify', 'conv-1')] });
        expect(ledger.claimNextEffect('boot-1', NOW, ['push.notify', 'checkpoint.capture'])?.effectId).to.equal('a-block');
        expect(ledger.claimNextEffect('boot-1', NOW, ['push.notify', 'checkpoint.capture'])?.effectId).to.equal('b-free');
    });

    it('retries a failing safe effect with capped exponential backoff and gives up after 5 attempts', async () => {
        const ledger = openLedger();
        ledger.commit({ runUpserts: [run('r1', 'alice', 'running')] });
        ledger.commit({ effects: [effect('flaky', 'r1', 'alice', 'push.notify')] });
        let now = NOW;
        const outbox = outboxFor(ledger, 'boot-1', () => now);
        let calls = 0;
        outbox.register('push.notify', async () => {
            calls++;
            throw new Error(`boom ${calls}`);
        });
        expect([1, 2, 3, 4, 5, 6, 10].map(QaapAgentRunOutbox.backoffMs)).to.deep.equal([100, 200, 400, 800, 1600, 3200, 30_000]);
        for (let attempt = 1; attempt <= 5; attempt++) {
            await outbox.drain();
            expect(calls).to.equal(attempt);
            // Not due yet: drain returns without running it again.
            await outbox.drain();
            expect(calls).to.equal(attempt);
            now += QaapAgentRunOutbox.backoffMs(attempt);
        }
        await outbox.drain();
        const [settled] = ledger.listEffects('alice');
        expect(calls).to.equal(5);
        expect(settled.status).to.equal('failed');
        expect(settled.attemptCount).to.equal(5);
        expect(settled.lastError).to.equal('boom 5');
    });

    it('reconciles after a kill: process effects cancelled, safe effects requeued, one continuation per lost run', () => {
        const before = openLedger();
        before.commit({
            runUpserts: [
                run('lost', 'alice', 'running', { conversationId: 'conv-1', continuable: true }),
                run('waiting', 'alice', 'queued', { queuePosition: 1 }),
                run('bob-run', 'bob', 'queued', { queuePosition: 1 }),
            ],
        });
        before.commit({
            effects: [
                effect(QaapAgentRunOutbox.turnStartEffectId('lost'), 'lost', 'alice', QaapAgentRunOutbox.TURN_START),
                effect('ckpt', 'lost', 'alice', QaapAgentRunOutbox.CHECKPOINT_CAPTURE),
            ],
        });
        expect(before.claimNextEffect('dead-boot', NOW, [QaapAgentRunOutbox.TURN_START])?.effectId).to.equal('turn-start:lost');
        expect(before.claimNextEffect('dead-boot', NOW, [QaapAgentRunOutbox.CHECKPOINT_CAPTURE])).to.equal(undefined);
        // A different thread key lets the checkpoint run alongside the start (same run otherwise blocks).
        before.commit({ effects: [{ ...effect('ckpt-2', 'lost', 'alice', QaapAgentRunOutbox.CHECKPOINT_CAPTURE), threadKey: 'checkpoints' }] });
        expect(before.claimNextEffect('dead-boot', NOW, [QaapAgentRunOutbox.CHECKPOINT_CAPTURE])?.effectId).to.equal('ckpt-2');
        // kill -9: the connection simply goes away.
        registries.splice(0).forEach(registry => registry.closeUnder(tmpDir));

        const after = openLedger();
        const result = QaapAgentRunOutbox.reconcileAfterProcessLoss(after, POLICY, 2_000);
        expect(result.cancelled).to.include('turn-start:lost');
        expect(result.requeued).to.deep.equal(['ckpt-2']);
        expect(result.interrupted.map(row => row.runId)).to.deep.equal(['lost']);
        expect(result.continuations.map(item => item.effectId)).to.deep.equal(['restart-continuation:lost']);
        expect(result.continuations[0].threadKey).to.equal('conv-1');
        expect(result.heldOwners).to.deep.equal(['alice']);

        const lost = after.getRun('alice', 'lost')!;
        expect(lost.state).to.equal('interrupted');
        expect((lost.task as QaapAgentTask).state).to.equal('interrupted');
        expect(after.getRun('alice', 'waiting')?.queueHeld).to.equal(true);
        expect((after.getRun('alice', 'waiting')?.task as QaapAgentTask).queueHeld).to.equal(true);
        expect(after.getRun('bob', 'bob-run')?.queueHeld, 'other owners keep their queue').to.equal(false);
        // The dead process can no longer settle what reconciliation moved on.
        expect(after.settleEffect('turn-start:lost', 'dead-boot', { status: 'succeeded' })).to.equal(false);
        const byId = new Map(after.listEffects('alice').map(item => [item.effectId, item]));
        expect(byId.get('turn-start:lost')?.status).to.equal('cancelled');
        expect(byId.get('ckpt')?.status).to.equal('pending');
        expect(byId.get('ckpt-2')?.status).to.equal('pending');
        expect(byId.get('restart-continuation:lost')?.status).to.equal('pending');
        expect(byId.get('restart-continuation:lost')?.payload).to.deep.equal({ version: 1, reason: 'restart' });
    });

    it('enqueues the restart continuation once, even across two restarts', () => {
        const ledger = openLedger();
        ledger.commit({ runUpserts: [run('lost', 'alice', 'running', { continuable: true })] });
        const first = QaapAgentRunOutbox.reconcileAfterProcessLoss(ledger, POLICY, 2_000);
        expect(first.continuations).to.have.length(1);
        // The continuation's own run is still not started when the backend restarts again.
        ledger.commit({ runUpserts: [{ ...ledger.getRun('alice', 'lost')!, state: 'running' }] });
        const second = QaapAgentRunOutbox.reconcileAfterProcessLoss(ledger, POLICY, 3_000);
        expect(second.interrupted.map(row => row.runId)).to.deep.equal(['lost']);
        expect(second.continuations).to.deep.equal([]);
        expect(ledger.listEffects('alice').filter(item => item.kind === QaapAgentRunOutbox.TURN_CONTINUE)).to.have.length(1);
        expect(QaapAgentRunOutbox.reconcileAfterProcessLoss(ledger, POLICY, 4_000).interrupted).to.deep.equal([]);
    });

    it('never continues a run that waits on a human, a delegated child or a spent budget', () => {
        const ledger = openLedger();
        ledger.commit({
            runUpserts: [
                run('approval', 'alice', 'running', { continuable: false }),
                run('unknown', 'alice', 'running'),
                run('parent', 'alice', 'succeeded', { continuable: true }),
                run('child', 'alice', 'running', { continuable: true, parentRunId: 'parent' }),
                run('spent', 'alice', 'running', { continuable: true, resumeCount: 2 }),
                run('ok', 'bob', 'starting', { continuable: true, resumeCount: 1 }),
            ],
        });
        const result = QaapAgentRunOutbox.reconcileAfterProcessLoss(ledger, POLICY, 2_000);
        expect(result.interrupted.map(row => row.runId).sort()).to.deep.equal(['approval', 'child', 'ok', 'spent', 'unknown']);
        expect(result.continuations.map(item => `${item.owner}:${item.runId}`)).to.deep.equal(['bob:ok']);
        expect(QaapAgentRunOutbox.restartContinuation(run('x', 'a', 'interrupted', { continuable: true }), { enabled: false, maxResumes: 2 })).to.equal(undefined);
        // resume_count never goes down, whatever a later snapshot says.
        ledger.commit({ runUpserts: [{ ...run('spent', 'alice', 'interrupted'), resumeCount: 0 }] });
        expect(ledger.getRun('alice', 'spent')?.resumeCount).to.equal(2);
    });

    it('starts a created turn through a durable turn.start intent that carries no prompt, env or argv', async () => {
        process.env[QaapAgentRunLedger.FLAG_ENV] = 'on';
        const ledger = openLedger();
        const host = runnerHost(ledger);
        await host.runner.recover();
        expect(host.runner.isAgentRunLedgerActive()).to.equal(true);
        const request: QaapCreateAgentTaskRequest = { prompt: 'SECRET_PROMPT do it', cwd: '/repo', agent: 'codex', clientRequestId: 'c-1' };
        const task = host.runner.create(request, 'alice');
        expect(host.spawned, 'create no longer spawns directly').to.deep.equal([]);
        const [start] = ledger.listEffects('alice');
        expect(start.effectId).to.equal(`turn-start:${task.id}`);
        expect(start.kind).to.equal(QaapAgentRunOutbox.TURN_START);
        expect(JSON.stringify(start)).to.not.contain('SECRET_PROMPT');
        expect(start.payload).to.deep.equal({ version: 1 });
        await host.runner.drainAgentRunOutbox();
        expect(host.spawned).to.deep.equal([task.id]);
        expect(ledger.listEffects('alice')[0].status).to.equal('succeeded');
        // A retried POST after the start is the same task and never a second start.
        expect(host.runner.create(request, 'alice').id).to.equal(task.id);
        await host.runner.drainAgentRunOutbox();
        expect(host.spawned).to.deep.equal([task.id]);
        // An autonomous agent turn is recorded as continuable.
        expect(ledger.getRun('alice', task.id)?.continuable).to.equal(true);
    });

    it('after a restart continues the lost turn once, free of charge, and releases the held queue', async () => {
        process.env[QaapAgentRunLedger.FLAG_ENV] = 'on';
        const seed = openLedger();
        seed.commit({
            runUpserts: [
                run('lost', 'alice', 'running', { conversationId: 'conv-1', continuable: true }),
                run('next', 'alice', 'queued', { queuePosition: 1, request: { prompt: 'next', cwd: '/repo' } }),
            ],
        });
        const ledger = openLedger();
        const host = runnerHost(ledger);
        await host.runner.recover();
        expect(host.tasks.get('lost')?.state).to.equal('interrupted');
        expect(host.tasks.get('next')?.queueHeld).to.equal(true);

        const requests: QaapAgentTurnContinuationRequest[] = [];
        let continuation: QaapAgentTask | undefined;
        host.runner.setTurnContinuationHandler(async request => {
            requests.push(request);
            // What the conversation store does: re-create the turn, marked as this continuation.
            continuation = host.runner.create({ prompt: 'continue', cwd: '/repo', agent: 'codex', restartContinuationOf: 'forged' } as QaapCreateAgentTaskRequest,
                request.ownerLogin, { restartContinuationOf: request.runId });
            return true;
        });
        const resumeQueue = sinon.spy(host.runner, 'resumeQueue');
        await host.runner.drainAgentRunOutbox();
        expect(requests).to.deep.equal([{ runId: 'lost', ownerLogin: 'alice', conversationId: 'conv-1' }]);
        expect(continuation?.restartContinuationOf).to.equal('lost');
        expect(continuation?.resumedFromTaskId).to.equal('lost');
        expect(continuation?.restartResumeCount).to.equal(1);
        expect(host.spawned).to.deep.equal([continuation!.id]);
        expect(host.tasks.get('next')?.queueHeld).to.equal(undefined);
        expect(resumeQueue.called || host.tasks.get('next')?.queueHeld === undefined).to.equal(true);

        // Billing: the continuation spends no allowance; a normal run does.
        const debitRuntime = sinon.stub().resolves();
        Object.assign(host.runner, { billingStore: { debitRuntime, getOrCreateAccount: sinon.stub().resolves({}) }, observability: undefined });
        const startedAt = Date.now() - 5_000;
        host.tasks.set(continuation!.id, { ...host.tasks.get(continuation!.id)!, state: 'running', startedAt });
        host.runner.finishTask(continuation!.id, 'completed', 0);
        expect(debitRuntime.called, 'restart continuation is never charged').to.equal(false);

        // Outside an in-flight continuation effect, the option is ignored (no free runs on demand).
        const normal = host.runner.create({ prompt: 'x', cwd: '/repo', agent: 'codex' }, 'alice', { restartContinuationOf: 'lost' });
        expect(normal.restartContinuationOf).to.equal(undefined);

        // A second restart does not continue the same run again.
        registries.splice(0).forEach(registry => registry.closeUnder(tmpDir));
        const again = runnerHost(openLedger());
        await again.runner.recover();
        const second: QaapAgentTurnContinuationRequest[] = [];
        again.runner.setTurnContinuationHandler(async request => { second.push(request); return true; });
        await again.runner.drainAgentRunOutbox();
        expect(second.map(request => request.runId)).to.not.include('lost');
    });

    it('holds the queue after a failure and resumes only the caller\'s queue', async () => {
        process.env[QaapAgentRunLedger.FLAG_ENV] = 'on';
        const ledger = openLedger();
        const host = runnerHost(ledger);
        await host.runner.recover();
        const promoted: string[] = [];
        Object.assign(host.runner, { drainQueuedTasks: () => promoted.push('drain') });
        const failed: QaapAgentTask = { id: 'f', title: 'x', cwd: '/repo', command: 'x', state: 'failed', createdAt: 1, ownerLogin: 'alice', agentId: 'codex' };
        host.tasks.set('a-q', { id: 'a-q', title: 'x', cwd: '/repo', command: 'x', state: 'queued', createdAt: 2, ownerLogin: 'alice', agentId: 'codex' });
        host.tasks.set('b-q', { id: 'b-q', title: 'x', cwd: '/repo', command: 'x', state: 'queued', createdAt: 3, ownerLogin: 'bob', agentId: 'codex' });
        holdQueueAfterFailureExtracted(host.runner, failed);
        expect(host.tasks.get('a-q')?.queueHeld).to.equal(true);
        expect(host.tasks.get('b-q')?.queueHeld).to.equal(undefined);
        expect(host.runner.resumeQueue('bob')).to.equal(0);
        expect(host.tasks.get('a-q')?.queueHeld).to.equal(true);
        expect(host.runner.resumeQueue('Alice')).to.equal(1);
        expect(host.tasks.get('a-q')?.queueHeld).to.equal(undefined);
        expect(promoted).to.deep.equal(['drain']);
    });

    it('with the flag off starts turns directly and never builds an outbox', async () => {
        delete process.env[QaapAgentRunLedger.FLAG_ENV];
        const host = runnerHost(undefined);
        Object.assign(host.runner, { restorePersistedIndex: () => undefined, persist: async () => undefined });
        sinon.stub(fs.promises, 'readFile').rejects(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        await host.runner.recover();
        expect(host.runner.isAgentRunLedgerActive()).to.equal(false);
        expect(host.runner.agentRunOutbox).to.equal(undefined);
        const task = host.runner.create({ prompt: 'x', cwd: '/repo', agent: 'codex' }, 'alice', { restartContinuationOf: 'anything' });
        expect(host.spawned).to.deep.equal([task.id]);
        expect(task.restartContinuationOf).to.equal(undefined);
        expect(host.runner.resumeQueue('alice')).to.equal(0);
    });
});

// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import * as fsp from 'fs/promises';
import * as sinon from 'sinon';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapAgentStorageUnavailableError } from './qaap-agent-storage-unavailable-error';
import * as atomic from './qaap-write-json-atomic';

class RecoveryRunner extends QaapAgentTaskRunner {
    recover(): Promise<void> { return this.restoreFromDisk(); }
    save(): Promise<void> { return this.persist(); }
    state(): string { return this.recoveryState; }
    drain(): void { this.drainQueuedTasks(); }
}

describe('Qaap task storage recovery gate', () => {
    afterEach(() => sinon.restore());

    it('finishes orphan running tasks on restart without reporting success', async () => {
        const runner = Object.create(RecoveryRunner.prototype) as RecoveryRunner;
        const tasks = new Map();
        Object.assign(runner, { tasks, queuedCreateRequests: new Map(), persist: async () => undefined, drainQueuedTasks: () => undefined });
        sinon.stub(fsp, 'readFile').resolves(JSON.stringify({ version: 2, tasks: [{ id: 'orphan', cwd: '/repo', command: 'wait', state: 'running', createdAt: 1 }] }));
        await runner.recover();
        expect(tasks.get('orphan').state).to.equal('interrupted');
        expect(tasks.get('orphan').finishedAt).to.be.a('number');
    });

    it('reports a runtime write failure, pauses admission and recovers after a successful save', async () => {
        const runner = Object.create(RecoveryRunner.prototype) as RecoveryRunner;
        Object.assign(runner, { tasks: new Map(), queuedCreateRequests: new Map(), recoveryState: 'ready' });
        sinon.stub(fsp, 'mkdir').resolves();
        sinon.stub(fsp, 'chmod').resolves();
        const write = sinon.stub(atomic, 'writeJsonAtomic');
        write.onFirstCall().rejects(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
        write.onSecondCall().resolves();
        sinon.stub(console, 'warn');
        const count = sinon.stub(runner as unknown as { countRunningTasks(): number }, 'countRunningTasks').returns(0);
        Object.assign(runner, { maxConcurrentAgents: () => 1 });
        await runner.save();
        expect(runner.storageHealth()).to.deep.equal({ ready: false, recovery: 'ready', writeFailed: true });
        expect(() => runner.create({ cwd: '/repo', command: 'work' })).to.throw(QaapAgentStorageUnavailableError);
        runner.drain();
        expect(count.called).to.equal(false);
        expect(await runner.retryStorage()).to.deep.equal({ ready: true, recovery: 'ready', writeFailed: false });
        expect(count.called).to.equal(true);
    });

    it('blocks creation and writes after corrupt or unreadable storage', async () => {
        for (const failure of ['invalid JSON', Object.assign(new Error('Denied'), { code: 'EACCES' })]) {
            const runner = Object.create(RecoveryRunner.prototype) as RecoveryRunner;
            Object.assign(runner, { tasks: new Map(), queuedCreateRequests: new Map() });
            const read = sinon.stub(fsp, 'readFile');
            if (typeof failure === 'string') { read.resolves(failure); } else { read.rejects(failure); }
            const write = sinon.spy(fsp, 'open');
            sinon.stub(console, 'warn');
            await runner.recover();
            expect(runner.state()).to.equal('failed');
            expect(() => runner.create({ cwd: '/repo', command: 'work' })).to.throw(QaapAgentStorageUnavailableError);
            await runner.save();
            expect(write.called).to.equal(false);
            sinon.restore();
        }
    });

    it('blocks creation while disk recovery is pending and allows a first installation', async () => {
        const runner = Object.create(RecoveryRunner.prototype) as RecoveryRunner;
        let rejectRead!: (error: Error) => void;
        sinon.stub(fsp, 'readFile').returns(new Promise((_resolve, reject) => { rejectRead = reject; }));
        const recovery = runner.recover();
        expect(runner.state()).to.equal('loading');
        expect(() => runner.create({ cwd: '/repo', command: 'work' })).to.throw(QaapAgentStorageUnavailableError);
        rejectRead(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
        await recovery;
        expect(runner.state()).to.equal('ready');
    });

    it('restores valid storage before allowing persistence and queue draining', async () => {
        const runner = Object.create(RecoveryRunner.prototype) as RecoveryRunner;
        const calls: string[] = [];
        Object.assign(runner, {
            tasks: new Map(), queuedCreateRequests: new Map(),
            persist: async () => { calls.push(runner.state()); },
            drainQueuedTasks: () => { calls.push('drain'); }
        });
        sinon.stub(fsp, 'readFile').resolves(JSON.stringify({ version: 2, tasks: [], queuedRequests: {} }));
        await runner.recover();
        expect(calls).to.deep.equal(['ready', 'drain']);
    });
});

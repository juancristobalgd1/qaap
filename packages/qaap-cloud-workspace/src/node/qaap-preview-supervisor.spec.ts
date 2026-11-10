// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import { buildQaapPreviewProcessEnv, buildQaapPreviewScriptCommand, QaapPreviewSupervisor } from './qaap-preview-supervisor';

function errnoError(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(code), { code });
}

describe('buildQaapPreviewScriptCommand', () => {
    it('runs Windows package-manager shims through cmd.exe', () => {
        const command = buildQaapPreviewScriptCommand('pnpm', 'dev', 'win32');

        expect(command.command.toLowerCase()).to.match(/(?:cmd\.exe|\\cmd)$/);
        expect(command.args).to.deep.equal(['/d', '/s', '/c', 'pnpm run dev']);
    });

    it('keeps POSIX package-manager startup as shell-free argv', () => {
        expect(buildQaapPreviewScriptCommand('pnpm', 'dev', 'linux')).to.deep.equal({
            command: 'pnpm',
            args: ['run', 'dev'],
        });
    });
});

describe('buildQaapPreviewProcessEnv', () => {
    it('pins the supervised dev server to its reserved port like the frontend bootstrap', () => {
        const env = buildQaapPreviewProcessEnv({ PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=512' }, 5174);

        expect(env.PATH).to.equal('/bin');
        expect(env.PORT).to.equal('5174');
        expect(env.QAAP_PREVIEW_PORT).to.equal('5174');
        expect(env.BROWSER).to.equal('none');
        const [kept, preload] = env.NODE_OPTIONS!.split(' ');
        expect(kept).to.equal('--max-old-space-size=512');
        const source = Buffer.from(preload.replace('--import=data:text/javascript;base64,', ''), 'base64').toString('utf8');
        expect(source).to.contain('QAAP_PREVIEW_PORT');
        expect(source).to.contain('--strictPort');
    });
});

describe('QaapPreviewSupervisor shutdown', () => {
    class TestSupervisor extends QaapPreviewSupervisor {
        addLiveChild(key: string): void {
            // Signals go to the process group (-pid) through process.kill, not to child.kill.
            const child = { pid: 53001, exitCode: null };
            this.records.set(key, { key, child } as never);
        }
        cleanup(): void {
            this.registerCleanup();
        }
    }

    it('leaves SIGINT/SIGTERM to Theia graceful shutdown instead of exiting the process', () => {
        const before = { sigint: process.listenerCount('SIGINT'), sigterm: process.listenerCount('SIGTERM') };
        const exitListeners = process.listeners('exit');
        const supervisor = new TestSupervisor();
        supervisor.cleanup();
        try {
            expect(process.listenerCount('SIGINT')).to.equal(before.sigint);
            expect(process.listenerCount('SIGTERM')).to.equal(before.sigterm);
        } finally {
            for (const listener of process.listeners('exit')) {
                if (!exitListeners.includes(listener)) {
                    process.removeListener('exit', listener);
                }
            }
        }
    });

    it('kills live dev servers from onStop', () => {
        const killStub = sinon.stub(process, 'kill').returns(true);
        try {
            const supervisor = new TestSupervisor();
            supervisor.addLiveChild('preview-a');
            supervisor.onStop();
            expect(killStub.calledWith(-53001, 'SIGTERM')).to.equal(true);
        } finally {
            killStub.restore();
        }
    });
});

describe('QaapPreviewSupervisor lifecycle', () => {
    class FakeDevServer extends EventEmitter {
        exitCode: number | null = null;
        readonly stdout = null;
        readonly stderr = null;
        constructor(readonly pid: number) {
            super();
        }
    }

    /** Exposes the seams the lifecycle specs drive: the spawn call and the registry records. */
    class LifecycleSupervisor extends QaapPreviewSupervisor {
        spawnArgvPreparedAsync: sinon.SinonStub;
        constructor(spawn: sinon.SinonStub) {
            super();
            this.spawnArgvPreparedAsync = spawn;
            (this as unknown as { tenantSpawn: unknown }).tenantSpawn = {
                resolveProcessEnv: (): NodeJS.ProcessEnv => ({}),
                resolveSpawnIdentity: (): undefined => undefined,
                spawnArgvPreparedAsync: spawn,
            };
            // Keeps the process-exit hook out of the test process.
            this.cleanupRegistered = true;
        }
        recordOf(key: string): unknown {
            return this.records.get(key);
        }
        pendingCount(): number {
            return this.pendingStarts.size;
        }
    }

    const LAUNCH = { command: 'node', args: ['-e', '0'] };
    const IDENTITY = { previewId: 'p-live', workspaceId: 'w', projectId: 'pr', conversationId: 'c' } as never;
    let processKill: sinon.SinonStub;
    let consoleWarn: sinon.SinonStub;

    beforeEach(() => {
        processKill = sinon.stub(process, 'kill');
        consoleWarn = sinon.stub(console, 'warn');
    });

    afterEach(() => {
        processKill.restore();
        consoleWarn.restore();
    });

    async function startedSupervisor(pid: number): Promise<{ supervisor: LifecycleSupervisor; child: FakeDevServer }> {
        const child = new FakeDevServer(pid);
        const spawn = sinon.stub().resolves(child);
        const supervisor = new LifecycleSupervisor(spawn);
        await supervisor.start('/repo', 5173, IDENTITY, LAUNCH);
        return { supervisor, child };
    }

    it('keeps the record and its port when the dev server could not be signalled', async () => {
        const { supervisor } = await startedSupervisor(52001);
        processKill.throws(errnoError('EPERM'));

        expect(supervisor.stop('p-live')).to.equal(false);

        expect(supervisor.recordOf('p-live')).to.not.equal(undefined);
    });

    it('retires the record at once when the dev server is already gone (ESRCH)', async () => {
        const { supervisor } = await startedSupervisor(52002);
        processKill.throws(errnoError('ESRCH'));

        expect(supervisor.stop('p-live')).to.equal(false);

        expect(supervisor.recordOf('p-live')).to.equal(undefined);
    });

    it('holds the record until the child reports its exit, then retires it without restarting', async () => {
        const { supervisor, child } = await startedSupervisor(52003);
        processKill.returns(true);

        expect(supervisor.stop('p-live')).to.equal(true);
        expect(supervisor.recordOf('p-live')).to.not.equal(undefined);

        child.exitCode = 0;
        child.emit('exit', 0, null);

        expect(supervisor.recordOf('p-live')).to.equal(undefined);
        expect(supervisor.spawnArgvPreparedAsync.calledOnce).to.equal(true);
    });

    it('reuses the spawn in flight for a concurrent start of the same preview', async () => {
        const child = new FakeDevServer(52004);
        let release!: (value: FakeDevServer) => void;
        const spawn = sinon.stub().returns(new Promise<FakeDevServer>(resolve => { release = resolve; }));
        const supervisor = new LifecycleSupervisor(spawn);

        const first = supervisor.start('/repo', 5173, IDENTITY, LAUNCH);
        const second = supervisor.start('/repo', 5173, IDENTITY, LAUNCH);
        release(child);

        expect(await first).to.equal('starting');
        expect(await second).to.equal('starting');
        expect(spawn.calledOnce).to.equal(true);
        expect(supervisor.pendingCount()).to.equal(0);
    });
});

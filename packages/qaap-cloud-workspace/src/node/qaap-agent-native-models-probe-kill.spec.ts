// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { discoverClaudeCliModels } from './qaap-agent-native-models';

/**
 * A Claude probe child whose stdin, stdout and exit are driven by the test. `kill` is a spy; the
 * `respectsSigterm` flag decides whether SIGTERM ends it (a CLI that ignores it keeps running).
 */
class FakeClaudeProbeChild extends EventEmitter {
    readonly pid = 53001;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    readonly stdin = Object.assign(new EventEmitter(), { write: sinon.spy(() => true), end: sinon.spy() });
    readonly stdout = Object.assign(new EventEmitter(), { setEncoding: sinon.spy() });
    readonly kill = sinon.spy((signal?: NodeJS.Signals): boolean => {
        if (signal === 'SIGTERM' && this.respectsSigterm) {
            this.exit(null, signal);
        }
        return true;
    });

    constructor(private readonly respectsSigterm: boolean) {
        super();
    }

    /** Records the exit the way Node does: the status first, then the `exit` event. */
    exit(code: number | null, signal: NodeJS.Signals | null): void {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('exit', code, signal);
        this.emit('close', code, signal);
    }
}

describe('qaap-agent-native-models probe child shutdown', () => {
    const fixture = path.join(__dirname, '..', '..', 'test-resources', 'agent-models', 'claude-initialize-response.json');
    let clock: sinon.SinonFakeTimers;
    let spawnStub: sinon.SinonStub;

    beforeEach(function (): void {
        if (globalThis.process.platform === 'win32') {
            this.skip();
        }
        clock = sinon.useFakeTimers({ now: 3_000_000, toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        spawnStub?.restore();
        clock?.restore();
    });

    /** Stubs spawn to hand out `child`, then answers the `initialize` request with the CLI fixture. */
    async function probeAnsweredBy(child: FakeClaudeProbeChild): Promise<ReturnType<typeof discoverClaudeCliModels>> {
        spawnStub = sinon.stub(childProcess, 'spawn').returns(child as unknown as childProcess.ChildProcess);
        const answer = fs.readFileSync(fixture, 'utf8').trim();
        const discovery = discoverClaudeCliModels(undefined, 15_000);
        child.stdout.emit('data', `${answer}\n`);
        return discovery;
    }

    it('closes stdin, sends SIGTERM, and SIGKILLs a CLI that ignores SIGTERM after the escalation delay', async () => {
        const child = new FakeClaudeProbeChild(false);
        const models = await probeAnsweredBy(child);

        expect(models).to.have.length(14);
        expect(child.stdin.end.calledOnce).to.equal(true);
        expect(child.kill.calledWithExactly('SIGTERM')).to.equal(true);
        expect(child.kill.calledWithExactly('SIGKILL')).to.equal(false);

        clock.tick(1_999);
        expect(child.kill.calledWithExactly('SIGKILL')).to.equal(false);
        clock.tick(1);
        expect(child.kill.calledWithExactly('SIGKILL')).to.equal(true);
    });

    it('sends no SIGKILL when the CLI exits on SIGTERM', async () => {
        const child = new FakeClaudeProbeChild(true);
        await probeAnsweredBy(child);

        clock.tick(10_000);
        expect(child.kill.calledWithExactly('SIGTERM')).to.equal(true);
        expect(child.kill.calledWithExactly('SIGKILL')).to.equal(false);
        expect(child.kill.callCount).to.equal(1);
    });

    it('clears the escalation when the exit arrives before it fires', async () => {
        const child = new FakeClaudeProbeChild(false);
        await probeAnsweredBy(child);

        // The process ends on its own a moment after SIGTERM, without touching the spy.
        child.exit(0, null);
        clock.tick(10_000);
        expect(child.kill.calledWithExactly('SIGKILL')).to.equal(false);
    });
});

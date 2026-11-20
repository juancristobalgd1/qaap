// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess, spawn } from 'child_process';
import {
    agentProcessIdentityOf,
    agentProcessSignalRunner,
    AgentProcessIdentity,
    AgentProcessSignalOutcome,
    rememberAgentProcessIdentity,
    signalAgentProcess,
    signalAgentProcessTree,
} from './qaap-agent-process-signal';

/**
 * A root backend without CAP_KILL gets EPERM when it signals an agent running as another uid. The relay re-sends
 * the signal as that uid. These specs replace `process.kill` and the relay so they run without root.
 */
describe('qaap-agent-process-signal', () => {

    const originalKill = process.kill;
    const originalRun = agentProcessSignalRunner.run;
    const agentIdentity: AgentProcessIdentity = { uid: 4242, gid: 4242 };
    let killCalls: { target: number; signal: NodeJS.Signals }[];
    let relayCalls: { identity: AgentProcessIdentity; target: number; signal: NodeJS.Signals }[];

    /** Every `process.kill` call throws `code`, or is decided by `behaviour` when given. */
    function stubKill(behaviour: (target: number) => string | undefined): void {
        process.kill = ((target: number, signal?: NodeJS.Signals | number) => {
            killCalls.push({ target, signal: signal as NodeJS.Signals });
            const code = behaviour(target);
            if (code) {
                throw Object.assign(new Error(code), { code });
            }
            return true;
        }) as typeof process.kill;
    }

    function stubRelay(outcome: AgentProcessSignalOutcome): void {
        agentProcessSignalRunner.run = (identity, target, signal) => {
            relayCalls.push({ identity, target, signal });
            return outcome;
        };
    }

    beforeEach(() => {
        killCalls = [];
        relayCalls = [];
    });

    afterEach(() => {
        process.kill = originalKill;
        agentProcessSignalRunner.run = originalRun;
    });

    it('delivers a signal directly when the kernel allows it', async () => {
        const child: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
        expect(child.pid).to.be.a('number');
        expect(signalAgentProcess(child.pid!, 'SIGTERM', agentIdentity)).to.equal('sent');
        await exited;
        expect(relayCalls).to.have.length(0);
    });

    it('relays EPERM as the agent uid and reports sent', () => {
        stubKill(() => 'EPERM');
        stubRelay('sent');
        expect(signalAgentProcess(1234, 'SIGKILL', agentIdentity)).to.equal('sent');
        expect(relayCalls).to.deep.equal([{ identity: agentIdentity, target: 1234, signal: 'SIGKILL' }]);
    });

    it('reports failed, not stopped, when EPERM cannot be relayed', () => {
        stubKill(() => 'EPERM');
        stubRelay('failed');
        expect(signalAgentProcess(1234, 'SIGKILL', agentIdentity)).to.equal('failed');
        expect(relayCalls).to.have.length(1);
    });

    it('treats ESRCH as gone (the process already exited)', () => {
        stubKill(() => 'ESRCH');
        stubRelay('failed');
        expect(signalAgentProcess(1234, 'SIGTERM', agentIdentity)).to.equal('gone');
        expect(relayCalls).to.have.length(0);
    });

    it('does not relay EPERM when no agent identity is known', () => {
        stubKill(() => 'EPERM');
        stubRelay('sent');
        expect(signalAgentProcess(1234, 'SIGTERM')).to.equal('failed');
        expect(relayCalls).to.have.length(0);
    });

    it('refuses pid 0, pid 1, and this process without calling kill', () => {
        stubKill(() => undefined);
        expect(signalAgentProcess(0, 'SIGTERM', agentIdentity)).to.equal('failed');
        expect(signalAgentProcess(1, 'SIGTERM', agentIdentity)).to.equal('failed');
        expect(signalAgentProcess(process.pid, 'SIGTERM', agentIdentity)).to.equal('failed');
        expect(signalAgentProcess(-process.pid, 'SIGTERM', agentIdentity)).to.equal('failed');
        expect(killCalls).to.have.length(0);
    });

    it('signals the leader when the group is gone', () => {
        stubKill(target => (target < 0 ? 'ESRCH' : undefined));
        expect(signalAgentProcessTree(fakeChild(1234), 'SIGTERM')).to.equal('sent');
        expect(killCalls.map(call => call.target)).to.deep.equal([-1234, 1234]);
    });

    it('reports failed for a tree whose group EPERMs and whose relay also fails', () => {
        stubKill(() => 'EPERM');
        stubRelay('failed');
        const child = fakeChild(1234);
        rememberAgentProcessIdentity(child, agentIdentity);
        expect(signalAgentProcessTree(child, 'SIGKILL')).to.equal('failed');
        // The leader is still signalled (and relayed) even though the group could not be reached.
        expect(relayCalls.map(call => call.target)).to.deep.equal([-1234, 1234]);
    });

    it('remembers the identity a child was spawned as, and nothing when there is no drop', () => {
        const dropped = fakeChild(1);
        const plain = fakeChild(2);
        rememberAgentProcessIdentity(dropped, { uid: 4242, gid: 4242 });
        rememberAgentProcessIdentity(plain, undefined);
        expect(agentProcessIdentityOf(dropped)).to.deep.equal({ uid: 4242, gid: 4242 });
        expect(agentProcessIdentityOf(plain)).to.equal(undefined);
    });
});

function fakeChild(pid: number): ChildProcess {
    return { pid } as ChildProcess;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import {
    AGENT_STOP_GRACE_TIMEOUT_MS,
    MIN_AGENT_STOP_GRACE_TIMEOUT_MS,
    resolveAgentStopGraceTimeoutMs,
} from './qaap-agent-task-runner-constants';
import { cancelExtracted, logCancelExitExtracted, releaseStoppingTaskSlotOnExitExtracted } from './qaap-agent-task-runner-streaming2';
import { killAgentProcessTreeExtracted } from './qaap-agent-task-runner-timeline2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

/** A child whose pid is known and whose kill() is a spy; process-group signals go through process.kill. */
class FakeChild extends EventEmitter {
    readonly pid = 51001;
    readonly kill = sinon.spy((_signal?: NodeJS.Signals): boolean => true);
}

interface Harness {
    ctx: QaapAgentTaskRunnerContext;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly stoppingTaskIds: Set<string>;
    readonly finishTaskCalls: string[];
    drains: number;
}

const TASK_ID = 'task-cancel-1';

function runningTask(): QaapAgentTask {
    return {
        id: TASK_ID,
        title: 'edit files',
        command: 'qaiq --prompt "do work"',
        cwd: '/repo',
        state: 'running',
        createdAt: 0,
        agentId: 'qaiq',
        ownerLogin: 'alice',
    };
}

/** The slice of the task runner context that cancelExtracted and the kill helper read. */
function createHarness(child: ChildProcess): Harness {
    const tasks = new Map<string, QaapAgentTask>([[TASK_ID, runningTask()]]);
    const processes = new Map<string, ChildProcess>([[TASK_ID, child]]);
    const stoppingTaskIds = new Set<string>();
    const finishTaskCalls: string[] = [];
    const harness: Harness = { ctx: undefined!, tasks, stoppingTaskIds, finishTaskCalls, drains: 0 };
    const fields = {
        tasks,
        processes,
        stoppingTaskIds,
        queuedCreateRequests: new Map(),
        conversationIdForTask: (): string => 'conv-1',
        recordTaskLatencyMark: (taskId: string, mark: string, at = Date.now()): void => {
            const task = tasks.get(taskId);
            if (!task || (task.latencyMarks as Record<string, number> | undefined)?.[mark] !== undefined) {
                return;
            }
            tasks.set(taskId, { ...task, latencyMarks: { ...task.latencyMarks, [mark]: at } } as QaapAgentTask);
        },
        finishTask: (id: string, state: QaapAgentTask['state']): QaapAgentTask => {
            finishTaskCalls.push(id);
            const finished = { ...tasks.get(id)!, state, finishedAt: Date.now() };
            tasks.set(id, finished);
            return finished;
        },
        drainQueuedTasks: (): void => { harness.drains++; },
        persist: (): Promise<void> => Promise.resolve(),
    };
    const ctx = fields as unknown as QaapAgentTaskRunnerContext;
    Object.assign(ctx, {
        killAgentProcessTree: (target: ChildProcess, options?: { escalateAfterMs?: number; onGracePeriodElapsed?: () => void }) =>
            killAgentProcessTreeExtracted(ctx, target, options),
    });
    harness.ctx = ctx;
    return harness;
}

describe('QaapAgentTaskRunner stop latency', () => {
    let clock: sinon.SinonFakeTimers;
    let processKill: sinon.SinonStub;
    let consoleWarn: sinon.SinonStub;
    let consoleError: sinon.SinonStub;

    /** The `[qaap-stop] conv=` settle and exit lines; the signal and escalation timing lines are separate. */
    const stopLines = (): string[] => consoleWarn.getCalls()
        .map(call => String(call.args[0]))
        .filter(line => /^\[qaap-stop\] conv=/.test(line));

    beforeEach(function (): void {
        if (globalThis.process.platform === 'win32') {
            this.skip();
        }
        clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        processKill = sinon.stub(globalThis.process, 'kill').callsFake(() => true);
        consoleWarn = sinon.stub(console, 'warn');
        consoleError = sinon.stub(console, 'error');
    });

    afterEach(() => {
        consoleWarn?.restore();
        consoleError?.restore();
        processKill?.restore();
        clock?.restore();
    });

    it('settles the cancel as cancelled at once while the agent ignores SIGTERM', () => {
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);

        const result = cancelExtracted(harness.ctx, TASK_ID);

        expect(result?.state).to.equal('cancelled');
        expect(harness.stoppingTaskIds.has(TASK_ID)).to.equal(true);
        expect(processKill.calledWith(-51001, 'SIGTERM')).to.equal(true);
        expect(processKill.calledWith(-51001, 'SIGKILL')).to.equal(false);
        const marks = harness.tasks.get(TASK_ID)?.latencyMarks;
        expect(marks?.cancel_received).to.be.a('number');
        expect(marks?.cancel_settled).to.be.at.least(marks?.cancel_received ?? Infinity);
    });

    it('escalates to SIGKILL at the grace timeout but holds the slot until the process exits', () => {
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);
        cancelExtracted(harness.ctx, TASK_ID);

        clock.tick(AGENT_STOP_GRACE_TIMEOUT_MS - 1);
        expect(processKill.calledWith(-51001, 'SIGKILL')).to.equal(false);
        expect(harness.stoppingTaskIds.has(TASK_ID)).to.equal(true);

        clock.tick(1);
        expect(processKill.calledWith(-51001, 'SIGKILL')).to.equal(true);
        // SIGKILL was sent, but the process has not exited yet: the slot stays held.
        expect(harness.stoppingTaskIds.has(TASK_ID)).to.equal(true);
        expect(harness.drains).to.equal(0);
        expect(AGENT_STOP_GRACE_TIMEOUT_MS).to.equal(2_000);

        // The exit handler releases the slot once the process is really gone.
        releaseStoppingTaskSlotOnExitExtracted(harness.ctx, TASK_ID);
        expect(harness.stoppingTaskIds.has(TASK_ID)).to.equal(false);
        expect(harness.drains).to.equal(1);
    });

    it('releases the slot at the grace timeout when the process already exited', () => {
        const child = new FakeChild();
        Object.assign(child, { exitCode: 0 });
        const harness = createHarness(child as unknown as ChildProcess);
        cancelExtracted(harness.ctx, TASK_ID);

        clock.tick(AGENT_STOP_GRACE_TIMEOUT_MS);
        expect(harness.stoppingTaskIds.has(TASK_ID)).to.equal(false);
        expect(harness.drains).to.equal(1);
    });

    it('marks the task as not stopped when SIGKILL fails, and keeps the slot', () => {
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);
        processKill.callsFake((pid: number, signal: NodeJS.Signals | number) => {
            if (signal === 'SIGKILL') {
                const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
                throw error;
            }
            return true;
        });
        cancelExtracted(harness.ctx, TASK_ID);

        clock.tick(AGENT_STOP_GRACE_TIMEOUT_MS);
        const task = harness.tasks.get(TASK_ID);
        expect(task?.state).to.equal('failed');
        expect(task?.stopFailure).to.equal('Could not stop the agent; it may still be running.');
        expect(harness.stoppingTaskIds.has(TASK_ID)).to.equal(true);
        expect(harness.drains).to.equal(0);
        expect(consoleError.called).to.equal(true);
    });

    it('signals the leader directly when the process group is already gone (ESRCH)', () => {
        processKill.callsFake((pid: number) => {
            if (pid < 0) {
                throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
            }
            return true;
        });
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);

        cancelExtracted(harness.ctx, TASK_ID);

        expect(child.kill.calledWith('SIGTERM')).to.equal(true);
        expect(consoleWarn.getCalls().some(call => /\[qaap-stop\] process group 51001 not found/.test(String(call.args[0])))).to.equal(true);
    });

    it('logs the epoch of each signal and how late the grace timer fired', () => {
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);

        cancelExtracted(harness.ctx, TASK_ID);
        clock.tick(AGENT_STOP_GRACE_TIMEOUT_MS);

        const lines = consoleWarn.getCalls().map(call => String(call.args[0]));
        expect(lines.some(line => /signal pid=51001 target=group sig=SIGTERM epoch=1000000$/.test(line))).to.equal(true);
        expect(lines.some(line => /signal pid=51001 target=group sig=SIGKILL epoch=1002000$/.test(line))).to.equal(true);
        expect(lines.some(line => /escalation-armed pid=51001 armedAt=1000000 graceMs=2000$/.test(line))).to.equal(true);
        expect(lines.some(line => /escalation-fired pid=51001 armedAt=1000000 deadline=1002000 fired=1002000 lagMs=0 maxLoopGapMs=\d+$/.test(line))).to.equal(true);
    });

    it('logs a settle line with exitMs pending, then an exit line once the child exits', () => {
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);

        cancelExtracted(harness.ctx, TASK_ID);
        expect(stopLines()[0]).to.match(/^\[qaap-stop\] conv=conv-1 task=task-cancel-1 settledMs=\d+ exitMs=pending$/);

        clock.tick(500);
        harness.ctx.recordTaskLatencyMark(TASK_ID, 'process_exit');
        logCancelExitExtracted(harness.ctx, TASK_ID);
        expect(stopLines()[1]).to.equal('[qaap-stop] conv=conv-1 task=task-cancel-1 exitMs=500');
    });

    it('treats a second cancel of a settled task as a no-op', () => {
        const child = new FakeChild();
        const harness = createHarness(child as unknown as ChildProcess);

        cancelExtracted(harness.ctx, TASK_ID);
        const before = harness.tasks.get(TASK_ID);
        const second = cancelExtracted(harness.ctx, TASK_ID);

        expect(second?.state).to.equal('cancelled');
        expect(harness.finishTaskCalls).to.deep.equal([TASK_ID]);
        expect(harness.tasks.get(TASK_ID)).to.equal(before);
        expect(stopLines()).to.have.length(1);
    });

    it('uses a 2 s default grace and a 1 s floor for the stop grace timeout', () => {
        expect(resolveAgentStopGraceTimeoutMs(undefined)).to.equal(2_000);
        expect(MIN_AGENT_STOP_GRACE_TIMEOUT_MS).to.equal(1_000);
        expect(resolveAgentStopGraceTimeoutMs('100')).to.equal(1_000);
    });
});

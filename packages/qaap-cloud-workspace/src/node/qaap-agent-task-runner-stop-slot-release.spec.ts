// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { AGENT_STOP_GRACE_TIMEOUT_MS, AGENT_STOP_SLOT_RELEASE_TIMEOUT_MS } from './qaap-agent-task-runner-constants';
import { countRunningTasksExtracted, drainQueuedTasksExtracted, sharedWorkingTreeBusyExtracted } from './qaap-agent-task-runner-render2';
import { cancelExtracted, releaseStoppingTaskSlotOnExitExtracted } from './qaap-agent-task-runner-streaming2';
import { killAgentProcessTreeExtracted } from './qaap-agent-task-runner-timeline2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

/** A child whose pid is known and whose `exit` the test fires (or, for a zombie, never fires). */
class FakeChild extends EventEmitter {
    constructor(readonly pid: number) {
        super();
    }

    readonly kill = sinon.spy((_signal?: NodeJS.Signals): boolean => true);
    readonly exitCode: number | null = null;
    readonly signalCode: NodeJS.Signals | null = null;
}

const STOPPING_ID = 'task-stopping-1';
const QUEUED_ID = 'task-queued-2';
const REPO = '/repo-stop-slot';

function task(id: string, state: QaapAgentTask['state']): QaapAgentTask {
    return {
        id,
        title: id,
        command: 'qaiq --prompt "do work"',
        cwd: REPO,
        state,
        createdAt: 0,
        agentId: 'qaiq',
        ownerLogin: 'alice',
        sharedWorkingTree: true,
    };
}

interface Harness {
    ctx: QaapAgentTaskRunnerContext;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly stoppingTaskIds: Set<string>;
    readonly spawned: string[];
    drains: number;
}

/** The slice of the task runner context that cancel, the slot release and the queue drain read. */
function createHarness(child: ChildProcess): Harness {
    const tasks = new Map<string, QaapAgentTask>([
        [STOPPING_ID, task(STOPPING_ID, 'running')],
        [QUEUED_ID, task(QUEUED_ID, 'queued')],
    ]);
    const processes = new Map<string, ChildProcess>([[STOPPING_ID, child]]);
    const stoppingTaskIds = new Set<string>();
    const queuedCreateRequests = new Map<string, object>([[QUEUED_ID, {}]]);
    const spawned: string[] = [];
    const harness: Harness = { ctx: undefined!, tasks, stoppingTaskIds, spawned, drains: 0 };
    const fields = {
        tasks,
        processes,
        stoppingTaskIds,
        queuedCreateRequests,
        recoveryState: 'ready',
        storageWriteFailed: false,
        isDrainingForDeploy: (): boolean => false,
        maxConcurrentAgents: (): number => 1,
        ownerAtConcurrencyCap: (): boolean => false,
        repoAtConcurrencyCap: (): boolean => false,
        conversationIdForTask: (): string => 'conv-stop-slot',
        recordTaskLatencyMark: (): void => undefined,
        finishTask: (id: string, state: QaapAgentTask['state']): QaapAgentTask => {
            const finished = { ...tasks.get(id)!, state, finishedAt: Date.now() };
            tasks.set(id, finished);
            return finished;
        },
        spawnProcessWhenReady: (running: QaapAgentTask): Promise<void> => {
            spawned.push(running.id);
            return Promise.resolve();
        },
        onDidChangeTaskEmitter: { fire: (): void => undefined },
        persist: (): Promise<void> => Promise.resolve(),
        killAgentProcessTree: (target: ChildProcess, options?: { escalateAfterMs?: number; onGracePeriodElapsed?: () => void }) =>
            killAgentProcessTreeExtracted(harness.ctx, target, options),
    };
    const ctx = fields as unknown as QaapAgentTaskRunnerContext;
    Object.assign(ctx, {
        countRunningTasks: (): number => countRunningTasksExtracted(ctx),
        drainQueuedTasks: (): void => {
            harness.drains++;
            drainQueuedTasksExtracted(ctx);
        },
    });
    harness.ctx = ctx;
    return harness;
}

describe('QaapAgentTaskRunner stop slot release', () => {
    let clock: sinon.SinonFakeTimers;
    let processKill: sinon.SinonStub;
    let consoleWarn: sinon.SinonStub;
    let consoleError: sinon.SinonStub;

    beforeEach(function (): void {
        if (globalThis.process.platform === 'win32') {
            this.skip();
        }
        clock = sinon.useFakeTimers({ now: 2_000_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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

    /** Cancels the running task and advances past SIGKILL; the child's `exit` is not fired. */
    function stopAndKill(harness: Harness): void {
        cancelExtracted(harness.ctx, STOPPING_ID);
        clock.tick(AGENT_STOP_GRACE_TIMEOUT_MS);
    }

    const forcedReleaseWarnings = (): string[] => consoleWarn.getCalls()
        .map(call => String(call.args[0]))
        .filter(line => line.startsWith('[qaap-stop] slot-released-without-exit'));

    it('frees a zombie stop slot after the bound and starts the next shared-tree task', () => {
        const child = new FakeChild(52001);
        const harness = createHarness(child as unknown as ChildProcess);
        stopAndKill(harness);

        expect(processKill.calledWith(-52001, 'SIGKILL')).to.equal(true);
        expect(harness.stoppingTaskIds.has(STOPPING_ID)).to.equal(true);
        expect(countRunningTasksExtracted(harness.ctx)).to.equal(1);
        expect(sharedWorkingTreeBusyExtracted(harness.ctx, 'alice', REPO, QUEUED_ID)).to.equal(true);
        expect(harness.spawned).to.deep.equal([]);

        clock.tick(AGENT_STOP_SLOT_RELEASE_TIMEOUT_MS - 1);
        expect(harness.stoppingTaskIds.has(STOPPING_ID)).to.equal(true);
        expect(harness.spawned).to.deep.equal([]);

        clock.tick(1);
        expect(harness.stoppingTaskIds.has(STOPPING_ID)).to.equal(false);
        // The stopped task no longer counts; the single slot now belongs to the queued task.
        expect(countRunningTasksExtracted(harness.ctx)).to.equal(1);
        expect(harness.tasks.get(STOPPING_ID)?.state).to.equal('cancelled');
        expect(sharedWorkingTreeBusyExtracted(harness.ctx, 'alice', REPO, QUEUED_ID)).to.equal(false);
        expect(harness.spawned).to.deep.equal([QUEUED_ID]);
        expect(harness.tasks.get(QUEUED_ID)?.state).to.equal('running');
        expect(forcedReleaseWarnings()).to.deep.equal([
            `[qaap-stop] slot-released-without-exit task=${STOPPING_ID} pid=52001 waitedMs=${AGENT_STOP_SLOT_RELEASE_TIMEOUT_MS}`,
        ]);
    });

    it('ignores a late exit after the forced release: no second drain, no second start', () => {
        const child = new FakeChild(52002);
        const harness = createHarness(child as unknown as ChildProcess);
        stopAndKill(harness);
        clock.tick(AGENT_STOP_SLOT_RELEASE_TIMEOUT_MS);
        const drainsAfterRelease = harness.drains;

        expect(() => releaseStoppingTaskSlotOnExitExtracted(harness.ctx, STOPPING_ID)).to.not.throw();
        expect(harness.drains).to.equal(drainsAfterRelease);
        expect(harness.spawned).to.deep.equal([QUEUED_ID]);
        expect(harness.stoppingTaskIds.size).to.equal(0);
        expect(forcedReleaseWarnings()).to.have.length(1);
    });

    it('cancels the forced release when the exit arrives in time', () => {
        const child = new FakeChild(52003);
        const harness = createHarness(child as unknown as ChildProcess);
        stopAndKill(harness);

        clock.tick(AGENT_STOP_SLOT_RELEASE_TIMEOUT_MS / 2);
        releaseStoppingTaskSlotOnExitExtracted(harness.ctx, STOPPING_ID);
        expect(harness.spawned).to.deep.equal([QUEUED_ID]);
        const drainsAfterExit = harness.drains;

        clock.tick(AGENT_STOP_SLOT_RELEASE_TIMEOUT_MS * 2);
        expect(harness.drains).to.equal(drainsAfterExit);
        expect(forcedReleaseWarnings()).to.deep.equal([]);
        expect(consoleError.called).to.equal(false);
    });
});

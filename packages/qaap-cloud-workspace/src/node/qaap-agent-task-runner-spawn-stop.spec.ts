// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { spawnProcessExtracted } from './qaap-agent-task-runner-timeline2';

const TASK_ID = 'task-spawn-stop-1';

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

interface SpawnHarness {
    readonly ctx: QaapAgentTaskRunnerContext;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly spawnAgentCommand: sinon.SinonSpy;
    readonly releaseTaskSandbox: sinon.SinonSpy;
    readonly finishTask: sinon.SinonSpy;
    readonly promptTempDirs: Map<string, string>;
    readonly stdinPrompts: Map<string, unknown>;
    /** Marks the task cancelled the way Stop does, without touching the child (there is none yet). */
    cancel(): void;
}

/**
 * The slice of the task runner context that spawnProcessExtracted reads before the child exists.
 * `hook` runs inside one of the awaited steps, so a test can land a Stop exactly in that window.
 */
function createSpawnHarness(logDir: string, hook?: { point: 'ensureAgentCwdOwnershipAsync' | 'acquireTaskSandbox'; run: () => void }): SpawnHarness {
    const tasks = new Map<string, QaapAgentTask>([[TASK_ID, runningTask()]]);
    const stdinPrompts = new Map<string, unknown>([[TASK_ID, 'prompt text']]);
    const promptTempDirs = new Map<string, string>();
    const spawnAgentCommand = sinon.spy((): ChildProcess => {
        // Reached only when the task is still running: the test stops the spawn by throwing here.
        throw new Error('spawn-called');
    });
    const releaseTaskSandbox = sinon.spy();
    const finishTask = sinon.spy((id: string, state: QaapAgentTask['state']): QaapAgentTask => {
        const finished = { ...tasks.get(id)!, state, finishedAt: Date.now() };
        tasks.set(id, finished);
        return finished;
    });
    const awaitStep = async (point: 'ensureAgentCwdOwnershipAsync' | 'acquireTaskSandbox'): Promise<void> => {
        if (hook?.point === point) {
            hook.run();
        }
        // Yield once so the stop lands while the step is in flight, as a real await would.
        await Promise.resolve();
    };
    const fields = {
        tasks,
        stdinPrompts,
        promptTempDirs,
        stdinInteractiveTasks: new Set<string>(),
        processes: new Map<string, ChildProcess>(),
        logPath: (taskId: string): string => path.join(logDir, `${taskId}.log`),
        enforceAgentIsolationPolicy: (): void => { /* no-op in this harness */ },
        ensureAgentCwdOwnershipAsync: (): Promise<void> => awaitStep('ensureAgentCwdOwnershipAsync'),
        acquireTaskSandbox: (): Promise<void> => awaitStep('acquireTaskSandbox'),
        releaseTaskSandbox,
        recordTaskLatencyMark: (): void => { /* no-op */ },
        observability: undefined,
        resolveTaskAgentId: (task: QaapAgentTask): string | undefined => task.agentId,
        resolveAgentSpawnIdentity: (): undefined => undefined,
        isProjectFolderTrusted: (): boolean => true,
        buildChildEnv: (): NodeJS.ProcessEnv => ({}),
        applyToolGateEnv: (): void => { /* no-op */ },
        spawnAgentCommand,
        finishTask,
        persist: (): Promise<void> => Promise.resolve(),
    };
    const ctx = fields as unknown as QaapAgentTaskRunnerContext;
    return {
        ctx,
        tasks,
        spawnAgentCommand,
        releaseTaskSandbox,
        finishTask,
        promptTempDirs,
        stdinPrompts,
        cancel: (): void => {
            const current = tasks.get(TASK_ID)!;
            tasks.set(TASK_ID, { ...current, state: 'cancelled', finishedAt: Date.now() });
        },
    };
}

describe('QaapAgentTaskRunner spawn after Stop', () => {
    let logDir: string;
    let consoleWarn: sinon.SinonStub;

    beforeEach(function (): void {
        if (globalThis.process.platform === 'win32') {
            this.skip();
        }
        logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-spawn-stop-'));
        consoleWarn = sinon.stub(console, 'warn');
    });

    afterEach(() => {
        consoleWarn?.restore();
        fs.rmSync(logDir, { recursive: true, force: true });
    });

    it('spawns the agent when no Stop lands', async () => {
        const harness = createSpawnHarness(logDir);

        await spawnProcessExtracted(harness.ctx, runningTask());

        expect(harness.spawnAgentCommand.callCount).to.equal(1);
        expect(harness.finishTask.calledWith(TASK_ID, 'failed')).to.equal(true);
    });

    it('spawns nothing when Stop lands during the cwd ownership check', async () => {
        const harness = createSpawnHarness(logDir, { point: 'ensureAgentCwdOwnershipAsync', run: () => harness.cancel() });

        await spawnProcessExtracted(harness.ctx, runningTask());

        expect(harness.spawnAgentCommand.callCount).to.equal(0);
        expect(harness.finishTask.called).to.equal(false);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('cancelled');
    });

    it('spawns nothing and releases the sandbox when Stop lands while the sandbox is acquired', async () => {
        const harness = createSpawnHarness(logDir, { point: 'acquireTaskSandbox', run: () => harness.cancel() });

        await spawnProcessExtracted(harness.ctx, runningTask());

        expect(harness.spawnAgentCommand.callCount).to.equal(0);
        expect(harness.releaseTaskSandbox.calledWith(TASK_ID)).to.equal(true);
        expect(harness.finishTask.called).to.equal(false);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('cancelled');
        expect(harness.stdinPrompts.has(TASK_ID)).to.equal(false);
        expect(harness.promptTempDirs.has(TASK_ID)).to.equal(false);
    });

    it('logs the skipped spawn with the settled state', async () => {
        const harness = createSpawnHarness(logDir, { point: 'acquireTaskSandbox', run: () => harness.cancel() });

        await spawnProcessExtracted(harness.ctx, runningTask());

        const skipped = consoleWarn.getCalls().map(call => String(call.args[0])).filter(line => line.startsWith('[qaap-stop] spawn-skipped'));
        expect(skipped).to.deep.equal([`[qaap-stop] spawn-skipped task=${TASK_ID} state=cancelled`]);
    });
});

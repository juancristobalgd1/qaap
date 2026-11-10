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
import { DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER } from './qaap-codex-gate-overlay';
import { QAAP_OPENCODE_GATE_PROBE } from './qaap-tool-gate-opencode-probe';

const TASK_ID = 'task-spawn-stop-1';

function runningTask(agentId: string = 'qaiq'): QaapAgentTask {
    return {
        id: TASK_ID,
        title: 'edit files',
        command: `${agentId} --prompt "do work"`,
        cwd: '/repo',
        state: 'running',
        createdAt: 0,
        agentId,
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
function createSpawnHarness(
    logDir: string,
    hook?: { point: 'ensureAgentCwdOwnershipAsync' | 'acquireTaskSandbox'; run: () => void; fail?: boolean },
    agentId?: string,
): SpawnHarness {
    const tasks = new Map<string, QaapAgentTask>([[TASK_ID, runningTask(agentId)]]);
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
        if (hook?.point === point && hook.fail) {
            throw new Error(`${point} aborted`);
        }
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
        applyToolGateEnv: (env: NodeJS.ProcessEnv): void => {
            env.QAAP_GATE_TOKEN = 'gate-token';
        },
        toolGateWired: (): boolean => false,
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

/**
 * Every spawn path ends the task log with one write, so the log is non-empty once that write has landed.
 * Polls briefly (bounded) instead of guessing with a fixed number of event-loop turns.
 */
async function waitForTaskLogWrite(dir: string): Promise<void> {
    const logFile = path.join(dir, `${TASK_ID}.log`);
    for (let attempt = 0; attempt < 200; attempt++) {
        if (fs.existsSync(logFile) && fs.statSync(logFile).size > 0) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

describe('QaapAgentTaskRunner spawn after Stop', () => {
    let logDir: string;
    let consoleWarn: sinon.SinonStub;

    before(function (): void {
        // Skipping here (not in beforeEach) also skips afterEach, which would otherwise rmSync an unset logDir.
        if (globalThis.process.platform === 'win32') {
            this.skip();
        }
    });

    beforeEach(() => {
        logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-spawn-stop-'));
        consoleWarn = sinon.stub(console, 'warn');
    });

    afterEach(async () => {
        // Also restores the console.warn stub.
        sinon.restore();
        // The runner ends the task log stream without awaiting its flush, so the async open can still be
        // pending here; removing the directory first would surface as an uncaught ENOENT on the stream.
        await waitForTaskLogWrite(logDir);
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

    it('keeps the task cancelled when a startup step fails after Stop', async () => {
        const harness = createSpawnHarness(logDir, { point: 'acquireTaskSandbox', run: () => harness.cancel(), fail: true });

        await spawnProcessExtracted(harness.ctx, runningTask());

        expect(harness.spawnAgentCommand.callCount).to.equal(0);
        expect(harness.finishTask.called).to.equal(false);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('cancelled');
    });

    it('still fails the task when a startup step fails without a Stop', async () => {
        const harness = createSpawnHarness(logDir, { point: 'acquireTaskSandbox', run: () => undefined, fail: true });

        await spawnProcessExtracted(harness.ctx, runningTask());

        expect(harness.spawnAgentCommand.callCount).to.equal(0);
        expect(harness.finishTask.calledOnceWith(TASK_ID, 'failed')).to.equal(true);
    });

    it('spawns nothing when Stop lands during the OpenCode gate probe', async () => {
        const harness = createSpawnHarness(logDir, undefined, 'opencode');
        sinon.stub(QAAP_OPENCODE_GATE_PROBE, 'ensure').callsFake(async () => {
            harness.cancel();
            return { ok: true } as Awaited<ReturnType<typeof QAAP_OPENCODE_GATE_PROBE.ensure>>;
        });

        await spawnProcessExtracted(harness.ctx, runningTask('opencode'));

        expect(harness.spawnAgentCommand.callCount).to.equal(0);
        expect(harness.finishTask.called).to.equal(false);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('cancelled');
    });

    it('spawns nothing and disposes the Codex gate overlay when Stop lands while it is built', async () => {
        const harness = createSpawnHarness(logDir, undefined, 'codex');
        const dispose = sinon.spy();
        sinon.stub(DEFAULT_QAAP_CODEX_GATE_OVERLAY_BUILDER, 'create').callsFake(async () => {
            harness.cancel();
            return { codexHome: path.join(logDir, 'codex-home'), dispose };
        });

        await spawnProcessExtracted(harness.ctx, runningTask('codex'));

        expect(harness.spawnAgentCommand.callCount).to.equal(0);
        expect(dispose.callCount).to.equal(1);
        expect(harness.finishTask.called).to.equal(false);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('cancelled');
    });
});

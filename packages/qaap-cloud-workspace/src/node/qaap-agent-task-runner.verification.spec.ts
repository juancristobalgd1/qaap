// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTask, QaapAgentTaskVerification } from '../common/qaap-agent-task';

type ScriptRun = { command: string; result: { exitCode: number; stdout: string; stderr: string; timedOut: boolean } } | undefined;

class TestableQaapAgentTaskRunner extends QaapAgentTaskRunner {
    public runVerify(task: QaapAgentTask): Promise<QaapAgentTaskVerification | undefined> {
        return this.verifySuccessfulAgentTask(task);
    }
    public runGate(task: QaapAgentTask, exitCode: number | undefined): Promise<void> {
        return this.finishSuccessfulTaskAfterVerification(task, exitCode);
    }
    public releaseGateSlot(): void {
        this.releaseVerificationPass();
    }
    public worktreeFingerprint(cwd: string): string | undefined {
        return this.captureWorktreeFingerprint(cwd);
    }
    public worktreeStatus(cwd: string): string | undefined {
        return this.captureWorktreeStatus(cwd);
    }
    public worktreeBaseline(cwd: string): Pick<QaapAgentTask, 'worktreeBaselineFingerprint' | 'worktreeBaselineStatus'> {
        return this.captureWorktreeBaseline(cwd);
    }
    public hasTaskEdits(task: QaapAgentTask): Promise<boolean> {
        return this.hasEditedFilesForVerification(task, {});
    }
    public residualProcessGroupReaps = 0;
    protected override reapAgentProcessGroupAfterExit(_child: ChildProcess): void {
        this.residualProcessGroupReaps++;
    }
}

const TASK: QaapAgentTask = {
    id: 't1',
    title: 'edit files',
    command: 'qaiq --prompt "do work"',
    cwd: '/repo',
    state: 'running',
    createdAt: 0,
    agentId: 'qaiq',
};

/**
 * Build a runner whose environment/edit/script probes all succeed, so `verifySuccessfulAgentTask`
 * exercises its real loop. `runVerificationScripts` and `runAgentVerificationFixTurn` are the seams
 * each test drives; `fixTurns` counts how many agent fix turns the loop spawned.
 */
function makeRunner(overrides: Partial<Record<string, unknown>> = {}): { runner: TestableQaapAgentTaskRunner; fixTurns: () => number } {
    const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
    let fixTurns = 0;
    Object.assign(runner, {
        isQaiqRunner: () => true,
        buildChildEnv: () => ({}),
        hasEditedFilesForVerification: async () => true,
        resolveVerificationScriptsForCwd: async () => ['build'],
        isTaskStillRunning: () => true,
        summarizeVerificationFailure: (command: string) => `summary for ${command}`,
        runVerificationScripts: async (): Promise<ScriptRun> => undefined,
        runAgentVerificationFixTurn: async () => {
            fixTurns++;
            return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
        },
        ...overrides,
    });
    return { runner, fixTurns: () => fixTurns };
}

const failure = (command = 'npm run build'): ScriptRun => ({
    command,
    result: { exitCode: 1, stdout: 'boom', stderr: '', timedOut: false },
});

describe('QaapAgentTaskRunner self-verification loop', () => {

    it('passes on the first run with no fix turns', async () => {
        const { runner, fixTurns } = makeRunner();
        const result = await runner.runVerify(TASK);
        expect(result).to.deep.include({ status: 'passed', attempts: 0 });
        expect(fixTurns()).to.equal(0);
    });

    it('runs one fix turn then passes when the first check fails', async () => {
        let scriptCalls = 0;
        const { runner, fixTurns } = makeRunner({
            runVerificationScripts: async (): Promise<ScriptRun> => {
                scriptCalls++;
                return scriptCalls === 1 ? failure() : undefined;
            },
        });
        const result = await runner.runVerify(TASK);
        expect(result).to.deep.include({ status: 'passed', attempts: 1 });
        expect(fixTurns()).to.equal(1);
    });

    it('fails after exhausting the max fix attempts', async () => {
        const { runner, fixTurns } = makeRunner({
            runVerificationScripts: async (): Promise<ScriptRun> => failure(),
        });
        const result = await runner.runVerify(TASK);
        expect(result?.status).to.equal('failed');
        // QAAP_AGENT_VERIFY_MAX_ATTEMPTS = 2 → two fix turns, then give up.
        expect(result && 'attempts' in result ? result.attempts : -1).to.equal(2);
        expect(fixTurns()).to.equal(2);
        expect(result && 'summary' in result ? result.summary : '').to.contain('summary for');
    });

    it('verifies non-QAIQ agent tasks too (generalized gate, not QAIQ-only)', async () => {
        const { runner, fixTurns } = makeRunner();
        const claudeTask: QaapAgentTask = { ...TASK, command: 'claude --dangerously-skip-permissions "do work"', agentId: 'claude' };
        const result = await runner.runVerify(claudeTask);
        expect(result).to.deep.include({ status: 'passed', attempts: 0 });
        expect(fixTurns()).to.equal(0);
    });

    it('breaks the retry loop when the fix turn has no agent to run (graceful skip, not a crash)', async () => {
        const { runner } = makeRunner({
            runVerificationScripts: async (): Promise<ScriptRun> => failure(),
            runAgentVerificationFixTurn: async () => undefined,
        });
        const result = await runner.runVerify(TASK);
        expect(result?.status).to.equal('failed');
        // One attempt is made, the fix turn reports "no agent available", and the loop bails
        // instead of burning the remaining QAAP_AGENT_VERIFY_MAX_ATTEMPTS retrying an unfixed failure.
        expect(result && 'attempts' in result ? result.attempts : -1).to.equal(1);
    });

    it('skips when no files were edited', async () => {
        const { runner, fixTurns } = makeRunner({ hasEditedFilesForVerification: async () => false });
        expect(await runner.runVerify(TASK)).to.equal(undefined);
        expect(fixTurns()).to.equal(0);
    });

    it('skips when the project has no verification scripts', async () => {
        const { runner } = makeRunner({ resolveVerificationScriptsForCwd: async () => [] });
        expect(await runner.runVerify(TASK)).to.equal(undefined);
    });

    it('reports a failed verification that could not complete when the task stops mid-loop', async () => {
        const { runner, fixTurns } = makeRunner({ isTaskStillRunning: () => false });
        const result = await runner.runVerify(TASK);
        expect(result?.status).to.equal('failed');
        expect(result && 'summary' in result ? result.summary : '').to.contain('did not complete');
        expect(fixTurns()).to.equal(0);
    });
});

describe('QaapAgentTaskRunner worktree baseline', () => {

    const runGit = (cwd: string, ...args: string[]): void => {
        const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(result.stderr || `git ${args.join(' ')} failed`);
        }
    };

    const initRepo = (cwd: string): void => {
        runGit(cwd, 'init');
        runGit(cwd, 'config', 'user.email', 'qaap@example.test');
        runGit(cwd, 'config', 'user.name', 'Qaap Test');
    };

    it('does not attribute unchanged pre-existing dirty files to the agent task', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-baseline-'));
        try {
            initRepo(cwd);
            const tracked = path.join(cwd, 'tracked.txt');
            fs.writeFileSync(tracked, 'committed\n', 'utf8');
            runGit(cwd, 'add', 'tracked.txt');
            runGit(cwd, 'commit', '-m', 'initial');
            fs.writeFileSync(tracked, 'dirty before task\n', 'utf8');

            const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
            const baseline = runner.worktreeBaseline(cwd);
            if (!baseline.worktreeBaselineFingerprint || baseline.worktreeBaselineStatus === undefined) {
                throw new Error('Expected a worktree baseline.');
            }
              const task: QaapAgentTask = { ...TASK, cwd, ...baseline };
            expect(await runner.hasTaskEdits(task)).to.equal(false);
            const checked = { ...task, worktreeFinishedFingerprint: baseline.worktreeBaselineFingerprint };
            expect(runner.checkTaskWorkspaceSnapshot(checked)).to.equal('current');
            expect(runner.checkTaskWorkspaceSnapshot(task)).to.equal('unknown');

            fs.writeFileSync(tracked, 'changed by task\n', 'utf8');
            expect(await runner.hasTaskEdits(task)).to.equal(true);
            expect(runner.checkTaskWorkspaceSnapshot(checked)).to.equal('changed');
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('detects an untracked file created after the task starts', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-baseline-'));
        try {
            initRepo(cwd);
            fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'committed\n', 'utf8');
            runGit(cwd, 'add', 'tracked.txt');
            runGit(cwd, 'commit', '-m', 'initial');

            const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
            const baseline = runner.worktreeBaseline(cwd);
            if (!baseline.worktreeBaselineFingerprint) {
                throw new Error('Expected a worktree fingerprint.');
            }
            const task: QaapAgentTask = { ...TASK, cwd, ...baseline };
            fs.writeFileSync(path.join(cwd, 'created.txt'), 'new\n', 'utf8');
            expect(await runner.hasTaskEdits(task)).to.equal(true);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('detects content changes to an untracked file that existed before the task', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-baseline-'));
        try {
            initRepo(cwd);
            fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'committed\n', 'utf8');
            runGit(cwd, 'add', 'tracked.txt');
            runGit(cwd, 'commit', '-m', 'initial');
            const untracked = path.join(cwd, 'untracked.txt');
            fs.writeFileSync(untracked, 'before\n', 'utf8');

            const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
            const baseline = runner.worktreeBaseline(cwd);
            if (!baseline.worktreeBaselineFingerprint) {
                throw new Error('Expected a worktree fingerprint.');
            }
            const task: QaapAgentTask = { ...TASK, cwd, ...baseline };
            expect(await runner.hasTaskEdits(task)).to.equal(false);

            fs.writeFileSync(untracked, 'after!\n', 'utf8');
            expect(await runner.hasTaskEdits(task)).to.equal(true);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('fail-closed: when fingerprint cannot be re-read, porcelain baseline still ignores pre-existing dirty files', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-baseline-'));
        try {
            initRepo(cwd);
            const tracked = path.join(cwd, 'tracked.txt');
            fs.writeFileSync(tracked, 'committed\n', 'utf8');
            runGit(cwd, 'add', 'tracked.txt');
            runGit(cwd, 'commit', '-m', 'initial');
            fs.writeFileSync(tracked, 'dirty before task\n', 'utf8');

            const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
            const baseline = runner.worktreeBaseline(cwd);
            if (baseline.worktreeBaselineStatus === undefined) {
                throw new Error('Expected a porcelain baseline.');
            }
            // Simulate budget/git failure on the content fingerprint after the task started.
            Object.assign(runner, {
                captureWorktreeFingerprint: () => undefined,
            });

            const task: QaapAgentTask = { ...TASK, cwd, ...baseline };
            expect(await runner.hasTaskEdits(task)).to.equal(false);

            // Porcelain has no content hash: further edits to an already-dirty path stay invisible.
            // Path-level changes (new/deleted paths) are still detected — that is the degraded contract.
            fs.writeFileSync(tracked, 'changed by task\n', 'utf8');
            expect(await runner.hasTaskEdits(task)).to.equal(false);

            fs.writeFileSync(path.join(cwd, 'created-by-task.txt'), 'new\n', 'utf8');
            expect(await runner.hasTaskEdits(task)).to.equal(true);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('fail-closed: never falls back to bare dirty-check when a baseline status exists but git status dies', async () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        let porcelainProbes = 0;
        Object.assign(runner, {
            captureWorktreeFingerprint: () => undefined,
            captureWorktreeStatus: () => undefined,
            runGenericCommand: async () => {
                porcelainProbes++;
                return { exitCode: 0, stdout: ' M tracked.txt\n', stderr: '', timedOut: false };
            },
        });
        const task: QaapAgentTask = {
            ...TASK,
            worktreeBaselineFingerprint: 'deadbeef',
            worktreeBaselineStatus: ' M tracked.txt',
        };
        // A bare porcelain probe would return true; with a baseline we must not guess.
        expect(await runner.hasTaskEdits(task)).to.equal(false);
        expect(porcelainProbes).to.equal(0);
    });

    it('keeps independent baselines for parallel tasks in the same cwd', async () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-baseline-'));
        try {
            initRepo(cwd);
            fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'committed\n', 'utf8');
            runGit(cwd, 'add', 'tracked.txt');
            runGit(cwd, 'commit', '-m', 'initial');

            const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
            const baselineA = runner.worktreeBaseline(cwd);
            const baselineB = runner.worktreeBaseline(cwd);
            expect(baselineA.worktreeBaselineFingerprint).to.equal(baselineB.worktreeBaselineFingerprint);
            expect(baselineA.worktreeBaselineStatus).to.equal(baselineB.worktreeBaselineStatus);

            const taskA: QaapAgentTask = { ...TASK, id: 'a', cwd, ...baselineA };
            const taskB: QaapAgentTask = { ...TASK, id: 'b', cwd, ...baselineB };
            expect(await runner.hasTaskEdits(taskA)).to.equal(false);
            expect(await runner.hasTaskEdits(taskB)).to.equal(false);

            // Sibling edits in a shared cwd are visible to both baselines — documented contract.
            fs.writeFileSync(path.join(cwd, 'from-a.txt'), 'a\n', 'utf8');
            expect(await runner.hasTaskEdits(taskA)).to.equal(true);
            expect(await runner.hasTaskEdits(taskB)).to.equal(true);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe('QaapAgentTaskRunner process lifecycle', () => {

    it('reaps residual descendants after a bounded reviewer/helper command exits normally', async () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const child = new EventEmitter() as ChildProcess;
        Object.assign(child, {
            pid: 4242,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
        });
        Object.assign(runner, {
            residualProcessGroupReaps: 0,
            processes: new Map(),
            enforceAgentIsolationPolicy: () => undefined,
            ensureAgentCwdOwnership: () => undefined,
            spawnAgentCommand: () => child,
        });

        const resultPromise = runner.runGenericCommand('review', '/repo', {}, TASK.id, 1_000);
        child.emit('exit', 0);
        child.emit('close', 0);

        expect(await resultPromise).to.deep.include({ exitCode: 0, timedOut: false });
        expect(runner.residualProcessGroupReaps).to.equal(1);
    });

    it('retains only the latest bounded stdout/stderr for a noisy command', async () => {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = new EventEmitter() as ChildProcess;
        Object.assign(child, {
            pid: 4243,
            stdout,
            stderr,
        });
        Object.assign(runner, {
            residualProcessGroupReaps: 0,
            processes: new Map(),
            enforceAgentIsolationPolicy: () => undefined,
            ensureAgentCwdOwnership: () => undefined,
            spawnAgentCommand: () => child,
        });

        const maxCaptureChars = 80;
        const resultPromise = runner.runGenericCommand(
            'noisy-review',
            '/repo',
            {},
            TASK.id,
            1_000,
            { maxCaptureChars },
        );
        stdout.write('a'.repeat(200));
        stdout.end('latest-output');
        stderr.write('b'.repeat(200));
        stderr.end('latest-error');
        child.emit('exit', 0);
        child.emit('close', 0);

        const result = await resultPromise;
        expect(result.stdout.length).to.be.at.most(maxCaptureChars);
        expect(result.stderr.length).to.be.at.most(maxCaptureChars);
        expect(result.stdout).to.match(/^\.\.\.\[truncated\]\.\.\.\n/);
        expect(result.stderr).to.match(/^\.\.\.\[truncated\]\.\.\.\n/);
        expect(result.stdout).to.match(/latest-output$/);
        expect(result.stderr).to.match(/latest-error$/);
    });
});

/**
 * Drives `finishSuccessfulTaskAfterVerification` with a stubbed verification loop, capturing the
 * terminal state handed to `finishTask` — the blocking gate under test.
 */
function makeGateRunner(
    verify: () => Promise<QaapAgentTaskVerification | undefined>,
    overrides: Partial<Record<string, unknown>> = {},
): { runner: TestableQaapAgentTaskRunner; tasks: Map<string, QaapAgentTask>; finished: () => { state?: string; exitCode?: number } } {
    const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
    const tasks = new Map<string, QaapAgentTask>([[TASK.id, { ...TASK }]]);
    const finished: { state?: string; exitCode?: number } = {};
    Object.assign(runner, {
        tasks,
        activeVerificationPasses: 0,
        verificationPassWaiters: [],
        maxConcurrentVerificationPasses: () => 4,
        verifySuccessfulAgentTask: verify,
        reviewSuccessfulAgentTask: async () => undefined,
        finishTask: (id: string, state: string, exitCode: number | undefined) => {
            finished.state = state;
            finished.exitCode = exitCode;
            return tasks.get(id);
        },
        ...overrides,
    });
    return { runner, tasks, finished: () => finished };
}

describe('QaapAgentTaskRunner verification blocking gate', () => {

    it("finishes as 'completed_with_warnings' when verification failed", async () => {
        const { runner, tasks, finished } = makeGateRunner(async () =>
            ({ status: 'failed', command: 'npm run build', attempts: 2, summary: 'npm run build exited with code 1' }));
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed_with_warnings');
        expect(finished().exitCode).to.equal(0);
        expect(tasks.get(TASK.id)?.verification?.status).to.equal('failed');
    });

    it("finishes as 'completed' when verification passed", async () => {
        const { runner, tasks, finished } = makeGateRunner(async () =>
            ({ status: 'passed', command: 'npm run build', attempts: 0 }));
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed');
        expect(tasks.get(TASK.id)?.verification?.status).to.equal('passed');
    });

    it("finishes as 'completed' when verification was skipped (no edits / no scripts)", async () => {
        const { runner, tasks, finished } = makeGateRunner(async () => undefined);
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed');
        expect(tasks.get(TASK.id)?.verification).to.equal(undefined);
    });

    it("degrades to 'completed_with_warnings' when the verification pass itself crashes", async () => {
        const { runner, finished } = makeGateRunner(async () => {
            throw new Error('spawn ENOMEM');
        });
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed_with_warnings');
    });

    it('waits FIFO instead of completing without verification when the verification lane is full', async () => {
        const { runner, tasks, finished } = makeGateRunner(
            async () => ({ status: 'failed', command: 'npm run build', attempts: 2, summary: 'never called' }),
            { activeVerificationPasses: 4 },
        );
        const pending = runner.runGate(TASK, 0);
        await Promise.resolve();
        expect(finished().state).to.equal(undefined);
        expect(tasks.get(TASK.id)?.verification).to.equal(undefined);
        runner.releaseGateSlot();
        await pending;
        expect(finished().state).to.equal('completed_with_warnings');
        expect(tasks.get(TASK.id)?.verification?.status).to.equal('failed');
    });
});

describe('QaapAgentTaskRunner independent review gate', () => {

    it("closes as 'completed_with_warnings' when the reviewer rejects the change", async () => {
        const { runner, tasks, finished } = makeGateRunner(
            async () => ({ status: 'passed', command: 'npm run build', attempts: 0 }),
            { reviewSuccessfulAgentTask: async () => ({ status: 'failed', reason: 'scope creep', agentId: 'qaiq' }) },
        );
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed_with_warnings');
        expect(tasks.get(TASK.id)?.review).to.deep.equal({ status: 'failed', reason: 'scope creep', agentId: 'qaiq' });
    });

    it("stays 'completed' when the reviewer passes the change", async () => {
        const { runner, tasks, finished } = makeGateRunner(
            async () => undefined,
            { reviewSuccessfulAgentTask: async () => ({ status: 'passed', reason: 'matches the request', agentId: 'qaiq' }) },
        );
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed');
        expect(tasks.get(TASK.id)?.review?.status).to.equal('passed');
    });

    it("fails OPEN to 'completed' on an inconclusive review", async () => {
        const { runner, finished } = makeGateRunner(
            async () => undefined,
            { reviewSuccessfulAgentTask: async () => ({ status: 'inconclusive', reason: 'Reviewer timed out before emitting a verdict.' }) },
        );
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed');
    });

    it('skips the review entirely when verification already failed (no second agent spend)', async () => {
        let reviewCalls = 0;
        const { runner, finished } = makeGateRunner(
            async () => ({ status: 'failed', command: 'npm run build', attempts: 2, summary: 'red' }),
            { reviewSuccessfulAgentTask: async () => { reviewCalls++; return undefined; } },
        );
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed_with_warnings');
        expect(reviewCalls).to.equal(0);
    });

    it("degrades a crashing review pass to 'inconclusive' and still completes", async () => {
        const { runner, tasks, finished } = makeGateRunner(
            async () => undefined,
            { reviewSuccessfulAgentTask: async () => { throw new Error('spawn ENOMEM'); } },
        );
        await runner.runGate(TASK, 0);
        expect(finished().state).to.equal('completed');
        expect(tasks.get(TASK.id)?.review?.status).to.equal('inconclusive');
    });
});

describe('QaapAgentTaskRunner markTaskBlocked', () => {

    function makeBlockedRunner(state: QaapAgentTask['state']): { runner: TestableQaapAgentTaskRunner; tasks: Map<string, QaapAgentTask> } {
        const runner = Object.create(TestableQaapAgentTaskRunner.prototype) as TestableQaapAgentTaskRunner;
        const tasks = new Map<string, QaapAgentTask>([[TASK.id, { ...TASK, state }]]);
        Object.assign(runner, { tasks, persist: async () => undefined });
        return { runner, tasks };
    }

    it("reclassifies a delivered 'completed' task as 'blocked'", () => {
        const { runner, tasks } = makeBlockedRunner('completed');
        const result = runner.markTaskBlocked(TASK.id);
        expect(result?.state).to.equal('blocked');
        expect(tasks.get(TASK.id)?.state).to.equal('blocked');
    });

    it("reclassifies 'completed_with_warnings' too — blocked wins over the warning", () => {
        const { runner, tasks } = makeBlockedRunner('completed_with_warnings');
        expect(runner.markTaskBlocked(TASK.id)?.state).to.equal('blocked');
        expect(tasks.get(TASK.id)?.state).to.equal('blocked');
    });

    it('refuses to touch running, failed, or cancelled tasks', () => {
        for (const state of ['running', 'failed', 'cancelled'] as const) {
            const { runner, tasks } = makeBlockedRunner(state);
            expect(runner.markTaskBlocked(TASK.id)).to.equal(undefined);
            expect(tasks.get(TASK.id)?.state).to.equal(state);
        }
    });

    it('returns undefined for an unknown task id', () => {
        const { runner } = makeBlockedRunner('completed');
        expect(runner.markTaskBlocked('nope')).to.equal(undefined);
    });
});

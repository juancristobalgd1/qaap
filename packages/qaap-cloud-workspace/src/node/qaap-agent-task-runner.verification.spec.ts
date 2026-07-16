// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTask, QaapAgentTaskVerification } from '../common/qaap-agent-task';

type ScriptRun = { command: string; result: { exitCode: number; stdout: string; stderr: string; timedOut: boolean } } | undefined;

class TestableQaapAgentTaskRunner extends QaapAgentTaskRunner {
    public runVerify(task: QaapAgentTask): Promise<QaapAgentTaskVerification | undefined> {
        return this.verifySuccessfulAgentTask(task);
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

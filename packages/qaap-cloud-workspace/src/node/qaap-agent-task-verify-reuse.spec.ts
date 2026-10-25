// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { verifySuccessfulAgentTask, type VerifySuccessfulAgentTaskDeps } from './qaap-agent-task-runner-utils3';

const TASK: QaapAgentTask = {
    id: 't-reuse',
    title: 'edit files',
    command: 'qaiq --prompt "do work"',
    cwd: '/repo',
    state: 'running',
    createdAt: 0,
    agentId: 'qaiq',
};

const RED = { exitCode: 1, stdout: 'error TS2322', stderr: '', timedOut: false };
const GREEN = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

describe('qaap agent task verification reuse of passing scripts', () => {

    /** Fails `test` on the first run only; records the scripts each verification run actually executed. */
    function harness(options: { fingerprint?: boolean; fixChangesWorktree: boolean }): {
        runs: string[][];
        deps: VerifySuccessfulAgentTaskDeps;
    } {
        const runs: string[][] = [];
        let worktree = 'state-0';
        const deps: VerifySuccessfulAgentTaskDeps = {
            buildChildEnv: () => ({}),
            hasEditedFilesForVerification: async () => true,
            resolveVerificationScriptsForCwd: async () => ['compile', 'test'],
            isTaskStillRunning: () => true,
            runVerificationScripts: async (_task, _env, scripts) => {
                runs.push([...scripts]);
                if (runs.length === 1) {
                    return { command: 'npm run test', result: RED };
                }
                return undefined;
            },
            runAgentVerificationFixTurn: async () => {
                if (options.fixChangesWorktree) {
                    worktree = 'state-1';
                }
                return GREEN;
            },
            summarizeVerificationFailure: command => `${command} failed`,
            listWorktreeChanges: () => undefined,
            revertWorktreeChanges: () => [],
            ...(options.fingerprint === false ? {} : { fingerprintWorktree: () => worktree }),
        };
        return { runs, deps };
    }

    it('does not rerun a script that passed when the fix turn left the worktree unchanged', async () => {
        const { runs, deps } = harness({ fixChangesWorktree: false });
        const result = await verifySuccessfulAgentTask(TASK, deps);
        expect(result?.status).to.equal('passed');
        expect(runs).to.deep.equal([['compile', 'test'], ['test']]);
    });

    it('reruns every script once the fix turn changed the worktree', async () => {
        const { runs, deps } = harness({ fixChangesWorktree: true });
        const result = await verifySuccessfulAgentTask(TASK, deps);
        expect(result?.status).to.equal('passed');
        expect(runs).to.deep.equal([['compile', 'test'], ['compile', 'test']]);
    });

    it('reruns every script when the worktree fingerprint is unavailable', async () => {
        const { runs, deps } = harness({ fingerprint: false, fixChangesWorktree: false });
        const result = await verifySuccessfulAgentTask(TASK, deps);
        expect(result?.status).to.equal('passed');
        expect(runs).to.deep.equal([['compile', 'test'], ['compile', 'test']]);
    });
});

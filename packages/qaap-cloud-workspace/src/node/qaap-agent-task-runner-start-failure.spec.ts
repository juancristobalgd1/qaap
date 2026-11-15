// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import type { QaapAgentTask, QaapAgentTaskState } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { QaapAgentSignInRequiredError } from './qaap-agent-sign-in-preflight';
import { spawnProcessWhenReadyExtracted } from './qaap-agent-task-runner-timeline2';

const TASK_ID = 'task-start-failure-1';

interface StartHarness {
    readonly ctx: QaapAgentTaskRunnerContext;
    readonly tasks: Map<string, QaapAgentTask>;
    readonly logPath: string;
    readonly marks: string[];
    readonly spawnProcess: sinon.SinonStub;
    readonly task: QaapAgentTask;
    readonly request: QaapCreateAgentTaskRequest;
}

/**
 * The slice of the runner context the pre-spawn steps read. Everything after the agent command is built is
 * stubbed out: `spawnProcess` resolves without a child, so a success run stops right after the first mark.
 */
function createStartHarness(cwd: string, overrides: Partial<Record<string, unknown>> = {}): StartHarness {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-start-failure-'));
    const logPath = path.join(logDir, `${TASK_ID}.log`);
    const task: QaapAgentTask = {
        id: TASK_ID,
        title: 'do work',
        command: 'do work',
        cwd,
        state: 'running',
        createdAt: 0,
        agentId: 'qaiq',
        ownerLogin: 'alice',
    };
    const request = { cwd, prompt: 'do work', agent: 'qaiq' } as QaapCreateAgentTaskRequest;
    const tasks = new Map<string, QaapAgentTask>([[TASK_ID, task]]);
    const marks: string[] = [];
    const spawnProcess = sinon.stub().resolves(undefined);
    const ctx = {
        tasks,
        processes: new Map(),
        preferenceService: undefined,
        agentHooks: undefined,
        logPath: () => logPath,
        captureWorktreeBaseline: () => ({}),
        persist: () => Promise.resolve(),
        finishTask: (id: string, state: QaapAgentTaskState) => {
            const current = tasks.get(id);
            if (current) {
                tasks.set(id, { ...current, state });
            }
            return tasks.get(id);
        },
        stripLeadingAgentMention: (text: string) => text,
        recordTaskLatencyMark: (_id: string, mark: string) => { marks.push(mark); },
        resolveAgentModelForRequest: () => undefined,
        normalizeAgentId: (token: string | undefined) => token?.trim().toLowerCase() || undefined,
        awaitAgentSessionSettled: () => Promise.resolve(),
        buildAgentCommand: () => ({ command: 'qaiq run', agentId: 'qaiq' }),
        spawnProcess,
        ...overrides,
    } as unknown as QaapAgentTaskRunnerContext;
    return { ctx, tasks, logPath, marks, spawnProcess, task, request };
}

describe('spawnProcessWhenReadyExtracted (start failures before the first mark)', () => {
    let cwd: string;

    beforeEach(() => {
        cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-start-cwd-'));
    });

    afterEach(() => {
        fs.rmSync(cwd, { recursive: true, force: true });
        sinon.restore();
    });

    it('a step that throws before the agent command ends the task as failed with its stage and message', async () => {
        const harness = createStartHarness(cwd, {
            captureWorktreeBaseline: () => { throw new Error('git status exploded'); },
        });
        await spawnProcessWhenReadyExtracted(harness.ctx, harness.task, harness.request);

        expect(harness.tasks.get(TASK_ID)?.state).to.equal('failed');
        expect(fs.readFileSync(harness.logPath, 'utf8')).to.equal('Failed to start (worktree-baseline): git status exploded\n');
        expect(harness.marks).to.not.include('build_agent_command_start');
        expect(harness.spawnProcess.called).to.equal(false);
    });

    it('a preference service that never becomes ready fails the task with the timed-out message', async () => {
        const harness = createStartHarness(cwd, {
            preferenceService: { ready: new Promise<void>(() => undefined) },
            taskStartStepTimeoutMs: 20,
        });
        await spawnProcessWhenReadyExtracted(harness.ctx, harness.task, harness.request);

        expect(harness.tasks.get(TASK_ID)?.state).to.equal('failed');
        expect(fs.readFileSync(harness.logPath, 'utf8')).to.equal('Failed to start (preferences): timed out after 20ms\n');
        expect(harness.spawnProcess.called).to.equal(false);
    });

    it('a cancel that lands while the start waits keeps the cancelled state and writes no failure', async () => {
        const harness = createStartHarness(cwd, {
            preferenceService: { ready: new Promise<void>(() => undefined) },
            taskStartStepTimeoutMs: 30,
        });
        const running = spawnProcessWhenReadyExtracted(harness.ctx, harness.task, harness.request);
        await new Promise(resolve => setTimeout(resolve, 5));
        harness.tasks.set(TASK_ID, { ...harness.task, state: 'cancelled' });
        await running;

        expect(harness.tasks.get(TASK_ID)?.state).to.equal('cancelled');
        expect(fs.existsSync(harness.logPath)).to.equal(false);
    });

    it('refuses a Pro model whose harness is signed out: failed with the sign-in message, no spawn, marked sign_in_required', async () => {
        const refusal = new QaapAgentSignInRequiredError('Sign in to Codex to use gpt-5.5.', 'sign-in-required');
        const harness = createStartHarness(cwd, {
            preferenceService: { ready: Promise.resolve() },
            taskStartStepTimeoutMs: 1000,
            buildAgentCommand: () => { throw refusal; },
        });
        await spawnProcessWhenReadyExtracted(harness.ctx, harness.task, harness.request);

        expect(harness.spawnProcess.called).to.equal(false);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('failed');
        expect(harness.tasks.get(TASK_ID)?.preflightFailure).to.equal('sign_in_required');
        expect(fs.readFileSync(harness.logPath, 'utf8')).to.contain('Sign in to Codex to use gpt-5.5.');
    });

    it('a normal start passes every pre-spawn step, reaches the agent command and leaves the task running', async () => {
        const harness = createStartHarness(cwd, {
            preferenceService: { ready: Promise.resolve() },
            taskStartStepTimeoutMs: 1000,
        });
        await spawnProcessWhenReadyExtracted(harness.ctx, harness.task, harness.request);

        expect(harness.marks).to.include.members(['build_agent_command_start', 'build_agent_command_end']);
        expect(harness.spawnProcess.calledOnce).to.equal(true);
        expect(harness.tasks.get(TASK_ID)?.state).to.equal('running');
        expect(fs.existsSync(harness.logPath)).to.equal(false);
    });
});

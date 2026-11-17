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
import { assertAgentModelAccessExtracted, QaapAgentSignInRequiredError } from './qaap-agent-sign-in-preflight';
import { spawnProcessWhenReadyExtracted } from './qaap-agent-task-runner-timeline2';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { AgentCandidate } from './qaap-agent-task-runner-types';

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

    describe('a sign-in that is still checking when the task starts', () => {
        const proModel = { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.5', label: 'GPT 5.5' };

        /** A Codex start whose guard reads `snapshot`, which `settle` may change while the start waits. */
        function codexStart(settle: (snapshot: { connectionState: string; probeSettled: boolean }) => Promise<void>): StartHarness {
            const snapshot = { connectionState: 'unknown', probeSettled: false };
            const harness: StartHarness = createStartHarness(cwd, {
                preferenceService: { ready: Promise.resolve() },
                taskStartStepTimeoutMs: 1000,
                detectedAgents: new Map<string, AgentCandidate>([['codex', { id: 'codex', label: 'Codex', bin: 'codex', template: 'codex {prompt}' }]]),
                isAgentEnabled: () => true,
                agentConnectionSnapshot: () => ({ ...snapshot }),
                awaitAgentSessionSettled: () => settle(snapshot),
                // The real guard runs where buildAgentCommand runs it, after the sign-in wait.
                buildAgentCommand: () => {
                    assertAgentModelAccessExtracted(harness.ctx, 'codex', 'alice', proModel as never);
                    return { command: 'codex exec', agentId: 'codex' };
                },
            });
            return harness;
        }

        it('starts the Pro model when the probe answers signed-in within the budget', async () => {
            const harness = codexStart(async snapshot => {
                await new Promise(resolve => setTimeout(resolve, 5));
                snapshot.connectionState = 'connected';
                snapshot.probeSettled = true;
            });
            await spawnProcessWhenReadyExtracted(harness.ctx, harness.task, { ...harness.request, agent: 'codex' });

            expect(harness.spawnProcess.calledOnce).to.equal(true);
            expect(harness.tasks.get(TASK_ID)?.state).to.equal('running');
            expect(harness.tasks.get(TASK_ID)?.preflightFailure).to.equal(undefined);
        });

        it('fails with a clear "try again" message when the probe is still checking after the budget', async () => {
            const harness = codexStart(() => Promise.resolve());
            await spawnProcessWhenReadyExtracted(harness.ctx, harness.task, { ...harness.request, agent: 'codex' });

            expect(harness.spawnProcess.called).to.equal(false);
            expect(harness.tasks.get(TASK_ID)?.state).to.equal('failed');
            expect(harness.tasks.get(TASK_ID)?.preflightFailure).to.equal('sign_in_required');
            expect(fs.readFileSync(harness.logPath, 'utf8')).to.contain("Couldn't confirm your sign-in to Codex; try again.");
        });
    });

    describe('QaapAgentTaskRunner.awaitAgentSessionSettled', () => {
        function runnerWithProbe(probe: Promise<string> | undefined): QaapAgentTaskRunner {
            const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(runner, { refreshAgentConnectionState: () => probe });
            return runner;
        }

        it('returns as soon as the in-flight probe answers', async () => {
            const startedAt = Date.now();
            await runnerWithProbe(new Promise(resolve => setTimeout(() => resolve('connected'), 5))).awaitAgentSessionSettled('codex', 'alice', 5_000);
            expect(Date.now() - startedAt).to.be.below(1_000);
        });

        it('stops waiting at the budget for a probe that never answers, and never rejects', async () => {
            const startedAt = Date.now();
            await runnerWithProbe(new Promise<string>(() => undefined)).awaitAgentSessionSettled('codex', 'alice', 20);
            expect(Date.now() - startedAt).to.be.within(15, 1_000);
            await runnerWithProbe(Promise.reject(new Error('probe crashed'))).awaitAgentSessionSettled('codex', 'alice', 20);
        });

        it('returns at once when nothing is in flight', async () => {
            await runnerWithProbe(undefined).awaitAgentSessionSettled('codex', 'alice', 60_000);
        });
    });
});

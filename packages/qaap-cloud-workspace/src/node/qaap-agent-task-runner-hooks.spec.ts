// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { applyPreTurnAgentHooks, createQaiqPreToolUseHookGate, fireStopAgentHook } from './qaap-agent-task-runner-hooks';

interface FakeHooks {
    decision?: { decision?: 'allow' | 'deny' | 'ask'; reason?: string };
    preTurn?: { blockedReason?: string; additionalContext?: string };
    stops: string[];
    hasHooks(): boolean;
    evaluatePreToolUse(): Promise<{ decision?: 'allow' | 'deny' | 'ask'; reason?: string }>;
    runPreTurn(): Promise<{ blockedReason?: string; additionalContext?: string }>;
    fireStop(context: unknown, state: string): void;
}

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('qaap-agent-task-runner-hooks', () => {

    let tempDir: string;
    let written: string[];
    let finished: Array<{ id: string; state: string }>;
    let scheduled: string[];
    let hooks: FakeHooks;
    let ctx: QaapAgentTaskRunnerContext;
    const task = { id: 't1', cwd: '/repo', ownerLogin: 'alice', state: 'running', autoApprove: true } as unknown as QaapAgentTask;
    const request: QaapQaiqPendingControlRequest = { requestId: 'r1', toolUseId: 'u1', toolName: 'Bash', toolInput: { command: 'ls' } };
    const logStream = { write: (): boolean => true } as unknown as fs.WriteStream;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-runner-hooks-'));
        written = [];
        finished = [];
        scheduled = [];
        hooks = {
            stops: [],
            hasHooks: () => true,
            evaluatePreToolUse: async () => hooks.decision ?? {},
            runPreTurn: async () => hooks.preTurn ?? {},
            fireStop: (_context, state) => hooks.stops.push(state),
        };
        const tasks = new Map([[task.id, task]]);
        ctx = {
            agentHooks: hooks,
            tasks,
            processes: new Map([[task.id, { stdin: { write: (line: string) => written.push(line) } }]]),
            pendingQaiqControlRequests: new Map(),
            conversationIdForTask: () => 'conv-1',
            logPath: (id: string) => path.join(tempDir, `${id}.log`),
            finishTask: (id: string, state: string) => {
                finished.push({ id, state });
                return undefined;
            },
            scheduleQueuedApprovalTimeout: (_taskId: string, pending: QaapQaiqPendingControlRequest) => scheduled.push(pending.requestId),
            observability: undefined,
        } as unknown as QaapAgentTaskRunnerContext;
    });

    afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    describe('PreToolUse gate', () => {
        const run = async (decision: FakeHooks['decision']): Promise<string[]> => {
            hooks.decision = decision;
            const refed: string[] = [];
            const gate = createQaiqPreToolUseHookGate(ctx, task, logStream, line => refed.push(line));
            expect(gate.screen(request, 'LINE')).to.equal(true);
            // A re-fed line is never screened twice.
            expect(gate.screen(request, 'LINE')).to.equal(false);
            await flush();
            return refed;
        };

        it('deny rejects with the hook reason', async () => {
            expect(await run({ decision: 'deny', reason: 'prod is frozen' })).to.deep.equal([]);
            const response = JSON.parse(written[0]).response.response;
            expect(response.behavior).to.equal('deny');
            expect(response.message).to.contain('prod is frozen');
        });

        it('allow approves', async () => {
            await run({ decision: 'allow' });
            expect(JSON.parse(written[0]).response.response.behavior).to.equal('allow');
        });

        it('allow still defers to the destructive-command guard', async () => {
            hooks.decision = { decision: 'allow' };
            const refed: string[] = [];
            const gate = createQaiqPreToolUseHookGate(ctx, task, logStream, line => refed.push(line));
            gate.screen({ ...request, requestId: 'r2', toolInput: { command: 'rm -rf /' } }, 'RM');
            await flush();
            expect(written).to.deep.equal([]);
            expect(refed).to.deep.equal(['RM']);
        });

        it('ask queues for the user', async () => {
            await run({ decision: 'ask' });
            expect(written).to.deep.equal([]);
            expect(ctx.pendingQaiqControlRequests.get('t1')).to.deep.equal([request]);
            expect(scheduled).to.deep.equal(['r1']);
        });

        it('no decision re-feeds the original line', async () => {
            expect(await run({})).to.deep.equal(['LINE']);
            expect(written).to.deep.equal([]);
        });

        it('a request cancelled while hooks run is dropped', async () => {
            hooks.decision = { decision: 'allow' };
            const gate = createQaiqPreToolUseHookGate(ctx, task, logStream, () => undefined);
            gate.screen(request, 'LINE');
            gate.cancel('r1');
            await flush();
            expect(written).to.deep.equal([]);
        });

        it('is a no-op without matching hooks', () => {
            hooks.hasHooks = () => false;
            expect(createQaiqPreToolUseHookGate(ctx, task, logStream, () => undefined).screen(request, 'LINE')).to.equal(false);
        });
    });

    describe('pre-turn', () => {
        it('appends hook context to the prompt', async () => {
            hooks.preTurn = { additionalContext: 'branch main' };
            const prompt = await applyPreTurnAgentHooks(ctx, task, 'do it', 'qaiq');
            expect(prompt).to.equal('do it\n\n<user-prompt-submit-hook>\nbranch main\n</user-prompt-submit-hook>');
        });

        it('a block fails the turn with the reason in the log', async () => {
            hooks.preTurn = { blockedReason: 'secret detected' };
            expect(await applyPreTurnAgentHooks(ctx, task, 'do it', undefined)).to.equal(undefined);
            expect(finished).to.deep.equal([{ id: 't1', state: 'failed' }]);
            expect(fs.readFileSync(path.join(tempDir, 't1.log'), 'utf8')).to.contain('secret detected');
        });

        it('shell tasks skip hooks', async () => {
            hooks.preTurn = { blockedReason: 'x' };
            expect(await applyPreTurnAgentHooks(ctx, task, 'ls', 'shell')).to.equal('ls');
        });
    });

    it('Stop fires only when a live task finishes', () => {
        fireStopAgentHook(ctx, task, 'running', 'completed');
        fireStopAgentHook(ctx, task, 'completed', 'completed');
        fireStopAgentHook(ctx, task, undefined, 'failed');
        expect(hooks.stops).to.deep.equal(['completed']);
    });
});

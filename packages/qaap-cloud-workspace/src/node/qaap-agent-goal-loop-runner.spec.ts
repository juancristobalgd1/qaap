// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentGoalLoopPhase, QaapAgentGoalLoopState } from '../common/qaap-agent-goal-loop';
import type { QaapAgentTask, QaapAgentTaskVerification } from '../common/qaap-agent-task';
import type { QaapGoalLoopTurnOutcome } from './qaap-agent-conversation-store-constants';
import type { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTaskRunner, QaapGenericCommandResult } from './qaap-agent-task-runner';
import {
    QAAP_AGENT_GOAL_LOOP_STALE_EXECUTING_MS,
    QaapAgentGoalLoopError,
    QaapAgentGoalLoopRunner,
    type QaapAgentGoalLoopTerminalEvent,
} from './qaap-agent-goal-loop-runner';

const CONVERSATION_ID = 'conv-1';

/** In-memory stand-in for the parts of the conversation store the runner uses. */
class FakeConversationStore {
    readonly conversations = new Map<string, QaapAgentConversation>();
    readonly phases: QaapAgentGoalLoopPhase[] = [];
    readonly posted: { content: string; iteration?: number }[] = [];
    readonly spawnCounts = new Map<string, number>();
    readonly onDidChange = new Emitter<unknown>().event;
    activeTaskIds: string[] = [];
    failNextPost = false;
    protected messageSequence = 0;

    get(id: string): QaapAgentConversation | undefined {
        return this.conversations.get(id);
    }

    whenReady(): Promise<void> {
        return Promise.resolve();
    }

    setGoalLoopHooks(): void { /* not needed: specs call handleTurnSettled directly */ }

    setGoalLoop(id: string, goalLoop: QaapAgentGoalLoopState | undefined): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const next = { ...conv, goalLoop };
        this.conversations.set(id, next);
        if (goalLoop && this.phases[this.phases.length - 1] !== goalLoop.phase) {
            this.phases.push(goalLoop.phase);
        }
        return next;
    }

    postUserMessage(
        id: string,
        content: string,
        turnAgentId?: string,
        _model?: unknown,
        _autoApprove?: boolean,
        _interactionModeId?: string,
        _approvalPolicyId?: string,
        _rules?: unknown,
        _latency?: unknown,
        internal?: { goalLoopIteration?: number },
    ): QaapAgentConversation {
        const conv = this.conversations.get(id)!;
        this.messageSequence += 1;
        const message: QaapAgentMessage = {
            id: `u${this.messageSequence}`,
            role: 'user',
            content,
            createdAt: Date.now(),
            turnAgentId: turnAgentId ?? conv.agentId,
            ...(internal?.goalLoopIteration ? { goalLoopIteration: internal.goalLoopIteration } : {}),
            ...(this.failNextPost ? { error: 'No API key configured.' } : {}),
        };
        this.posted.push({ content, iteration: internal?.goalLoopIteration });
        const next: QaapAgentConversation = {
            ...conv,
            status: this.failNextPost ? 'failed' : 'streaming',
            messages: [...conv.messages, message],
        };
        this.failNextPost = false;
        this.conversations.set(id, next);
        return next;
    }

    resolveLoopBudgetKey(_conv: QaapAgentConversation, userMessageId: string): string {
        return userMessageId;
    }

    hasLoopSpawnBudget(key: string): boolean {
        return (this.spawnCounts.get(key) ?? 0) < 4;
    }

    recordLoopSpawn(key: string): void {
        this.spawnCounts.set(key, (this.spawnCounts.get(key) ?? 0) + 1);
    }

    findTaskById(): QaapAgentTask | undefined {
        return undefined;
    }

    getActiveTaskIdsForConversation(): string[] {
        return this.activeTaskIds;
    }

    /** Simulates the agent run of the latest turn finishing. */
    settleLatestTurn(): string {
        const conv = this.conversations.get(CONVERSATION_ID)!;
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user')!;
        const agentReply: QaapAgentMessage = { id: `a-${lastUser.id}`, role: 'agent', content: 'Did some work.', createdAt: Date.now(), runUserMessageId: lastUser.id };
        this.conversations.set(CONVERSATION_ID, { ...conv, status: 'idle', messages: [...conv.messages, agentReply] });
        return lastUser.id;
    }
}

/** Stand-in for the task runner's verification and one-shot evaluator entry points. */
class FakeTaskRunner {
    scripts: string[] = ['test'];
    scriptResults: QaapGenericCommandResult[] = [];
    evaluatorReplies: Array<string | Error | Promise<string>> = [];
    evaluatorCalls: { prompt: string; taskKind?: string; agentModel?: unknown }[] = [];
    commands: string[] = [];

    async resolveVerificationScriptsForCwd(): Promise<string[]> {
        return this.scripts;
    }

    buildChildEnv(): NodeJS.ProcessEnv {
        return {};
    }

    async runGenericCommand(command: string): Promise<QaapGenericCommandResult> {
        this.commands.push(command);
        return this.scriptResults.shift() ?? { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    }

    summarizeVerificationFailure(command: string, result: QaapGenericCommandResult): string {
        return `${command} failed: ${result.stderr}`;
    }

    async runReadOnlyOneShotPrompt(options: { prompt: string; taskKind?: string; agentModel?: unknown }): Promise<string> {
        this.evaluatorCalls.push(options);
        const next = this.evaluatorReplies.shift();
        if (next instanceof Error) {
            throw next;
        }
        return next ?? '';
    }
}

const DONE = JSON.stringify({ done: true, confidence: 'high', reasoning: 'Everything works.', gaps: [] });
const GAPS = JSON.stringify({ done: false, confidence: 'medium', reasoning: 'Half done.', gaps: ['Add logout'] });

function task(id: string, verification?: QaapAgentTaskVerification, state: QaapAgentTask['state'] = 'completed'): QaapAgentTask {
    return {
        id,
        title: 't',
        command: 'qaiq',
        cwd: '/repo',
        state,
        createdAt: 0,
        startedAt: 1_000,
        finishedAt: 61_000,
        ...(verification ? { verification } : {}),
    };
}

describe('QaapAgentGoalLoopRunner', () => {
    let store: FakeConversationStore;
    let taskRunner: FakeTaskRunner;
    let runner: QaapAgentGoalLoopRunner;
    let terminal: QaapAgentGoalLoopTerminalEvent[];
    let taskSequence: number;

    beforeEach(() => {
        store = new FakeConversationStore();
        taskRunner = new FakeTaskRunner();
        store.conversations.set(CONVERSATION_ID, {
            id: CONVERSATION_ID,
            cwd: '/repo',
            agentId: 'claude',
            title: 'Login',
            status: 'idle',
            createdAt: 0,
            updatedAt: 0,
            messages: [],
            ownerLogin: 'octocat',
        });
        runner = Object.create(QaapAgentGoalLoopRunner.prototype) as QaapAgentGoalLoopRunner;
        const fields = runner as unknown as Record<string, unknown>;
        fields.store = store as unknown as QaapAgentConversationStore;
        fields.taskRunner = taskRunner as unknown as QaapAgentTaskRunner;
        fields.inFlight = new Set<string>();
        fields.terminalFired = new Set<string>();
        const emitter = new Emitter<QaapAgentGoalLoopTerminalEvent>();
        fields.onDidReachTerminalPhaseEmitter = emitter;
        terminal = [];
        emitter.event(event => terminal.push(event));
        taskSequence = 0;
    });

    function loop(): QaapAgentGoalLoopState {
        return store.get(CONVERSATION_ID)!.goalLoop!;
    }

    async function settle(outcome: QaapGoalLoopTurnOutcome = 'success', verification?: QaapAgentTaskVerification, detail?: string): Promise<void> {
        const userMessageId = store.settleLatestTurn();
        taskSequence += 1;
        await runner.handleTurnSettled({
            conversationId: CONVERSATION_ID,
            userMessageId,
            task: task(`task-${taskSequence}`, verification, outcome === 'cancelled' ? 'cancelled' : 'completed'),
            outcome,
            detail,
        });
    }

    it('starts by posting the goal as the first loop turn', () => {
        const state = runner.start(CONVERSATION_ID, { goal: '  Ship the login page  ' });
        expect(state).to.include({ phase: 'executing', goal: 'Ship the login page', iteration: 1, anchorUserMessageId: 'u1' });
        expect(state.budget.maxIterations).to.equal(8);
        expect(store.posted).to.deep.equal([{ content: 'Ship the login page', iteration: 1 }]);
    });

    it('posts the initial prompt when it differs from the goal', () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it', initialPrompt: 'Start with the form' });
        expect(store.posted[0].content).to.equal('Start with the form');
        expect(loop().goal).to.equal('Ship it');
    });

    it('rejects a start without a goal (400) or in plan mode (409)', () => {
        expect(() => runner.start(CONVERSATION_ID, { goal: ' ' })).to.throw(QaapAgentGoalLoopError).with.property('status', 400);
        store.conversations.set(CONVERSATION_ID, { ...store.get(CONVERSATION_ID)!, interactionModeId: 'plan' });
        expect(() => runner.start(CONVERSATION_ID, { goal: 'x' })).to.throw(QaapAgentGoalLoopError).with.property('status', 409);
        expect(() => runner.start('missing', { goal: 'x' })).to.throw(QaapAgentGoalLoopError).with.property('status', 404);
        expect(store.posted).to.have.length(0);
    });

    it('is blocked immediately when the first turn cannot start', () => {
        store.failNextPost = true;
        const state = runner.start(CONVERSATION_ID, { goal: 'x' });
        expect(state.phase).to.equal('blocked');
        expect(state.stopReason).to.contain('No API key configured.');
        expect(terminal).to.have.length(1);
    });

    it('walks executing → verifying → evaluating → completed when the evaluator says done', async () => {
        taskRunner.evaluatorReplies.push(DONE);
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle('success', { status: 'passed', command: 'npm run test', attempts: 0 });
        expect(store.phases).to.deep.equal(['executing', 'verifying', 'evaluating', 'completed']);
        expect(loop().lastVerify).to.include({ status: 'passed', command: 'npm run test' });
        expect(loop().lastEvaluation).to.include({ done: true, source: 'evaluator' });
        expect(loop().usage).to.deep.equal({ evaluatorCalls: 1, agentRuntimeMs: 60_000 });
        // The turn already verified itself: no second run of the scripts.
        expect(taskRunner.commands).to.deep.equal([]);
        expect(taskRunner.evaluatorCalls[0].taskKind).to.equal('review');
        expect(taskRunner.evaluatorCalls[0].agentModel).to.equal(undefined);
        expect(taskRunner.evaluatorCalls[0].prompt).to.contain('Ship it');
        expect(terminal.map(event => event.goalLoop.phase)).to.deep.equal(['completed']);
        expect(terminal[0].ownerLogin).to.equal('octocat');
    });

    it('re-prompts with the failing check when verify fails, without calling the evaluator', async () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle('success', { status: 'failed', command: 'npm run build', attempts: 2, summary: 'TS2345: bad type' });
        expect(taskRunner.evaluatorCalls).to.have.length(0);
        expect(loop()).to.include({ phase: 'executing', iteration: 2, currentTurnUserMessageId: 'u2' });
        expect(loop().lastVerify?.status).to.equal('failed');
        expect(store.posted[1].iteration).to.equal(2);
        expect(store.posted[1].content).to.contain('[Goal · verify failed] Iteration 2/8');
        expect(store.posted[1].content).to.contain('TS2345: bad type');
        expect(store.spawnCounts.get('u1')).to.equal(1);
    });

    it('runs the npm scripts itself when the turn did not verify', async () => {
        taskRunner.scripts = ['typecheck', 'test'];
        taskRunner.scriptResults.push({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
        taskRunner.scriptResults.push({ exitCode: 1, stdout: '', stderr: '1 failing', timedOut: false });
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle();
        expect(taskRunner.commands).to.deep.equal(['npm run typecheck', 'npm run test']);
        expect(loop().lastVerify).to.include({ status: 'failed', command: 'npm run test' });
        expect(store.posted[1].content).to.contain('1 failing');
    });

    it('starts the next iteration with the evaluator gaps', async () => {
        taskRunner.evaluatorReplies.push(`Checked.\n\`\`\`json\n${GAPS}\n\`\`\``, DONE);
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle();
        expect(loop()).to.include({ phase: 'executing', iteration: 2 });
        expect(store.posted[1].content).to.contain('[Goal · gaps remain]');
        expect(store.posted[1].content).to.contain('- Add logout');
        await settle();
        expect(loop().phase).to.equal('completed');
        expect(loop().usage.evaluatorCalls).to.equal(2);
    });

    it('re-prompts after a failed turn', async () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle('failed', undefined, 'The model provider returned 529.');
        expect(loop()).to.include({ phase: 'executing', iteration: 2 });
        expect(store.posted[1].content).to.contain('[Goal · turn failed]');
        expect(store.posted[1].content).to.contain('529');
    });

    it('ends blocked when the agent asks the user a question', async () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle('blocked', undefined, 'Which OAuth provider?');
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.contain('Which OAuth provider?');
    });

    it('ends blocked when the iteration budget is exhausted', async () => {
        taskRunner.evaluatorReplies.push(GAPS, GAPS);
        runner.start(CONVERSATION_ID, { goal: 'Ship it', budget: { maxIterations: 2 } });
        await settle();
        await settle();
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.match(/Iteration budget exhausted: 2/);
        expect(store.posted).to.have.length(2);
        expect(terminal).to.have.length(1);
    });

    it('ends blocked when the evaluator budget is exhausted', async () => {
        taskRunner.evaluatorReplies.push(GAPS);
        runner.start(CONVERSATION_ID, { goal: 'Ship it', budget: { maxIterations: 5, maxEvaluatorCalls: 1 } });
        await settle();
        await settle();
        expect(taskRunner.evaluatorCalls).to.have.length(1);
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.match(/Evaluator budget exhausted/);
    });

    it('ends blocked when the agent runtime budget is exhausted', async () => {
        taskRunner.evaluatorReplies.push(GAPS);
        runner.start(CONVERSATION_ID, { goal: 'Ship it', budget: { maxAgentRuntimeMs: 30_000 } });
        await settle();
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.match(/Agent runtime budget exhausted/);
    });

    it('ends blocked when the shared re-spawn budget of the settled turn is spent', async () => {
        taskRunner.evaluatorReplies.push(GAPS);
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        store.spawnCounts.set('u1', 4);
        await settle();
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.match(/Re-spawn budget/);
    });

    it('stays cancelled when cancelled mid-evaluation, and posts nothing more', async () => {
        let resolveEvaluator: (reply: string) => void = () => undefined;
        taskRunner.evaluatorReplies.push(new Promise<string>(resolve => { resolveEvaluator = resolve; }) as unknown as string);
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        const pending = settle();
        await new Promise(resolve => setImmediate(resolve));
        expect(loop().phase).to.equal('evaluating');
        runner.cancel(CONVERSATION_ID);
        resolveEvaluator(GAPS);
        await pending;
        expect(loop().phase).to.equal('cancelled');
        expect(loop().stopReason).to.equal('Stopped by the user.');
        expect(store.posted).to.have.length(1);
        expect(terminal.map(event => event.goalLoop.phase)).to.deep.equal(['cancelled']);
        // Cancelling a finished loop is a no-op.
        expect(runner.cancel(CONVERSATION_ID)?.phase).to.equal('cancelled');
    });

    it('ends cancelled when the loop turn itself is stopped', async () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle('cancelled');
        expect(loop().phase).to.equal('cancelled');
    });

    it('falls back to the verify-only verdict when the evaluator reply is unparseable', async () => {
        taskRunner.evaluatorReplies.push('Looks complete to me!');
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle('success', { status: 'passed', command: 'npm run test', attempts: 0 });
        expect(loop().phase).to.equal('completed');
        expect(loop().lastEvaluation).to.include({ done: true, confidence: 'low', source: 'fallback' });
    });

    it('ends blocked when the evaluator fails and there are no checks to fall back on', async () => {
        taskRunner.scripts = [];
        taskRunner.evaluatorReplies.push(new Error('Agent exited with code 1.'));
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        await settle();
        expect(loop().lastVerify?.status).to.equal('skipped');
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.contain('Agent exited with code 1.');
    });

    it('ignores the settlement of a turn that is no longer the newest', async () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        const loopTurn = store.settleLatestTurn();
        store.postUserMessage(CONVERSATION_ID, 'User follow-up');
        await runner.handleTurnSettled({ conversationId: CONVERSATION_ID, userMessageId: loopTurn, task: task('t1'), outcome: 'success' });
        expect(loop().phase).to.equal('executing');
        expect(loop().usage.agentRuntimeMs).to.equal(60_000);
        expect(taskRunner.evaluatorCalls).to.have.length(0);
    });

    it('waits for a user follow-up that started while the loop was evaluating', async () => {
        let resolveEvaluator: (reply: string) => void = () => undefined;
        taskRunner.evaluatorReplies.push(new Promise<string>(resolve => { resolveEvaluator = resolve; }) as unknown as string, DONE);
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        const pending = settle();
        await new Promise(resolve => setImmediate(resolve));
        store.postUserMessage(CONVERSATION_ID, 'Also add a logout button');
        resolveEvaluator(GAPS);
        await pending;
        expect(loop()).to.include({ phase: 'executing', iteration: 1, currentTurnUserMessageId: undefined });
        expect(store.posted.map(post => post.content)).to.deep.equal(['Ship it', 'Also add a logout button']);
        await settle();
        expect(loop().phase).to.equal('completed');
    });

    it('sweeps loops past their wall clock and loops whose turn vanished', () => {
        runner.start(CONVERSATION_ID, { goal: 'Ship it', budget: { maxDurationMs: 10_000 } });
        runner.sweep(loop().startedAt + 10_000);
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.match(/Time budget exhausted/);

        store.conversations.set(CONVERSATION_ID, { ...store.get(CONVERSATION_ID)!, goalLoop: undefined, status: 'idle' });
        runner.start(CONVERSATION_ID, { goal: 'Ship it' });
        store.settleLatestTurn();
        store.activeTaskIds = [];
        runner.sweep(loop().updatedAt + QAAP_AGENT_GOAL_LOOP_STALE_EXECUTING_MS - 1);
        expect(loop().phase).to.equal('executing');
        runner.sweep(loop().updatedAt + QAAP_AGENT_GOAL_LOOP_STALE_EXECUTING_MS);
        expect(loop().phase).to.equal('blocked');
        expect(loop().stopReason).to.match(/without reporting an outcome/);
    });
});

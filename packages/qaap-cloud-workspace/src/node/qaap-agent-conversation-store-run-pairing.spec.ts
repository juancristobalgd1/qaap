// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Backend half of the run-pairing guard: an agent message must record WHICH run
// produced it (`runUserMessageId`), because its position in the array cannot say
// so once a session runs several agents at once.
//
// An agent message is created lazily, on its run's first output. A user who posts
// A and then B before A has produced anything leaves `[userA, userB, agentA,
// agentB]` — so the consumer-side walk-back (resolveRunUserMessageId) would pair
// agentA with userB. See the mobile-shell counterpart in
// qaap-run-turn-pairing.spec.ts.
//
// Production no longer spawns same-tree peer runs via deliveryMode `'parallel'`
// (HTTP isolates into a worktree, otherwise the store queues). These specs still
// exercise the store's sealing path by registering concurrent task refs directly.
//
// Same lightweight harness as the neighbouring -parallel-runs spec: disk/SSE/
// watchdog stubbed out, a fake task runner, no Inversify container.

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapConversationTaskRef } from './qaap-agent-conversation-store-constants';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** A plain-text agent: no AG-UI/NDJSON stream, so output lands on the simple lazy-append path. */
const PLAIN_AGENT_ID = 'shell';

class TestTaskRunner extends QaapAgentTaskRunner {
    private nextId = 1;

    override normalizeAgentId(token: string | undefined): string | undefined {
        const normalized = token?.trim().toLowerCase();
        return normalized === PLAIN_AGENT_ID || normalized === 'qaiq' ? normalized : undefined;
    }

    override create(): QaapAgentTask {
        return { id: `task-${this.nextId++}`, state: 'running' } as unknown as QaapAgentTask;
    }

    override cancel(): QaapAgentTask | undefined {
        return undefined;
    }

    override list(): QaapAgentTask[] {
        return [];
    }

    protected override async persist(): Promise<void> { /* no-op */ }
}

class TestConversationStore extends QaapAgentConversationStore {

    readonly wireUpdates: Array<{
        readonly agentId: string;
        readonly messageId: string;
        readonly forceFullMessage: boolean;
    }> = [];

    private testTaskRunner: TestTaskRunner | undefined;

    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* no-op */ }
    protected override startTurnWatchdog(): void { /* no-op */ }

    protected override captureGitSha(): string | undefined {
        return undefined;
    }

    protected override captureCheckpoint(): undefined {
        return undefined;
    }

    protected override fireAgentMessageWireUpdate(
        _conversationId: string,
        _cwd: string,
        agentId: string,
        message: QaapAgentMessage,
        options?: { forceFullMessage?: boolean },
    ): void {
        this.wireUpdates.push({
            agentId,
            messageId: message.id,
            forceFullMessage: options?.forceFullMessage === true,
        });
    }

    configureForTest(taskRunner: TestTaskRunner): void {
        this.testTaskRunner = taskRunner;
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE fanout */ });
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
    }

    seed(conv: QaapAgentConversation): void {
        (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.set(conv.id, conv);
    }

    /**
     * Register a concurrent peer run in the same conversation without going through
     * postUserMessage's delivery-mode gate (which now queues `'parallel'` follow-ups).
     */
    forcePeerRun(content: string, agentId: string): QaapAgentConversation {
        const conversations = (this as unknown as {
            conversations: Map<string, QaapAgentConversation>;
        }).conversations;
        const conv = conversations.get('c1')!;
        const userMessage: QaapAgentMessage = {
            id: randomUUID(),
            role: 'user',
            content,
            createdAt: Date.now(),
            turnAgentId: agentId,
        };
        const task = this.testTaskRunner!.create();
        const sealedUser: QaapAgentMessage = { ...userMessage, taskId: task.id, turnAgentId: agentId };
        const next: QaapAgentConversation = {
            ...conv,
            agentId,
            status: 'streaming',
            updatedAt: Date.now(),
            messages: [...conv.messages, sealedUser],
        };
        conversations.set('c1', next);
        (this as unknown as { taskToConversation: Map<string, QaapConversationTaskRef> })
            .taskToConversation.set(task.id, {
                conversationId: 'c1',
                userMessageId: sealedUser.id,
                turnAgentId: agentId,
            });
        return next;
    }

    /** Drives the stdout path the task runner normally invokes for a live run. */
    streamOutput(taskId: string, chunk: string): void {
        const ref = (this as unknown as {
            taskToConversation: Map<string, QaapConversationTaskRef>;
        }).taskToConversation.get(taskId)!;
        (this as unknown as {
            applyTaskOutput: (t: string, r: unknown, c: string) => void;
        }).applyTaskOutput(taskId, ref, chunk);
    }

    /** Drives the task-outcome path (normally invoked by the task runner's events). */
    async settleRun(taskId: string, task: QaapAgentTask): Promise<void> {
        const ref = (this as unknown as {
            taskToConversation: Map<string, QaapConversationTaskRef>;
        }).taskToConversation.get(taskId)!;
        await (this as unknown as {
            applyTaskOutcome: (r: unknown, t: QaapAgentTask) => Promise<void>;
        }).applyTaskOutcome(ref, task);
    }

    runRef(taskId: string): QaapConversationTaskRef {
        return (this as unknown as {
            taskToConversation: Map<string, QaapConversationTaskRef>;
        }).taskToConversation.get(taskId)!;
    }
}

function idleConversation(id: string): QaapAgentConversation {
    const now = Date.now();
    return {
        id,
        cwd: '/tmp/project',
        agentId: PLAIN_AGENT_ID,
        title: 'Session',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        messages: [],
    };
}

/** First turn via the real post path; later turns via forcePeerRun (concurrent refs). */
function postConcurrentMessage(store: TestConversationStore, content: string, agentId: string): QaapAgentConversation {
    const active = store.getActiveTaskIdsForConversation('c1');
    if (active.length === 0) {
        return store.postUserMessage('c1', content, agentId);
    }
    return store.forcePeerRun(content, agentId);
}

describe('QaapAgentConversationStore run pairing across concurrent runs', () => {

    function createStore(): TestConversationStore {
        const store = new TestConversationStore();
        store.configureForTest(new TestTaskRunner());
        store.seed(idleConversation('c1'));
        return store;
    }

    function userIds(store: TestConversationStore): string[] {
        return store.get('c1')!.messages.filter(message => message.role === 'user').map(message => message.id);
    }

    it('seals the driving run onto an agent message whose run started FIRST but spoke SECOND', () => {
        const store = createStore();
        postConcurrentMessage(store, 'run A', PLAIN_AGENT_ID);
        postConcurrentMessage(store, 'run B', PLAIN_AGENT_ID);
        const [userA, userB] = userIds(store);

        // B produces output before A does — the array ends up interleaved.
        store.streamOutput('task-2', 'B is working');
        store.streamOutput('task-1', 'A is working');

        const messages = store.get('c1')!.messages;
        expect(messages.map(message => message.role), 'both agent messages are appended after both user messages')
            .to.deep.equal(['user', 'user', 'agent', 'agent']);

        const agentForB = messages[2];
        const agentForA = messages[3];
        expect(agentForB.content).to.contain('B is working');
        expect(agentForA.content).to.contain('A is working');
        // The positional walk-back would give BOTH of these `userB`.
        expect(agentForB.runUserMessageId).to.equal(userB);
        expect(agentForA.runUserMessageId).to.equal(userA);
    });

    it('keeps the link across later chunks of the same run', () => {
        const store = createStore();
        postConcurrentMessage(store, 'run A', PLAIN_AGENT_ID);
        postConcurrentMessage(store, 'run B', PLAIN_AGENT_ID);
        const [userA] = userIds(store);

        store.streamOutput('task-1', 'first chunk ');
        store.streamOutput('task-2', 'peer output');
        store.streamOutput('task-1', 'second chunk');

        const agentForA = store.get('c1')!.messages.find(message => message.runUserMessageId === userA);
        expect(agentForA?.content).to.contain('second chunk');
    });

    it('links the failure message of a run that died before producing any output', async () => {
        const store = createStore();
        postConcurrentMessage(store, 'run A', PLAIN_AGENT_ID);
        postConcurrentMessage(store, 'run B', PLAIN_AGENT_ID);
        const [userA] = userIds(store);

        await store.settleRun('task-1', { id: 'task-1', state: 'failed' } as QaapAgentTask);

        const failed = store.get('c1')!.messages.filter(message => message.role === 'agent');
        expect(failed, 'exactly one agent message so far — run B has not spoken').to.have.length(1);
        expect(failed[0].error, 'the message carries the failure').to.be.a('string');
        expect(failed[0].runUserMessageId, 'a failed run is attributed to its own turn').to.equal(userA);
    });

    it('keeps each run parser bound to its sealed agent after a peer changes the conversation picker', () => {
        const store = createStore();
        postConcurrentMessage(store, 'plain run', PLAIN_AGENT_ID);
        postConcurrentMessage(store, 'structured peer', 'qaiq');
        const [plainUser] = userIds(store);

        // The conversation-level picker now says QAIQ. This chunk still belongs to shell and must
        // take the plain-text path instead of being fed to QAIQ's AG-UI/NDJSON emitter.
        store.streamOutput('task-1', 'plain shell reply');

        const plainReply = store.get('c1')!.messages.find(message => message.runUserMessageId === plainUser);
        expect(store.runRef('task-1').turnAgentId).to.equal(PLAIN_AGENT_ID);
        expect(plainReply?.content).to.contain('plain shell reply');
    });

    it('finalizes and publishes the settled run instead of the peer message at the array tail', async () => {
        const store = createStore();
        postConcurrentMessage(store, 'run A', PLAIN_AGENT_ID);
        postConcurrentMessage(store, 'run B', PLAIN_AGENT_ID);
        const [userA, userB] = userIds(store);
        store.streamOutput('task-1', 'A output');
        store.streamOutput('task-2', 'B output');
        const agentA = store.get('c1')!.messages.find(message => message.runUserMessageId === userA)!;
        const agentB = store.get('c1')!.messages.find(message => message.runUserMessageId === userB)!;
        store.wireUpdates.length = 0;

        await store.settleRun('task-1', { id: 'task-1', state: 'completed' } as QaapAgentTask);

        expect(store.wireUpdates).to.deep.equal([{
            agentId: PLAIN_AGENT_ID,
            messageId: agentA.id,
            forceFullMessage: true,
        }]);
        const settled = store.get('c1')!;
        expect(settled.messages.find(message => message.id === agentA.id)?.runActive).to.equal(undefined);
        expect(settled.messages.find(message => message.id === agentB.id)?.runActive).to.equal(true);
    });

    describe('AG-UI transcript events', () => {

        /** The agents that actually stream AG-UI events (QAIQ, Claude, Codex…). */
        const AG_UI_AGENT_ID = 'qaiq';

        function agUiSession(): TestConversationStore {
            const store = new TestConversationStore();
            store.configureForTest(new TestTaskRunner());
            store.seed({ ...idleConversation('c1'), agentId: AG_UI_AGENT_ID });
            postConcurrentMessage(store, 'run A', AG_UI_AGENT_ID);
            postConcurrentMessage(store, 'run B', AG_UI_AGENT_ID);
            return store;
        }

        /** Names of the tool calls recorded on an agent message's trace, in order. */
        function toolNames(message: QaapAgentMessage | undefined): string[] {
            return (message?.traceEvents ?? [])
                .filter(event => event.type === 'tool_call')
                .map(event => event.name);
        }

        function toolCall(store: TestConversationStore, taskId: string, toolCallId: string, toolCallName: string): void {
            store.applyAgUiTranscriptEvent('c1', { type: 'TOOL_CALL_START', toolCallId, toolCallName }, store.runRef(taskId));
        }

        it('gives each concurrent run its own agent message instead of merging them into one', () => {
            const store = agUiSession();
            const [userA, userB] = userIds(store);

            toolCall(store, 'task-1', 'a-1', 'Read');
            toolCall(store, 'task-2', 'b-1', 'Bash');
            toolCall(store, 'task-1', 'a-2', 'Edit');

            const agents = store.get('c1')!.messages.filter(message => message.role === 'agent');
            expect(agents, 'two runs, two agent messages').to.have.length(2);

            const forA = agents.find(message => message.runUserMessageId === userA);
            const forB = agents.find(message => message.runUserMessageId === userB);
            expect(forA, 'run A owns a message').to.not.equal(undefined);
            expect(forB, 'run B owns a message').to.not.equal(undefined);

            // Resolving the target from the array tail put every run's tools on one message.
            expect(toolNames(forA), 'run A keeps only its own tool calls').to.deep.equal(['Read', 'Edit']);
            expect(toolNames(forB), 'run B keeps only its own tool calls').to.deep.equal(['Bash']);
        });

        it('writes the message it creates back onto the run, so the two never swap targets', () => {
            const store = agUiSession();

            toolCall(store, 'task-1', 'a-1', 'Read');
            toolCall(store, 'task-2', 'b-1', 'Bash');

            const first = store.runRef('task-1').agentMessageId;
            const second = store.runRef('task-2').agentMessageId;
            expect(first, 'run A learned its agent message').to.be.a('string');
            expect(second, 'run B learned its own, different one').to.be.a('string');
            expect(first).to.not.equal(second);
        });

        it('recovers a run whose agent message id was lost (backend restart) from the sealed link', () => {
            const store = agUiSession();
            toolCall(store, 'task-1', 'a-1', 'Read');
            const original = store.runRef('task-1').agentMessageId;

            // The ref is in-memory only; the sealed runUserMessageId is what survives on disk.
            const ref = store.runRef('task-1') as { agentMessageId?: string };
            ref.agentMessageId = undefined;
            toolCall(store, 'task-1', 'a-2', 'Edit');

            const agents = store.get('c1')!.messages.filter(message => message.role === 'agent');
            expect(agents, 'the run reuses its message rather than starting a second one').to.have.length(1);
            expect(agents[0].id).to.equal(original);
        });

        it('still falls back to the tail message when there is no run context (external event route)', () => {
            const store = agUiSession();
            toolCall(store, 'task-1', 'a-1', 'Read');

            store.applyAgUiTranscriptEvent('c1', { type: 'TOOL_CALL_START', toolCallId: 'x-1', toolCallName: 'Grep' });

            const agents = store.get('c1')!.messages.filter(message => message.role === 'agent');
            expect(agents, 'no new message — the event joined the tail one, as before').to.have.length(1);
            expect(toolNames(agents[0])).to.deep.equal(['Read', 'Grep']);
        });

        it('uses the run agent for AG-UI reduction and wire deltas after the picker changes', () => {
            const store = new TestConversationStore();
            store.configureForTest(new TestTaskRunner());
            store.seed({ ...idleConversation('c1'), agentId: AG_UI_AGENT_ID });
            postConcurrentMessage(store, 'AG-UI run', AG_UI_AGENT_ID);
            postConcurrentMessage(store, 'plain peer', PLAIN_AGENT_ID);

            const agUiTaskId = store.runRef('task-1').turnAgentId === AG_UI_AGENT_ID ? 'task-1' : 'task-2';
            expect(store.runRef(agUiTaskId).turnAgentId).to.equal(AG_UI_AGENT_ID);
            toolCall(store, agUiTaskId, 'a-1', 'Read');

            expect(store.wireUpdates.at(-1)?.agentId).to.equal(AG_UI_AGENT_ID);
        });
    });
});

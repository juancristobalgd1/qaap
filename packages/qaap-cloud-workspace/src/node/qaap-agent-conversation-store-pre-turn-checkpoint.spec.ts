// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation, QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import {
    capturePreTurnCheckpointGate,
    publishDiscardCheckpointAfterExit,
    resolveDiscardCheckpointId,
} from './qaap-agent-conversation-store-pre-turn-checkpoint';
import { nextRetryAttempt, retryExtracted } from './qaap-agent-conversation-store-render2';
import {
    awaitQaapAgentTaskSpawnGate,
    registerQaapAgentTaskSpawnGate,
    waitForQaapAgentTaskProcessesExit,
} from './qaap-agent-task-spawn-gate';

const CHECKPOINT: QaapConversationCheckpoint = {
    id: 'ck-pre',
    messageId: 'u2',
    label: 'Before: fix it',
    commit: 'abc123',
    ref: 'refs/qaap/checkpoints/c1/u2-1',
    capturedAt: 10,
};

function conversation(overrides: Partial<QaapAgentConversation> = {}): QaapAgentConversation {
    return {
        id: 'c1',
        cwd: '/repo',
        agentId: 'qaiq',
        title: 'T',
        status: 'idle',
        createdAt: 0,
        updatedAt: 0,
        messages: [
            { id: 'u1', role: 'user', content: 'first', createdAt: 1, taskId: 't1' },
            { id: 'a1', role: 'agent', content: 'done', createdAt: 2, runUserMessageId: 'u1' },
            { id: 'u2', role: 'user', content: 'fix it', createdAt: 3, taskId: 't2' },
            { id: 'a2', role: 'agent', content: 'partial', createdAt: 4, runUserMessageId: 'u2' },
        ],
        ...overrides,
    };
}

interface FakeContext {
    readonly ctx: QaapAgentConversationStoreContext;
    readonly discardedRefs: string[];
    readonly fired: unknown[];
}

function fakeContext(
    conv: QaapAgentConversation,
    capture: () => Promise<QaapConversationCheckpoint | undefined>,
    waitForProcessExit: () => Promise<boolean> = async () => true,
): FakeContext {
    const conversations = new Map<string, QaapAgentConversation>([[conv.id, conv]]);
    const discardedRefs: string[] = [];
    const fired: unknown[] = [];
    const ctx = {
        conversations,
        checkpointLabel: (content: string) => content,
        runSerializedGit: <T>(_cwd: string, job: () => Promise<T>) => job(),
        captureCheckpoint: () => capture(),
        discardCheckpointRef: async (_cwd: string, ref: string) => { discardedRefs.push(ref); },
        persist: async () => undefined,
        fire: (event: unknown) => { fired.push(event); },
        taskRunner: { waitForProcessExit },
    } as unknown as QaapAgentConversationStoreContext;
    return { ctx, discardedRefs, fired };
}

describe('qaap pre-turn checkpoint', () => {

    it('records the snapshot as a pre-turn checkpoint before releasing the spawn gate', async () => {
        const { ctx, discardedRefs } = fakeContext(conversation(), async () => ({ ...CHECKPOINT }));
        await capturePreTurnCheckpointGate(ctx, 'c1', '/repo', { id: 'u2', content: 'fix it' }, 1_000);
        const checkpoints = ctx.conversations.get('c1')?.checkpoints ?? [];
        expect(checkpoints).to.have.length(1);
        expect(checkpoints[0].kind).to.equal('pre-turn');
        expect(discardedRefs).to.deep.equal([]);
    });

    it('releases the gate at the budget and drops a late snapshot', async () => {
        let resolveCapture: (checkpoint: QaapConversationCheckpoint) => void = () => undefined;
        const { ctx, discardedRefs } = fakeContext(conversation(), () => new Promise(resolve => { resolveCapture = resolve; }));
        await capturePreTurnCheckpointGate(ctx, 'c1', '/repo', { id: 'u2', content: 'fix it' }, 5);
        resolveCapture({ ...CHECKPOINT });
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(ctx.conversations.get('c1')?.checkpoints ?? []).to.deep.equal([]);
        expect(discardedRefs).to.deep.equal([CHECKPOINT.ref]);
    });

    it('never blocks the turn when the workspace cannot be snapshotted', async () => {
        const { ctx } = fakeContext(conversation(), async () => { throw new Error('not a git repository'); });
        await capturePreTurnCheckpointGate(ctx, 'c1', '/repo', { id: 'u2', content: 'fix it' }, 1_000);
        expect(ctx.conversations.get('c1')?.checkpoints).to.equal(undefined);
    });

    it('offers the discard checkpoint only for the latest, settled turn', () => {
        const conv = conversation({ checkpoints: [{ ...CHECKPOINT, kind: 'pre-turn' }] });
        expect(resolveDiscardCheckpointId(conv, 'u2')).to.equal('ck-pre');
        expect(resolveDiscardCheckpointId({ ...conv, status: 'streaming' }, 'u2')).to.equal(undefined);
        expect(resolveDiscardCheckpointId(conv, 'u1')).to.equal(undefined);
        expect(resolveDiscardCheckpointId({ ...conv, checkpoints: [{ ...CHECKPOINT }] }, 'u2')).to.equal(undefined);
    });

    it('publishes discardCheckpointId once the cancelled process exited', async () => {
        const { ctx, fired } = fakeContext(conversation({ checkpoints: [{ ...CHECKPOINT, kind: 'pre-turn' }] }), async () => undefined);
        await publishDiscardCheckpointAfterExit(ctx, 'c1', 'u2', ['t2']);
        expect(ctx.conversations.get('c1')?.discardCheckpointId).to.equal('ck-pre');
        expect(fired).to.have.length(1);
    });

    it('does not publish while the process is still alive at the deadline', async () => {
        const { ctx } = fakeContext(
            conversation({ checkpoints: [{ ...CHECKPOINT, kind: 'pre-turn' }] }),
            async () => undefined,
            async () => false,
        );
        await publishDiscardCheckpointAfterExit(ctx, 'c1', 'u2', ['t2']);
        expect(ctx.conversations.get('c1')?.discardCheckpointId).to.equal(undefined);
    });

    it('keeps rewinds on the prior turn result, never its pre-turn snapshot', () => {
        const post: QaapConversationCheckpoint = { ...CHECKPOINT, id: 'ck-u1-pre', messageId: 'u1', kind: 'pre-turn' };
        const plan = planConversationRewind(conversation({ checkpoints: [post] }), 'u2');
        expect(plan.restoreCheckpoint).to.equal(undefined);
    });
});

describe('qaap agent task spawn gate', () => {

    it('awaits the registered gate once, then forgets it', async () => {
        const request: QaapCreateAgentTaskRequest = { cwd: '/repo', prompt: 'go' };
        let released = false;
        registerQaapAgentTaskSpawnGate(request, { spawnGate: new Promise(resolve => setTimeout(() => { released = true; resolve(undefined); }, 5)) });
        await awaitQaapAgentTaskSpawnGate(request);
        expect(released).to.equal(true);
        await awaitQaapAgentTaskSpawnGate(request);
    });

    it('ignores a rejected gate', async () => {
        const request: QaapCreateAgentTaskRequest = { cwd: '/repo', prompt: 'go' };
        registerQaapAgentTaskSpawnGate(request, { spawnGate: Promise.reject(new Error('boom')) });
        await awaitQaapAgentTaskSpawnGate(request);
    });

    it('waits until no process is registered, or times out', async () => {
        const alive = new Set(['t1']);
        setTimeout(() => alive.delete('t1'), 10);
        expect(await waitForQaapAgentTaskProcessesExit(id => alive.has(id), ['t1'], 1_000, 2)).to.equal(true);
        expect(await waitForQaapAgentTaskProcessesExit(() => true, ['t1'], 10, 2)).to.equal(false);
        expect(await waitForQaapAgentTaskProcessesExit(() => false, ['t1'], 0)).to.equal(true);
    });
});

describe('qaap conversation retry attempt', () => {

    it('counts the original turn as attempt 1', () => {
        expect(nextRetryAttempt({})).to.equal(2);
        expect(nextRetryAttempt({ retryAttempt: 2 })).to.equal(3);
    });

    function retryContext(conv: QaapAgentConversation): {
        ctx: QaapAgentConversationStoreContext;
        calls: string[];
        posted: Array<{ content: string; internal: unknown }>;
    } {
        const conversations = new Map<string, QaapAgentConversation>([[conv.id, conv]]);
        const calls: string[] = [];
        const posted: Array<{ content: string; internal: unknown }> = [];
        const ctx = {
            conversations,
            getActiveTaskIdsForConversation: () => ['t2'],
            taskToConversation: new Map([['t2', { conversationId: 'c1', userMessageId: 'u2', agentMessageId: 'a2' }]]),
            taskRunner: {
                cancel: (taskId: string) => { calls.push(`cancel:${taskId}`); },
                list: () => [],
                waitForProcessExit: async (taskIds: readonly string[]) => { calls.push(`wait:${taskIds.join(',')}`); return true; },
            },
            appendRunCancelledTrace: (next: QaapAgentConversation) => next,
            finalizeStreamingAgentMessage: (next: QaapAgentConversation) => next,
            cancelGoalLoopOnConversation: (next: QaapAgentConversation) => next,
            publishFinalizedAgentMessage: () => undefined,
            fire: () => undefined,
            persist: async () => undefined,
            postUserMessage: (_id: string, content: string, _a?: unknown, _m?: unknown, _ap?: unknown, _im?: unknown, _pol?: unknown,
                _rules?: unknown, _marks?: unknown, internal?: unknown) => {
                calls.push('post');
                posted.push({ content, internal });
                return conversations.get('c1')!;
            },
        } as unknown as QaapAgentConversationStoreContext;
        return { ctx, calls, posted };
    }

    it('refuses to retry a streaming turn without force', async () => {
        const { ctx } = retryContext(conversation({ status: 'streaming' }));
        let error: unknown;
        try {
            await retryExtracted(ctx, 'c1');
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
    });

    it('force-retry cancels the live run, waits for its process, then re-posts with the next attempt', async () => {
        const base = conversation({ status: 'streaming' });
        const { ctx, calls, posted } = retryContext({
            ...base,
            messages: base.messages.map(message => message.id === 'u2' ? { ...message, retryAttempt: 2 } : message),
        });
        await retryExtracted(ctx, 'c1', { force: true });
        expect(calls).to.deep.equal(['cancel:t2', 'wait:t2', 'post']);
        expect(posted).to.deep.equal([{ content: 'fix it', internal: { retryAttempt: 3 } }]);
        // The cancelled turn (and its partial reply) is trimmed before the re-post.
        expect(ctx.conversations.get('c1')?.messages.map(message => message.id)).to.deep.equal(['u1', 'a1']);
    });
});

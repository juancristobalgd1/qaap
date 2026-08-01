// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** Records create()/cancel() instead of spawning real processes or touching ~/.qaap/agent-tasks. */
class TestTaskRunner extends QaapAgentTaskRunner {
    readonly created: QaapCreateAgentTaskRequest[] = [];
    throwOnCreate = false;
    seq = 0;

    override create(request: QaapCreateAgentTaskRequest, _ownerLogin?: string): QaapAgentTask {
        if (this.throwOnCreate) {
            throw new Error('cwd gone');
        }
        this.created.push(request);
        return { id: `resumed-task-${++this.seq}`, agentId: 'qaiq' } as unknown as QaapAgentTask;
    }

    override cancel(): QaapAgentTask | undefined {
        return undefined;
    }

    override list(): QaapAgentTask[] {
        return [];
    }

    protected override async persist(): Promise<void> {
        /* no-op */
    }
}

class TestConversationStore extends QaapAgentConversationStore {
    persistCount = 0;

    protected override async persist(): Promise<void> {
        this.persistCount++;
    }

    protected override async restoreFromDisk(): Promise<void> {
        /* tests seed conversations directly */
    }

    protected override startTurnWatchdog(): void {
        /* tests drive the sweep explicitly */
    }

    // Isolate the resume logic (counter, guards, persist-before-spawn, task wiring) from the details
    // of request reconstruction, which pulls in services not wired in a unit test.
    protected override buildTaskCreateRequest(conv: QaapAgentConversation): QaapCreateAgentTaskRequest {
        return { cwd: conv.cwd, prompt: 'resumed', agent: conv.agentId } as unknown as QaapCreateAgentTaskRequest;
    }

    configureForTest(taskRunner: QaapAgentTaskRunner): void {
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE */ });
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
    }

    seed(conv: QaapAgentConversation): void {
        (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.set(conv.id, conv);
    }

    resume(id: string, nowMs: number): Promise<boolean> {
        return (this as unknown as { maybeAutoResumeInterruptedTurn: (c: string, n: number) => Promise<boolean> })
            .maybeAutoResumeInterruptedTurn(id, nowMs);
    }

    sweepReset(nowMs: number): boolean {
        return (this as unknown as { sweepZombieStreamingTurns: (n: number, o: { resetSurvivorsToIdle: boolean }) => boolean })
            .sweepZombieStreamingTurns(nowMs, { resetSurvivorsToIdle: true });
    }
}

function streamingConversation(id: string, streamingSinceMs: number, overrides?: Partial<QaapAgentConversation>): QaapAgentConversation {
    return {
        id,
        cwd: '/tmp/project',
        agentId: 'qaiq',
        title: 'Interrupted turn',
        status: 'streaming',
        interactionModeId: 'agent',
        createdAt: streamingSinceMs,
        updatedAt: streamingSinceMs,
        messages: [
            { id: `${id}-u1`, role: 'user', content: 'do the thing', createdAt: streamingSinceMs, taskId: `${id}-task`, turnAgentId: 'qaiq' },
            { id: `${id}-a1`, role: 'agent', content: 'working…', createdAt: streamingSinceMs + 1000, runUserMessageId: `${id}-u1` },
        ],
        ...overrides,
    };
}

describe('QaapAgentConversationStore restart auto-resume', () => {
    const ENV = ['QAAP_AUTO_RESUME_TURNS', 'QAAP_MAX_RESTART_RESUMES'] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => ENV.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; }));
    afterEach(() => ENV.forEach(k => { if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; } }));

    it('auto-resumes an interrupted turn: spawns a new task and increments the persisted counter', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('c1', now - 3 * 60 * 1000));

        const handled = await store.resume('c1', now);

        expect(handled).to.be.true;
        expect(runner.created).to.have.length(1);
        const conv = store.get('c1')!;
        expect(conv.status).to.equal('streaming');
        const user = conv.messages.find(m => m.role === 'user')!;
        expect(user.restartResumeCount).to.equal(1);
        expect(user.taskId).to.equal('resumed-task-1'); // re-linked to the fresh task
        // The orphaned partial agent output is dropped so the re-run starts clean.
        expect(conv.messages.some(m => m.role === 'agent')).to.be.false;
    });

    it('stops resuming once the persisted per-turn budget is exhausted (bounded OOM loop)', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        // Default QAAP_MAX_RESTART_RESUMES = 1 → a turn already resumed once must not resume again.
        store.seed(streamingConversation('c2', now - 3 * 60 * 1000, {
            messages: [
                { id: 'c2-u1', role: 'user', content: 'do it', createdAt: now - 3 * 60 * 1000, taskId: 'c2-task', turnAgentId: 'qaiq', restartResumeCount: 1 },
                { id: 'c2-a1', role: 'agent', content: 'working…', createdAt: now - 3 * 60 * 1000 + 1000, runUserMessageId: 'c2-u1' },
            ],
        }));

        const handled = await store.resume('c2', now);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
    });

    it('does NOT auto-resume a turn paused on a human decision (request-approval)', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('c3', now - 3 * 60 * 1000, { approvalPolicyId: 'request-approval' }));

        const handled = await store.resume('c3', now);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
    });

    // Note: QAAP_AUTO_RESUME_TURNS (default ON) and QAAP_MAX_RESTART_RESUMES are read once at module
    // load (same pattern as QAAP_AGENT_AUTO_CONTINUE), so the backend picks them up at process start;
    // they can't be toggled mid-test after import, so there is no runtime-override spec here.

    it('persists the counter BEFORE spawning, and degrades to interrupted if the spawn fails', async () => {
        const runner = new TestTaskRunner();
        runner.throwOnCreate = true;
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('c5', now - 3 * 60 * 1000));

        const handled = await store.resume('c5', now);

        expect(handled).to.be.true; // handled (as interrupted) — the sweep must not double-handle it
        const conv = store.get('c5')!;
        expect(conv.status).to.equal('failed');
        // Counter reached disk before the failed spawn, so this turn won't be auto-retried again.
        const user = conv.messages.find(m => m.role === 'user')!;
        expect(user.restartResumeCount).to.equal(1);
        expect(store.persistCount).to.be.greaterThan(0);
    });

    it('sweep does not re-interrupt a turn that was just auto-resumed (live task guard)', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('c6', now - 3 * 60 * 1000));

        await store.resume('c6', now);
        store.sweepReset(now);

        // Resumed turn has a live task → left running, not interrupted.
        expect(store.get('c6')!.status).to.equal('streaming');
    });
});

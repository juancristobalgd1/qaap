// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Graph-governed twin of `qaap-agent-conversation-store-restart-resume.spec.ts` (ADR-002 piece 1).
 * With `QAAP_TURN_GRAPH=on`, every behavioural contract of the imperative auto-resume must hold
 * unchanged — same spawns, same projected counter, same guards, same degradation — while the
 * durable ledger of the transition moves into a `qaap.chat-turn` workflow run.
 */

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QAAP_CHAT_TURN_WORKFLOW_ID, buildChatTurnWorkflow } from '../common/qaap-chat-turn-workflow';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';

/** In-memory run store: mutations run the real reducer/persist ordering, disk writes are counted. */
class TestRunStore extends QaapWorkflowRunStore {
    persistCalls = 0;
    protected override async persist(): Promise<void> {
        this.persistCalls++;
    }
}

/** Records create()/cancel() instead of spawning; can snapshot state at the moment of the spawn. */
class TestTaskRunner extends QaapAgentTaskRunner {
    readonly created: QaapCreateAgentTaskRequest[] = [];
    throwOnCreate = false;
    onCreate?: () => void;
    seq = 0;

    override create(request: QaapCreateAgentTaskRequest, _ownerLogin?: string): QaapAgentTask {
        if (this.throwOnCreate) {
            throw new Error('cwd gone');
        }
        this.onCreate?.();
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

    protected override buildTaskCreateRequest(conv: QaapAgentConversation): QaapCreateAgentTaskRequest {
        return { cwd: conv.cwd, prompt: 'resumed', agent: conv.agentId } as unknown as QaapCreateAgentTaskRequest;
    }

    configureForTest(taskRunner: QaapAgentTaskRunner, runStore: QaapWorkflowRunStore): void {
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE */ });
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
        (this as unknown as { workflowRuns?: QaapWorkflowRunStore }).workflowRuns = runStore;
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

    reap(): Promise<void> {
        return (this as unknown as { reapOrphanedChatTurnRuns: () => Promise<void> }).reapOrphanedChatTurnRuns();
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

function chatTurnRuns(runs: QaapWorkflowRunStore): QaapPersistedWorkflowRun[] {
    return runs.list(undefined).filter(record => record.def.id === QAAP_CHAT_TURN_WORKFLOW_ID);
}

describe('QaapAgentConversationStore restart auto-resume via the chat-turn graph (QAAP_TURN_GRAPH=on)', () => {
    const ENV = ['QAAP_AUTO_RESUME_TURNS', 'QAAP_MAX_RESTART_RESUMES', 'QAAP_TURN_GRAPH'] as const;
    const saved: Record<string, string | undefined> = {};
    let runner: TestTaskRunner;
    let runStore: TestRunStore;
    let store: TestConversationStore;

    beforeEach(() => {
        ENV.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
        process.env.QAAP_TURN_GRAPH = 'on';
        runner = new TestTaskRunner();
        runStore = new TestRunStore();
        store = new TestConversationStore();
        store.configureForTest(runner, runStore);
    });
    afterEach(() => ENV.forEach(k => { if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; } }));

    it('auto-resumes as a resume:restart transition: same observables, durable run ledger', async () => {
        const now = Date.now();
        store.seed(streamingConversation('c1', now - 3 * 60 * 1000));
        let atSpawn: { visits?: number; runPersists: number; convPersists: number } | undefined;
        runner.onCreate = () => {
            const record = chatTurnRuns(runStore)[0];
            atSpawn = {
                visits: record?.run.visits.turn,
                runPersists: runStore.persistCalls,
                convPersists: store.persistCount,
            };
        };

        const handled = await store.resume('c1', now);

        // Contract of the imperative spec, unchanged:
        expect(handled).to.be.true;
        expect(runner.created).to.have.length(1);
        const conv = store.get('c1')!;
        expect(conv.status).to.equal('streaming');
        const user = conv.messages.find(m => m.role === 'user')!;
        expect(user.restartResumeCount).to.equal(1);
        expect(user.taskId).to.equal('resumed-task-1');
        expect(conv.messages.some(m => m.role === 'agent')).to.be.false;
        // The ledger of the transition is the run, persisted BEFORE the spawn:
        expect(atSpawn?.visits).to.equal(2);
        expect(atSpawn?.runPersists).to.be.greaterThan(0);
        expect(atSpawn?.convPersists).to.be.greaterThan(0);
        const record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('running');
        expect(record.run.visits.turn).to.equal(2);
        expect(record.dispatched.turn?.externalId).to.equal('resumed-task-1');
        expect(record.trace[record.trace.length - 1]?.outcome).to.equal('resume:restart');
    });

    it('stops resuming once the persisted per-turn budget is exhausted, before touching the graph', async () => {
        const now = Date.now();
        store.seed(streamingConversation('c2', now - 3 * 60 * 1000, {
            messages: [
                { id: 'c2-u1', role: 'user', content: 'do it', createdAt: now - 3 * 60 * 1000, taskId: 'c2-task', turnAgentId: 'qaiq', restartResumeCount: 1 },
                { id: 'c2-a1', role: 'agent', content: 'working…', createdAt: now - 3 * 60 * 1000 + 1000, runUserMessageId: 'c2-u1' },
            ],
        }));

        const handled = await store.resume('c2', now);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)).to.have.length(0);
    });

    it('does NOT auto-resume a turn paused on a human decision (request-approval)', async () => {
        const now = Date.now();
        store.seed(streamingConversation('c3', now - 3 * 60 * 1000, { approvalPolicyId: 'request-approval' }));

        const handled = await store.resume('c3', now);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)).to.have.length(0);
    });

    it('persists ledger and counter BEFORE spawning, and degrades to interrupted if the spawn fails', async () => {
        runner.throwOnCreate = true;
        const now = Date.now();
        store.seed(streamingConversation('c5', now - 3 * 60 * 1000));

        const handled = await store.resume('c5', now);

        expect(handled).to.be.true;
        const conv = store.get('c5')!;
        expect(conv.status).to.equal('failed');
        const user = conv.messages.find(m => m.role === 'user')!;
        expect(user.restartResumeCount).to.equal(1);
        expect(store.persistCount).to.be.greaterThan(0);
        // The run walked resume:restart and then the failure edge of the unstartable node.
        const record = chatTurnRuns(runStore)[0];
        expect(record.run.status).to.equal('failed');
        expect(record.run.bindings).to.have.property('turn.failed');
        expect(record.trace.map(entry => entry.outcome)).to.deep.equal(['resume:restart', 'fail']);
    });

    it('sweep does not re-interrupt a turn that was just auto-resumed (live task guard)', async () => {
        const now = Date.now();
        store.seed(streamingConversation('c6', now - 3 * 60 * 1000));

        await store.resume('c6', now);
        store.sweepReset(now);

        expect(store.get('c6')!.status).to.equal('streaming');
    });

    it('trusts the run ledger when it is stricter than the projection (belt and braces)', async () => {
        const now = Date.now();
        // Projection says 0 resumes, but a surviving run already spent the ceiling (visits 2 with
        // QAAP_MAX_RESTART_RESUMES default 1): the graph must refuse and settle its failure edge.
        store.seed(streamingConversation('c7', now - 3 * 60 * 1000));
        await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/tmp/project',
            inputs: { conversationId: 'c7', rootUserMessageId: 'c7-u1' },
            seedNodeId: 'turn',
            seedVisits: 2,
            deadExternalId: 'c7-task',
        });

        const handled = await store.resume('c7', now);

        expect(handled).to.be.false;
        expect(runner.created).to.have.length(0);
        expect(chatTurnRuns(runStore)[0].run.status).to.equal('failed');
    });

    it('re-adopts into a fresh run when the previous run of the root already settled', async () => {
        const now = Date.now();
        store.seed(streamingConversation('c8', now - 3 * 60 * 1000));
        const stale = await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/tmp/project',
            inputs: { conversationId: 'c8', rootUserMessageId: 'c8-u1' },
            seedNodeId: 'turn',
            seedVisits: 1,
        });
        await runStore.report(undefined, stale.run.id, 'turn', 'fail');

        const handled = await store.resume('c8', now);

        expect(handled).to.be.true;
        expect(runner.created).to.have.length(1);
        const records = chatTurnRuns(runStore);
        expect(records).to.have.length(2);
        expect(records.some(record => record.run.status === 'running')).to.be.true;
    });

    it('reaps a run whose conversation is no longer streaming (lost terminal report)', async () => {
        const now = Date.now();
        store.seed({ ...streamingConversation('c9', now), status: 'idle' });
        await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/tmp/project',
            inputs: { conversationId: 'c9', rootUserMessageId: 'c9-u1' },
            seedNodeId: 'turn',
            seedVisits: 1,
            deadExternalId: 'gone-task',
        });
        // A still-streaming conversation's run must survive the reap untouched.
        store.seed(streamingConversation('c10', now));
        await runStore.adoptRun(buildChatTurnWorkflow(), {
            cwd: '/tmp/project',
            inputs: { conversationId: 'c10', rootUserMessageId: 'c10-u1' },
            seedNodeId: 'turn',
            seedVisits: 1,
        });

        await store.reap();

        const byConversation = new Map(chatTurnRuns(runStore).map(record => [record.inputs.conversationId, record]));
        expect(byConversation.get('c9')?.run.status).to.equal('failed');
        expect(byConversation.get('c10')?.run.status).to.equal('running');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { toConversationSummary, type QaapAgentConversation, type QaapAgentConversationEvent } from '../common/qaap-agent-conversation';
import { createGoalLoopState, QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET } from '../common/qaap-agent-goal-loop';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapGoalLoopTurnSettlement } from './qaap-agent-conversation-store-constants';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

describe('QaapAgentConversationStore goal loop integration', () => {
    let store: QaapAgentConversationStore;
    let events: QaapAgentConversationEvent[];
    let settled: QaapGoalLoopTurnSettlement[];

    const loop = createGoalLoopState({ goal: 'Ship it', budget: QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET, anchorUserMessageId: 'u1', now: 1 });
    const base: QaapAgentConversation = {
        id: 'c1',
        cwd: '/repo',
        agentId: 'claude',
        title: 'Login',
        status: 'idle',
        createdAt: 0,
        updatedAt: 0,
        messages: [],
    };

    beforeEach(() => {
        store = Object.create(QaapAgentConversationStore.prototype) as QaapAgentConversationStore;
        events = [];
        settled = [];
        const fields = store as unknown as Record<string, unknown>;
        fields.conversations = new Map<string, QaapAgentConversation>();
        fields.taskToConversation = new Map();
        fields.fire = (event: QaapAgentConversationEvent): void => { events.push(event); };
        fields.persist = async (): Promise<void> => undefined;
        fields.flushPersist = (): void => undefined;
        fields.schedulePersist = (): void => undefined;
        fields.getActiveTaskIdsForConversation = (): string[] => [];
        store.setGoalLoopHooks({ onTurnSettled: reported => settled.push(reported) });
    });

    function settlement(): QaapGoalLoopTurnSettlement {
        return { conversationId: 'c1', userMessageId: 'u1', task: { id: 't1' } as QaapAgentTask, outcome: 'success' };
    }

    it('reports settled turns only while a loop is active (auto-continue precedence)', () => {
        store.conversations.set('c1', base);
        expect(store.notifyGoalLoopTurnSettled(settlement())).to.equal(false);
        expect(settled).to.have.length(0);

        store.conversations.set('c1', { ...base, goalLoop: loop });
        expect(store.notifyGoalLoopTurnSettled(settlement())).to.equal(true);
        expect(settled).to.have.length(1);
    });

    it('publishes goal loop changes and summary fields', () => {
        store.conversations.set('c1', base);
        store.setGoalLoop('c1', { ...loop, iteration: 3 });
        expect(events.map(event => event.type)).to.deep.equal(['goal_loop', 'updated']);
        const summary = toConversationSummary(store.get('c1')!);
        expect(summary).to.include({ goalLoopPhase: 'executing', goalLoopIteration: 3, goalLoopMaxIterations: 8 });
    });

    it('composer Stop cancels an active goal loop', () => {
        store.conversations.set('c1', { ...base, goalLoop: { ...loop, phase: 'evaluating' } });
        const next = store.cancel('c1')!;
        expect(next.goalLoop?.phase).to.equal('cancelled');
        expect(next.goalLoop?.stopReason).to.equal('Stopped by the user.');
        expect(events.some(event => event.type === 'goal_loop')).to.equal(true);
        expect(toConversationSummary(next).goalLoopStopReason).to.equal('Stopped by the user.');
    });

    it('leaves a finished goal loop untouched on Stop', () => {
        const finished = { ...loop, phase: 'completed' as const };
        store.conversations.set('c1', { ...base, goalLoop: finished });
        expect(store.cancel('c1')!.goalLoop).to.equal(finished);
        expect(events.some(event => event.type === 'goal_loop')).to.equal(false);
    });
});

describe('QaapAgentConversationStore cancel is idempotent', () => {
    let store: QaapAgentConversationStore;
    let events: QaapAgentConversationEvent[];
    let runnerCancels: string[];

    beforeEach(() => {
        store = Object.create(QaapAgentConversationStore.prototype) as QaapAgentConversationStore;
        events = [];
        runnerCancels = [];
        const fields = store as unknown as Record<string, unknown>;
        const taskToConversation = new Map<string, { conversationId: string; userMessageId: string; turnAgentId: string; agentMessageId: string }>();
        fields.conversations = new Map<string, QaapAgentConversation>();
        fields.taskToConversation = taskToConversation;
        fields.fire = (event: QaapAgentConversationEvent): void => { events.push(event); };
        fields.persist = async (): Promise<void> => undefined;
        fields.flushPersist = (): void => undefined;
        fields.schedulePersist = (): void => undefined;
        // Wire fan-out is not under test here; the trace and status edits are.
        fields.publishFinalizedAgentMessage = (): void => undefined;
        fields.getActiveTaskIdsForConversation = (conversationId: string): string[] =>
            [...taskToConversation.entries()].filter(([, ref]) => ref.conversationId === conversationId).map(([taskId]) => taskId);
        // A cancelled task settles and its conversation ref is released, as the task outcome path does.
        fields.taskRunner = {
            cancel: (taskId: string): undefined => {
                runnerCancels.push(taskId);
                taskToConversation.delete(taskId);
                return undefined;
            },
            list: (): QaapAgentTask[] => [],
        };
        store.conversations.set('c1', {
            id: 'c1',
            cwd: '/repo',
            agentId: 'claude',
            title: 'Login',
            status: 'streaming',
            createdAt: 0,
            updatedAt: 0,
            messages: [
                { id: 'u1', role: 'user', content: 'do it', createdAt: 0, taskId: 't1' },
                { id: 'a1', role: 'agent', content: '', createdAt: 0, status: 'streaming' },
            ],
            pendingUserMessages: [{ id: 'q1', content: 'follow up', createdAt: 0 }],
        } as unknown as QaapAgentConversation);
        taskToConversation.set('t1', { conversationId: 'c1', userMessageId: 'u1', turnAgentId: 'claude', agentMessageId: 'a1' });
    });

    const traceCount = (conv: QaapAgentConversation): number =>
        conv.messages.flatMap(message => message.traceEvents ?? []).filter(event => event.type === 'run_cancelled').length;

    it('settles to idle at once with exactly one updated event and pauses the queue', () => {
        const next = store.cancel('c1')!;

        expect(next.status).to.equal('idle');
        expect(next.pendingUserMessagesPaused).to.equal(true);
        expect(runnerCancels).to.deep.equal(['t1']);
        expect(events.filter(event => event.type === 'updated')).to.have.length(1);
    });

    it('makes a second cancel a no-op: no duplicate trace and no new updated event', () => {
        const first = store.cancel('c1')!;
        const updatesAfterFirst = events.filter(event => event.type === 'updated').length;
        const tracesAfterFirst = traceCount(first);

        const second = store.cancel('c1')!;

        expect(second).to.equal(first);
        expect(traceCount(second)).to.equal(tracesAfterFirst);
        expect(tracesAfterFirst).to.equal(1);
        expect(events.filter(event => event.type === 'updated')).to.have.length(updatesAfterFirst);
        expect(runnerCancels).to.deep.equal(['t1']);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QAAP_MAX_TURN_MINUTES_ENV } from '../common/qaap-agent-turn-watchdog';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** Records cancel() calls instead of touching real child processes or ~/.qaap/agent-tasks. */
class TestTaskRunner extends QaapAgentTaskRunner {
    readonly cancelledIds: string[] = [];

    override cancel(id: string): QaapAgentTask | undefined {
        this.cancelledIds.push(id);
        return undefined;
    }

    override list(): QaapAgentTask[] {
        return [];
    }

    protected override async persist(): Promise<void> {
        /* no-op — avoid touching ~/.qaap/agent-tasks during tests */
    }
}

/** Exposes the store's protected watchdog internals for direct testing, without real disk I/O. */
class TestConversationStore extends QaapAgentConversationStore {

    protected override async persist(): Promise<void> {
        /* no-op — avoid touching ~/.qaap/agent-conversations during tests */
    }

    protected override async restoreFromDisk(): Promise<void> {
        /* no-op — tests seed conversations directly */
    }

    protected override startTurnWatchdog(): void {
        /* no-op — tests call sweep() explicitly instead of waiting on a real interval */
    }

    configureForTest(taskRunner: QaapAgentTaskRunner): void {
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => { /* ignore SSE fanout in tests */ });
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
    }

    seed(conv: QaapAgentConversation): void {
        (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.set(conv.id, conv);
    }

    sweep(nowMs: number): boolean {
        return (this as unknown as { sweepZombieStreamingTurns: (n: number) => boolean }).sweepZombieStreamingTurns(nowMs);
    }
}

function streamingConversation(id: string, streamingSinceMs: number): QaapAgentConversation {
    return {
        id,
        cwd: '/tmp/project',
        agentId: 'qaiq',
        title: 'Zombie turn',
        status: 'streaming',
        createdAt: streamingSinceMs,
        updatedAt: streamingSinceMs,
        messages: [
            { id: `${id}-u1`, role: 'user', content: 'do the thing', createdAt: streamingSinceMs, taskId: `${id}-task` },
            { id: `${id}-a1`, role: 'agent', content: 'working…', createdAt: streamingSinceMs + 1000 },
        ],
    };
}

describe('QaapAgentConversationStore turn watchdog', () => {
    const originalEnv = process.env[QAAP_MAX_TURN_MINUTES_ENV];

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env[QAAP_MAX_TURN_MINUTES_ENV];
        } else {
            process.env[QAAP_MAX_TURN_MINUTES_ENV] = originalEnv;
        }
    });

    it('force-stops a conversation whose turn exceeded the default max duration', () => {
        delete process.env[QAAP_MAX_TURN_MINUTES_ENV];
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        const streamingSince = now - 50 * 60 * 60 * 1000; // the reported 50-hour zombie
        store.seed(streamingConversation('zombie', streamingSince));

        const changed = store.sweep(now);

        expect(changed).to.be.true;
        expect(runner.cancelledIds).to.deep.equal(['zombie-task']);
        const settled = store.get('zombie')!;
        expect(settled.status).to.equal('failed');
        const agentMessage = settled.messages.find(m => m.role === 'agent')!;
        expect(agentMessage.error).to.equal('Stopped automatically after 50 hours: the turn exceeded the maximum allowed time.');
    });

    it('spares an expired turn that is paused on a pending approval (REL-5)', () => {
        delete process.env[QAAP_MAX_TURN_MINUTES_ENV];
        const runner = new TestTaskRunner();
        // The turn is waiting on a user approval — a live pending can_use_tool request for its task.
        (runner as unknown as { pendingQaiqControlRequests: Map<string, unknown[]> })
            .pendingQaiqControlRequests.set('paused-task', [{ id: 'req' }]);
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('paused', now - 50 * 60 * 1000)); // 50m > 45m default

        const changed = store.sweep(now);

        expect(changed).to.be.false;
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.get('paused')!.status).to.equal('streaming');
    });

    it('leaves a conversation streaming within the max duration untouched', () => {
        delete process.env[QAAP_MAX_TURN_MINUTES_ENV];
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('fresh', now - 5 * 60 * 1000));

        const changed = store.sweep(now);

        expect(changed).to.be.false;
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.get('fresh')!.status).to.equal('streaming');
    });

    it('honors QAAP_MAX_TURN_MINUTES to stop a shorter-lived turn sooner', () => {
        process.env[QAAP_MAX_TURN_MINUTES_ENV] = '5';
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('short-max', now - 10 * 60 * 1000));

        const changed = store.sweep(now);

        expect(changed).to.be.true;
        expect(runner.cancelledIds).to.deep.equal(['short-max-task']);
        expect(store.get('short-max')!.status).to.equal('failed');
    });

    it('does not force-stop a non-streaming conversation', () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        const conv = { ...streamingConversation('idle-one', now - 60 * 60 * 60 * 1000), status: 'idle' as const };
        store.seed(conv);

        const changed = store.sweep(now);

        expect(changed).to.be.false;
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.get('idle-one')!.status).to.equal('idle');
    });
});

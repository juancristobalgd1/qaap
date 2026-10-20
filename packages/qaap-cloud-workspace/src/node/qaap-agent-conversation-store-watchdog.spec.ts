// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QAAP_MAX_TURN_MINUTES_ENV, QAAP_TURN_IDLE_MINUTES_ENV } from '../common/qaap-agent-turn-watchdog';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** Records cancel() calls instead of touching real child processes or ~/.qaap/agent-tasks. */
class TestTaskRunner extends QaapAgentTaskRunner {
    readonly cancelledIds: string[] = [];
    readonly cancelOptions: Array<{ readonly interrupt?: boolean } | undefined> = [];
    /** Runs inside cancel(), where the real runner settles the task synchronously. */
    onCancel?: (id: string) => void;

    override cancel(id: string, options?: { readonly interrupt?: boolean }): QaapAgentTask | undefined {
        this.cancelledIds.push(id);
        this.cancelOptions.push(options);
        this.onCancel?.(id);
        return undefined;
    }

    override list(): QaapAgentTask[] {
        return [];
    }

    public override async persist(): Promise<void> {
        /* no-op — avoid touching ~/.qaap/agent-tasks during tests */
    }
}

/** Exposes the store's protected watchdog internals for direct testing, without real disk I/O. */
class TestConversationStore extends QaapAgentConversationStore {

    override async persist(): Promise<void> {
        /* no-op — avoid touching ~/.qaap/agent-conversations during tests */
    }

    override async restoreFromDisk(): Promise<void> {
        /* no-op — tests seed conversations directly */
    }

    override startTurnWatchdog(): void {
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

    sweep(nowMs: number, options?: { readonly resetSurvivorsToIdle?: boolean }): boolean {
        return this.sweepZombieStreamingTurns(nowMs, options);
    }

    trackTask(taskId: string, conversationId: string): void {
        this.taskToConversation.set(taskId, { conversationId, userMessageId: `${conversationId}-u1`, turnAgentId: 'qaiq', agentMessageId: `${conversationId}-a1` });
    }
}

const MINUTE = 60 * 1000;

/** A streaming turn that started at `streamingSinceMs` and last streamed output at `lastActivityMs`. */
function streamingConversation(id: string, streamingSinceMs: number, lastActivityMs = streamingSinceMs): QaapAgentConversation {
    return {
        id,
        cwd: '/tmp/project',
        agentId: 'qaiq',
        title: 'Zombie turn',
        status: 'streaming',
        createdAt: streamingSinceMs,
        updatedAt: lastActivityMs,
        messages: [
            { id: `${id}-u1`, role: 'user', content: 'do the thing', createdAt: streamingSinceMs, taskId: `${id}-task` },
            { id: `${id}-a1`, role: 'agent', content: 'working…', createdAt: streamingSinceMs + 1000 },
        ],
    };
}

describe('QaapAgentConversationStore turn watchdog', () => {
    const originalEnv = {
        [QAAP_MAX_TURN_MINUTES_ENV]: process.env[QAAP_MAX_TURN_MINUTES_ENV],
        [QAAP_TURN_IDLE_MINUTES_ENV]: process.env[QAAP_TURN_IDLE_MINUTES_ENV],
    };

    beforeEach(() => {
        delete process.env[QAAP_TURN_IDLE_MINUTES_ENV];
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('pauses a conversation whose turn exceeded the absolute cap, as a timeout the user can continue', () => {
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
        expect(agentMessage.error).to.equal('Timed out at the 180-minute task limit. Continue runs it again from your original request.');
    });

    it('keeps a 46-minute turn that is still streaming output alive', () => {
        delete process.env[QAAP_MAX_TURN_MINUTES_ENV];
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('busy', now - 46 * MINUTE, now - 20 * 1000));

        expect(store.sweep(now)).to.be.false;
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.get('busy')!.status).to.equal('streaming');
    });

    it('pauses a turn with no output for 15 minutes', () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('quiet', now - 30 * MINUTE, now - 16 * MINUTE));

        expect(store.sweep(now)).to.be.true;
        expect(runner.cancelledIds).to.deep.equal(['quiet-task']);
        // The task ends `interrupted` (Continue), not `cancelled` as a user stop would.
        expect(runner.cancelOptions).to.deep.equal([{ interrupt: true, pauseCause: { cause: 'idle', limitMinutes: 15 } }]);
        const agentMessage = store.get('quiet')!.messages.find(m => m.role === 'agent')!;
        expect(agentMessage.error).to.equal('Timed out after 15 minutes without output. Continue runs it again from your original request.');
    });

    it('leaves inactivity of a turn whose task is still live to the runner\'s own output timer', () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('live', now - 30 * MINUTE, now - 16 * MINUTE));
        store.trackTask('live-task', 'live');

        expect(store.sweep(now)).to.be.false;
        expect(runner.cancelledIds).to.deep.equal([]);
    });

    it('keeps the restart copy for a quiet turn found at startup', () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('restarted', now - 30 * MINUTE, now - 20 * MINUTE));

        expect(store.sweep(now, { resetSurvivorsToIdle: true })).to.be.true;
        const agentMessage = store.get('restarted')!.messages.find(m => m.role === 'agent')!;
        expect(agentMessage.error).to.match(/^The backend restarted while this turn was in progress/);
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
        store.seed(streamingConversation('paused', now - 200 * MINUTE)); // past both the idle limit and the 180m cap

        const changed = store.sweep(now);

        expect(changed).to.be.false;
        expect(runner.cancelledIds).to.deep.equal([]);
        expect(store.get('paused')!.status).to.equal('streaming');
    });

    it('marks the task as paused by the watchdog while its settle runs, and the timeout reason sticks', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('settling', now - 30 * MINUTE, now - 16 * MINUTE));
        const markedDuringCancel: boolean[] = [];
        let settle: Promise<unknown> | undefined;
        runner.onCancel = id => {
            const paused = (store as unknown as { turnWatchdogPausedTaskIds: Set<string> }).turnWatchdogPausedTaskIds;
            markedDuringCancel.push(paused.has(id));
            settle = store.applyTaskOutcome(
                { conversationId: 'settling', userMessageId: 'settling-u1', turnAgentId: 'qaiq', agentMessageId: 'settling-a1' },
                { id, title: 'x', command: 'do the thing', cwd: '/tmp/project', state: 'interrupted', createdAt: now - 30 * MINUTE } as QaapAgentTask,
            );
        };

        expect(store.sweep(now)).to.be.true;
        expect(await settle).to.equal('blocked');

        expect(markedDuringCancel).to.deep.equal([true]);
        expect((store as unknown as { turnWatchdogPausedTaskIds: Set<string> }).turnWatchdogPausedTaskIds.size).to.equal(0);
        const settled = store.get('settling')!;
        expect(settled.status).to.equal('failed');
        expect(settled.messages.find(m => m.role === 'agent')!.error)
            .to.equal('Timed out after 15 minutes without output. Continue runs it again from your original request.');
    });

    it('still pauses a turn left waiting on an approval for more than 24 hours', () => {
        delete process.env[QAAP_MAX_TURN_MINUTES_ENV];
        const runner = new TestTaskRunner();
        (runner as unknown as { pendingQaiqControlRequests: Map<string, unknown[]> })
            .pendingQaiqControlRequests.set('abandoned-task', [{ id: 'req' }]);
        const store = new TestConversationStore();
        store.configureForTest(runner);
        const now = Date.now();
        store.seed(streamingConversation('abandoned', now - 25 * 60 * MINUTE));

        expect(store.sweep(now)).to.be.true;
        expect(runner.cancelledIds).to.deep.equal(['abandoned-task']);
        expect(store.get('abandoned')!.messages.find(m => m.role === 'agent')!.error)
            .to.match(/^Timed out at the 1440-minute task limit\./);
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

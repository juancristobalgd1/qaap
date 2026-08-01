// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

class TestTaskRunner extends QaapAgentTaskRunner {
    logByTaskId = new Map<string, string>();

    override create(): QaapAgentTask {
        return { id: 'task-auth', state: 'running' } as unknown as QaapAgentTask;
    }

    override async detail(id: string): Promise<import('../common/qaap-agent-task').QaapAgentTaskDetail | undefined> {
        const log = this.logByTaskId.get(id);
        if (log === undefined) {
            return undefined;
        }
        return {
            id,
            title: 'auth',
            command: 'claude -p hi',
            cwd: '/tmp/repo',
            state: 'completed',
            createdAt: 1,
            log,
        } as import('../common/qaap-agent-task').QaapAgentTaskDetail;
    }

    protected override async persist(): Promise<void> { /* no-op */ }
}

class TestConversationStore extends QaapAgentConversationStore {

    protected override async persist(): Promise<void> { /* no-op */ }
    protected override async restoreFromDisk(): Promise<void> { /* no-op */ }
    protected override startTurnWatchdog(): void { /* no-op */ }
    protected override captureGitSha(): string | undefined { return undefined; }
    protected override captureCheckpoint(): undefined { return undefined; }
    protected override fireAgentMessageWireUpdate(): void { /* no-op */ }

    configureForTest(taskRunner: QaapAgentTaskRunner): void {
        (this as unknown as { sseBatcher: QaapAgentConversationSseBatcher }).sseBatcher =
            new QaapAgentConversationSseBatcher(() => undefined);
        (this as unknown as { taskRunner: QaapAgentTaskRunner }).taskRunner = taskRunner;
    }

    seed(conv: QaapAgentConversation): void {
        (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.set(conv.id, conv);
    }

    exposeResolveCompletedTurnAuthFailureReason(log: string | undefined): string | undefined {
        return (this as unknown as {
            resolveCompletedTurnAuthFailureReason: (l: string | undefined) => string | undefined;
        }).resolveCompletedTurnAuthFailureReason(log);
    }

    async settleRun(taskId: string, task: QaapAgentTask): Promise<void> {
        const ref = (this as unknown as {
            taskToConversation: Map<string, {
                conversationId: string;
                userMessageId: string;
                turnAgentId: string;
                agentMessageId?: string;
            }>;
        }).taskToConversation.get(taskId)!;
        await (this as unknown as {
            applyTaskOutcome: (r: unknown, t: QaapAgentTask) => Promise<void>;
        }).applyTaskOutcome(ref, task);
    }

    getConversation(id: string): QaapAgentConversation | undefined {
        return (this as unknown as { conversations: Map<string, QaapAgentConversation> }).conversations.get(id);
    }
}

function authFailureFixtureLog(): string {
    return fs.readFileSync(
        path.resolve(__dirname, '../../test-resources/qaap-research-agent-turn-auth-failure.jsonl'),
        'utf8',
    );
}

describe('QaapAgentConversationStore completed-turn auth failure', () => {

    it('resolveCompletedTurnAuthFailureReason detects stream-json OAuth expiry (exit 0)', () => {
        const store = new TestConversationStore();
        const reason = store.exposeResolveCompletedTurnAuthFailureReason(authFailureFixtureLog());
        expect(reason).to.be.a('string');
        expect(reason).to.match(/sign in/i);
        expect(reason).to.not.match(/API key/i);
    });

    it('resolveCompletedTurnAuthFailureReason ignores ordinary successful logs', () => {
        const store = new TestConversationStore();
        expect(store.exposeResolveCompletedTurnAuthFailureReason('Edited src/app.ts and ran tests.')).to.equal(undefined);
        expect(store.exposeResolveCompletedTurnAuthFailureReason('')).to.equal(undefined);
    });

    it('resolveCompletedTurnAuthFailureReason ignores a successful turn that merely describes auth code (no structured error)', () => {
        const store = new TestConversationStore();
        // A clean exit whose plain-text stdout trips EVERY broad session pattern
        // ("OAuth session", "not logged in", "user_code", "verification_uri") while
        // touching src/auth/login.ts — but the CLI never emitted an `is_error:true`
        // result envelope and there is no real device-code prompt. This is the false
        // positive: the old code reclassified it to a "Sign in required" card.
        const successLog = [
            'I implemented the OAuth session middleware in src/auth/login.ts.',
            'Added a guard: if the request is not logged in, redirect to the verification_uri.',
            'The device flow now stores the user_code and polls until the session is authorized.',
            'Ran the test suite: all green. Build passes.',
        ].join('\n');
        expect(store.exposeResolveCompletedTurnAuthFailureReason(successLog)).to.equal(undefined);
    });

    it('resolveCompletedTurnAuthFailureReason ignores a successful turn that echoes a bare auth-host URL (no one-time code, no structured error)', () => {
        const store = new TestConversationStore();
        // Even a real https auth-host link in prose is not enough on a clean exit: a
        // genuine device-code prompt always pairs the URL with a one-time code.
        const successLog = [
            'To enable OAuth, direct users to https://auth.openai.com/authorize in the browser.',
            'Documented the login flow in src/auth/login.ts. Tests pass.',
        ].join('\n');
        expect(store.exposeResolveCompletedTurnAuthFailureReason(successLog)).to.equal(undefined);
    });

    it('resolveCompletedTurnAuthFailureReason still fails a real plain-text device-code login prompt (URL + code, exit 0)', () => {
        const store = new TestConversationStore();
        // A plain-text CLI (no stream-json) that printed an actual device-code block and
        // exited 0 having done nothing must still open the Sign-in card.
        const deviceCodeLog = [
            'Please sign in to continue.',
            'Open https://auth.openai.com/device and enter code: WDJB-MJHT',
        ].join('\n');
        const reason = store.exposeResolveCompletedTurnAuthFailureReason(deviceCodeLog);
        expect(reason).to.be.a('string');
        expect(reason).to.match(/sign in/i);
    });

    it('resolveCompletedTurnAuthFailureReason detects plain-text Antigravity quota (exit 0)', () => {
        const store = new TestConversationStore();
        const reason = store.exposeResolveCompletedTurnAuthFailureReason(
            'Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 54h16m14s.',
        );
        expect(reason).to.be.a('string');
        expect(reason).to.match(/Individual quota reached/i);
        expect(reason).to.match(/Resets in/i);
    });

    it('applyTaskOutcome marks completed auth failures as failed with Sign-in copy', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);

        const userMessage: QaapAgentMessage = {
            id: 'user-1',
            role: 'user',
            content: 'hi',
            createdAt: 1,
            taskId: 'task-auth',
            turnAgentId: 'claude',
        };
        const agentMessage: QaapAgentMessage = {
            id: 'agent-1',
            role: 'agent',
            content: '',
            createdAt: 2,
            runUserMessageId: 'user-1',
            runActive: true,
        };
        const conv: QaapAgentConversation = {
            id: 'conv-auth',
            cwd: '/tmp/repo',
            agentId: 'claude',
            title: 'Auth',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [userMessage, agentMessage],
        };
        store.seed(conv);
        (store as unknown as {
            taskToConversation: Map<string, {
                conversationId: string;
                userMessageId: string;
                turnAgentId: string;
                agentMessageId?: string;
            }>;
        }).taskToConversation.set('task-auth', {
            conversationId: 'conv-auth',
            userMessageId: 'user-1',
            turnAgentId: 'claude',
            agentMessageId: 'agent-1',
        });
        runner.logByTaskId.set('task-auth', authFailureFixtureLog());

        await store.settleRun('task-auth', {
            id: 'task-auth',
            state: 'completed',
            exitCode: 0,
        } as unknown as QaapAgentTask);

        const settled = store.getConversation('conv-auth');
        expect(settled?.status).to.equal('failed');
        const agent = settled?.messages.find(message => message.id === 'agent-1');
        expect(agent?.error).to.match(/sign in/i);
        expect(agent?.content).to.match(/Failed to authenticate|OAuth session/i);
    });

    it('applyTaskOutcome marks completed quota failures as failed with Quota dialog copy', async () => {
        const runner = new TestTaskRunner();
        const store = new TestConversationStore();
        store.configureForTest(runner);

        const userMessage: QaapAgentMessage = {
            id: 'user-1',
            role: 'user',
            content: 'Find and fix a bug',
            createdAt: 1,
            taskId: 'task-quota',
            turnAgentId: 'antigravity',
        };
        const agentMessage: QaapAgentMessage = {
            id: 'agent-1',
            role: 'agent',
            content: '',
            createdAt: 2,
            runUserMessageId: 'user-1',
            runActive: true,
        };
        const conv: QaapAgentConversation = {
            id: 'conv-quota',
            cwd: '/tmp/repo',
            agentId: 'antigravity',
            title: 'Quota',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [userMessage, agentMessage],
        };
        store.seed(conv);
        (store as unknown as {
            taskToConversation: Map<string, {
                conversationId: string;
                userMessageId: string;
                turnAgentId: string;
                agentMessageId?: string;
            }>;
        }).taskToConversation.set('task-quota', {
            conversationId: 'conv-quota',
            userMessageId: 'user-1',
            turnAgentId: 'antigravity',
            agentMessageId: 'agent-1',
        });
        runner.logByTaskId.set(
            'task-quota',
            'Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 54h16m14s.',
        );

        await store.settleRun('task-quota', {
            id: 'task-quota',
            state: 'completed',
            exitCode: 0,
        } as unknown as QaapAgentTask);

        const settled = store.getConversation('conv-quota');
        expect(settled?.status).to.equal('failed');
        const agent = settled?.messages.find(message => message.id === 'agent-1');
        expect(agent?.error).to.match(/Individual quota reached|quota/i);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    resolveAgentMessageTiming,
    isAgentMessageVisuallySettled,
    isConversationTurnVisuallySettled,
    resolveTranscriptAgentExecutionState,
    isTranscriptAgentTailStreaming,
    isTranscriptSummaryAgentWorking,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
    shouldShowTranscriptLiveStatus,
} from './qaap-transcript-turn-status';

const conv = (partial: Partial<QaapAgentConversationDTO> = {}): QaapAgentConversationDTO => ({
    id: 'c1',
    cwd: '/repo',
    agentId: 'qaiq',
    title: 'Test',
    status: 'streaming',
    createdAt: 1,
    updatedAt: 10,
    messages: [],
    ...partial,
});

describe('qaap-transcript-turn-status', () => {
    it('retains historical duration while a later turn is running', () => {
        const state = conv({ messages: [
            { id: 'u1', role: 'user', content: 'test', createdAt: 1000 },
            { id: 'a1', role: 'agent', content: 'done', createdAt: 2000, runUserMessageId: 'u1', runFinishedAt: 16000 },
            { id: 'u2', role: 'user', content: 'wait', createdAt: 20000 },
            { id: 'a2', role: 'agent', content: '', createdAt: 21000, runActive: true }
        ] });
        expect(resolveAgentMessageTiming(state, state.messages[1], 25000)).to.deep.equal({ isWorking: false, turnStartMs: 1000, elapsedMs: 15000 });
        expect(resolveAgentMessageTiming(state, state.messages[3], 25000)).to.deep.equal({ isWorking: true, turnStartMs: 20000, elapsedMs: 5000 });
        expect(resolveAgentMessageTiming({ ...state, status: 'idle', updatedAt: 26000 }, state.messages[3], 90000).isWorking).to.equal(false);
    });
    it('isConversationTurnVisuallySettled is false while a tool is still running', () => {
        const streaming = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'run dev', createdAt: 5 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 8,
                    segments: [{
                        type: 'tool',
                        toolUseId: 't1',
                        name: 'Bash',
                        args: '{"command":"pnpm dev"}',
                        finished: false,
                    }],
                },
            ],
        });
        expect(isConversationTurnVisuallySettled(streaming)).to.equal(false);
        expect(resolveTranscriptEffectiveStatus(streaming)).to.equal('streaming');
    });

    it('isConversationTurnVisuallySettled is true when tools finished and files were edited', () => {
        const streaming = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'levanta la app', createdAt: 5 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 20,
                    segments: [
                        {
                            type: 'tool',
                            toolUseId: 't1',
                            name: 'Edit',
                            args: '{"path":"vite.config.ts"}',
                            finished: true,
                        },
                        {
                            type: 'tool',
                            toolUseId: 't2',
                            name: 'Bash',
                            args: '{"command":"pnpm dev"}',
                            finished: true,
                            result: 'ready in 300ms',
                        },
                    ],
                },
            ],
        });
        expect(isConversationTurnVisuallySettled(streaming)).to.equal(true);
        expect(resolveTranscriptEffectiveStatus(streaming)).to.equal('settled');
    });

    it('isAgentMessageVisuallySettled accepts plain stdout agents', () => {
        expect(isAgentMessageVisuallySettled({
            id: 'a1',
            role: 'agent',
            content: 'Done.',
            createdAt: 3,
        })).to.equal(true);
    });

    it('isConversationTurnVisuallySettled stays streaming for thinking-only segments', () => {
        const streaming = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'run dev', createdAt: 5 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 8,
                    segments: [{
                        type: 'thinking',
                        content: 'Let me explore the project structure first.',
                    }],
                },
            ],
        });
        expect(isConversationTurnVisuallySettled(streaming)).to.equal(false);
        expect(resolveTranscriptEffectiveStatus(streaming)).to.equal('streaming');
    });

    it('isConversationTurnVisuallySettled mirrors backend idle', () => {
        const idle = conv({ status: 'idle', messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }] });
        expect(isConversationTurnVisuallySettled(idle)).to.equal(true);
    });

    it('honors terminal backend status even when a tool trace was left unfinished', () => {
        const idleWithRunningTool = conv({
            status: 'idle',
            messages: [
                { id: 'u1', role: 'user', content: 'run tests', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    segments: [{
                        type: 'tool',
                        toolUseId: 't1',
                        name: 'Bash',
                        args: '{"command":"npm test"}',
                        finished: false,
                    }],
                },
            ],
        });
        expect(isConversationTurnVisuallySettled(idleWithRunningTool)).to.equal(false);
        expect(resolveTranscriptEffectiveStatus(idleWithRunningTool)).to.equal('idle');
        expect(isTranscriptAgentTailStreaming(idleWithRunningTool)).to.equal(false);
    });

    it('isTranscriptAgentTailStreaming stops once the turn is visually settled', () => {
        const userMessage = { id: 'u1', role: 'user' as const, content: 'explain api', createdAt: 5 };
        const streaming = conv({
            messages: [
                userMessage,
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 8,
                    segments: [{
                        type: 'thinking',
                        content: 'Exploring the API surface...',
                    }],
                },
            ],
        });
        expect(isTranscriptAgentTailStreaming(streaming)).to.equal(true);
        expect(isTranscriptAgentTailStreaming({
            ...streaming,
            messages: [
                userMessage,
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 20,
                    segments: [{
                        type: 'tool',
                        toolUseId: 't1',
                        name: 'Bash',
                        args: '{"command":"pnpm dev"}',
                        finished: true,
                    }],
                },
            ],
        })).to.equal(false);
        expect(isTranscriptAgentTailStreaming({ ...streaming, status: 'idle' })).to.equal(false);
    });

    it('shouldShowTranscriptEmptyQuickActions is true only before the first user message', () => {
        const fresh = conv({ status: 'idle' });
        expect(shouldShowTranscriptEmptyQuickActions(fresh)).to.equal(true);

        const streaming = conv({
            messages: [{ id: 'u1', role: 'user', content: 'fix login', createdAt: 2 }],
        });
        expect(shouldShowTranscriptEmptyQuickActions(streaming)).to.equal(false);

        const pendingUser = conv({
            status: 'idle',
            messages: [],
        });
        const cached = conv({
            messages: [{ id: 'pending-u1', role: 'user', content: 'fix login', createdAt: 2 }],
        });
        expect(shouldShowTranscriptEmptyQuickActions(pendingUser, cached)).to.equal(false);

        const waitingForAgent = conv({
            status: 'streaming',
            messages: [],
        });
        expect(shouldShowTranscriptEmptyQuickActions(waitingForAgent)).to.equal(false);
    });

    it('keeps visually settled streaming turns busy until the backend reaches ready', () => {
        const summary = { id: 'c1', status: 'streaming' as const };
        const settledTurn = conv({
            messages: [
                { id: 'u1', role: 'user', content: 'fix tests', createdAt: 2 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: 'Done.',
                    createdAt: 8,
                    segments: [
                        { type: 'tool', toolUseId: 't1', name: 'Edit', args: '{}', finished: true },
                        { type: 'text', content: 'Done.' },
                    ],
                },
            ],
        });
        expect(resolveTranscriptEffectiveStatus(settledTurn)).to.equal('settled');
        // Live-status stays up for the whole backend turn — including visually settled
        // streaming and settled/finalizing — so tokens/elapsed do not flicker.
        expect(shouldShowTranscriptLiveStatus(settledTurn)).to.equal(true);
        expect(shouldShowTranscriptLiveStatus({ ...settledTurn, status: 'settled' })).to.equal(true);
        expect(shouldShowTranscriptLiveStatus({ ...settledTurn, status: 'idle' })).to.equal(false);
        expect(resolveTranscriptAgentExecutionState(summary, settledTurn)).to.deep.equal({
            phase: 'finalizing',
            busy: true,
        });
        expect(isTranscriptSummaryAgentWorking(summary, settledTurn)).to.equal(true);
        expect(isTranscriptSummaryAgentWorking({ id: 'c1', status: 'settled' }, undefined)).to.equal(true);
        expect(isTranscriptSummaryAgentWorking(summary, undefined)).to.equal(true);
        expect(isTranscriptSummaryAgentWorking({ id: 'c1', status: 'idle' }, { ...settledTurn, status: 'idle' })).to.equal(false);
    });

    it('shows live-status for the whole backend turn, not only while tools are unfinished', () => {
        const working = conv({
            status: 'streaming',
            messages: [
                { id: 'u1', role: 'user', content: 'go', createdAt: 2 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 3,
                    segments: [{ type: 'tool', toolUseId: 't1', name: 'Edit', args: '{}', finished: false }],
                },
            ],
        });
        expect(shouldShowTranscriptLiveStatus(working)).to.equal(true);
        const setupOnly = conv({
            status: 'streaming',
            messages: [{ id: 'u1', role: 'user', content: 'go', createdAt: 2 }],
        });
        expect(shouldShowTranscriptLiveStatus(setupOnly)).to.equal(true);
        const betweenTools = conv({
            status: 'streaming',
            messages: [
                { id: 'u1', role: 'user', content: 'go', createdAt: 2 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 3,
                    segments: [{ type: 'tool', toolUseId: 't1', name: 'Edit', args: '{}', finished: true }],
                },
            ],
        });
        expect(isConversationTurnVisuallySettled(betweenTools)).to.equal(true);
        expect(shouldShowTranscriptLiveStatus(betweenTools)).to.equal(true);
    });

    it('shouldShowTranscriptLiveStatus is false on an empty chat even with stale streaming/settled status', () => {
        // An empty chat (no user message yet) must never pin the live-status orb, even if the
        // backend reports a residual `streaming`/`settled` status — there is no in-flight turn.
        const emptyStreaming = conv({ status: 'streaming', messages: [] });
        expect(shouldShowTranscriptLiveStatus(emptyStreaming)).to.equal(false);
        const emptySettled = conv({ status: 'settled', messages: [] });
        expect(shouldShowTranscriptLiveStatus(emptySettled)).to.equal(false);
        // Once the user sends their first message, the live-status may appear for the turn.
        const started = conv({
            status: 'streaming',
            messages: [{ id: 'u1', role: 'user', content: 'go', createdAt: 2 }],
        });
        expect(shouldShowTranscriptLiveStatus(started)).to.equal(true);
    });

    it('execution chrome is idle once the backend is idle, even with an unfinished-looking tool', () => {
        // A flaky model can leave a tool_call without its result so the trace looks "running" forever.
        // The backend status is authoritative for execution chrome: an idle turn must NOT keep Stop /
        // the Changes Accept/Discard menu disabled. Rendering still streams the tail — that's separate.
        const idleWithRunningTool = conv({
            status: 'idle',
            messages: [
                { id: 'u1', role: 'user', content: 'fix a bug', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: 'Done — applied the fix.',
                    createdAt: 2,
                    segments: [
                        { type: 'tool', toolUseId: 't1', name: 'Bash', args: '{"command":"npm test"}', finished: false },
                        { type: 'text', content: 'Done — applied the fix.' },
                    ],
                },
            ],
        });
        expect(resolveTranscriptAgentExecutionState({ id: 'c1', status: 'idle' }, idleWithRunningTool))
            .to.deep.equal({ phase: 'ready', busy: false });
        expect(isTranscriptSummaryAgentWorking({ id: 'c1', status: 'idle' }, idleWithRunningTool)).to.equal(false);
        // Terminal execution and transcript chrome agree, even with a stale trace.
        expect(resolveTranscriptEffectiveStatus(idleWithRunningTool)).to.equal('idle');
    });

    it('resolveTranscriptEffectiveStatus keeps failed over unfinished trace work', () => {
        const failedWithRunningTool = conv({
            status: 'failed',
            messages: [
                { id: 'u1', role: 'user', content: 'run tests', createdAt: 1 },
                {
                    id: 'a1',
                    role: 'agent',
                    content: '',
                    createdAt: 2,
                    error: 'Bash failed: command not found',
                    segments: [{
                        type: 'tool',
                        toolUseId: 't1',
                        name: 'Bash',
                        args: '{"command":"npm test"}',
                        finished: false,
                    }],
                },
            ],
        });
        expect(resolveTranscriptEffectiveStatus(failedWithRunningTool)).to.equal('failed');
        expect(isTranscriptSummaryAgentWorking({ id: 'c1', status: 'failed' }, failedWithRunningTool)).to.equal(false);
    });
});

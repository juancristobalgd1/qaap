// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    isAgentMessageVisuallySettled,
    isConversationTurnVisuallySettled,
    isTranscriptAgentTailStreaming,
    isTranscriptSummaryAgentWorking,
    resolveTranscriptEffectiveStatus,
    shouldShowTranscriptEmptyQuickActions,
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

    it('resolveTranscriptEffectiveStatus keeps unfinished visible tools active even when backend reports idle', () => {
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
        expect(resolveTranscriptEffectiveStatus(idleWithRunningTool)).to.equal('streaming');
        expect(isTranscriptAgentTailStreaming(idleWithRunningTool)).to.equal(true);
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

    it('isTranscriptSummaryAgentWorking respects visually settled streaming turns', () => {
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
        expect(isTranscriptSummaryAgentWorking(summary, settledTurn)).to.equal(false);
        expect(isTranscriptSummaryAgentWorking({ id: 'c1', status: 'settled' }, undefined)).to.equal(false);
        expect(isTranscriptSummaryAgentWorking(summary, undefined)).to.equal(true);
    });
});

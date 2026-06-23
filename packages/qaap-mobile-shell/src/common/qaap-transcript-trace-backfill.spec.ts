// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    backfillAgentMessageTraceEvents,
    backfillConversationTraceEvents,
    compactAgentMessageTraceStorage,
    materializeAgentMessageForApi,
    preferTraceFirstAgentMessageStorage,
    settleTraceEvents,
} from './qaap-transcript-trace-backfill';
import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';

describe('qaap-transcript-trace-backfill', () => {
    it('derives settled traceEvents from legacy segments', () => {
        const message: QaapAgentMessageDTO = {
            id: 'a1',
            role: 'agent',
            content: 'Done',
            createdAt: 1,
            segments: [
                { type: 'text', content: 'Done' },
                {
                    type: 'tool',
                    toolUseId: 'tool-1',
                    name: 'bash',
                    args: 'npm test',
                    finished: true,
                    result: 'ok',
                },
            ],
        };
        const { message: next, changed } = backfillAgentMessageTraceEvents(message);
        expect(changed).to.equal(true);
        expect(next.traceEvents?.some(event => event.type === 'tool_call' && event.id === 'tool-1')).to.equal(true);
        expect(next.traceEvents?.every(event => {
            if (event.type === 'tool_call') {
                return event.status === 'completed';
            }
            if (event.type === 'assistant_text') {
                return event.status === 'completed';
            }
            return true;
        })).to.equal(true);
    });

    it('settleTraceEvents clears streaming tail states', () => {
        const settled = settleTraceEvents([
            { type: 'assistant_text', id: 'text-0', content: 'Hi', status: 'streaming' },
            {
                type: 'tool_call',
                id: 'tool-1',
                name: 'bash',
                args: 'ls',
                status: 'running',
            },
        ]);
        expect(settled[0].type === 'assistant_text' && settled[0].status).to.equal('completed');
        expect(settled[1].type === 'tool_call' && settled[1].status).to.equal('completed');
    });

    it('backfillConversationTraceEvents only streams the tail on active conversations', () => {
        const { conversation, changed } = backfillConversationTraceEvents({
            id: 'c1',
            cwd: '/repo',
            agentId: 'qaiq',
            title: 'Task',
            status: 'streaming',
            createdAt: 1,
            updatedAt: 2,
            messages: [
                {
                    id: 'a-old',
                    role: 'agent',
                    content: 'Earlier',
                    createdAt: 1,
                    segments: [{ type: 'text', content: 'Earlier' }],
                },
                {
                    id: 'a-tail',
                    role: 'agent',
                    content: 'Live',
                    createdAt: 2,
                    segments: [{ type: 'text', content: 'Live' }],
                },
            ],
        });
        expect(changed).to.equal(true);
        const old = conversation.messages[0];
        const tail = conversation.messages[1];
        expect(old.traceEvents?.[0]?.type === 'assistant_text' && old.traceEvents[0].status).to.equal('completed');
        expect(tail.traceEvents?.[0]?.type === 'assistant_text' && tail.traceEvents[0].status).to.equal('streaming');
    });

    it('compactAgentMessageTraceStorage drops settled legacy segments', () => {
        const compact = compactAgentMessageTraceStorage({
            id: 'a1',
            role: 'agent',
            content: 'Done',
            createdAt: 1,
            segments: [{ type: 'text', content: 'Done' }],
            traceEvents: [{ type: 'assistant_text', id: 'text-0', content: 'Done', status: 'completed' }],
        });
        expect(compact.segments).to.equal(undefined);
        expect(compact.traceEvents).to.have.length(1);
    });

    it('preferTraceFirstAgentMessageStorage drops segments even during streaming tail', () => {
        const compact = preferTraceFirstAgentMessageStorage({
            id: 'a1',
            role: 'agent',
            content: 'Hi',
            createdAt: 1,
            segments: [{ type: 'text', content: 'Hi' }],
            traceEvents: [{ type: 'assistant_text', id: 'text-0', content: 'Hi', status: 'streaming' }],
        });
        expect(compact.segments).to.equal(undefined);
        expect(compact.traceEvents?.[0]?.type).to.equal('assistant_text');
    });

    it('materializeAgentMessageForApi derives content and legacy segments from traceEvents', () => {
        const materialized = materializeAgentMessageForApi({
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 1,
            traceEvents: [
                { type: 'thought', id: 'thought-0', content: 'Planning', status: 'completed' },
                { type: 'tool_call', id: 'tool-1', name: 'Write', args: '{}', status: 'completed' },
                { type: 'assistant_text', id: 'text-0', content: 'Landing creada.', status: 'completed' },
            ],
        });
        expect(materialized.content).to.equal('Landing creada.');
        expect(materialized.segments?.some(segment => segment.type === 'tool' && segment.name === 'Write')).to.equal(true);
    });
});

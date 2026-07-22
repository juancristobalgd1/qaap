// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import {
    resolveLatestTranscriptTodos,
    resolveTodoStepProgress,
} from './qaap-transcript-todo-step';

describe('resolveTodoStepProgress', () => {
    it('uses the 1-based index of the in_progress item', () => {
        expect(resolveTodoStepProgress([
            { label: 'A', status: 'completed' },
            { label: 'B', status: 'in_progress' },
            { label: 'C', status: 'pending' },
        ])).to.deep.equal({
            current: 2,
            total: 3,
            items: [
                { label: 'A', status: 'completed' },
                { label: 'B', status: 'in_progress' },
                { label: 'C', status: 'pending' },
            ],
        });
    });

    it('advances to completed+1 when nothing is in_progress', () => {
        expect(resolveTodoStepProgress([
            { label: 'A', status: 'completed' },
            { label: 'B', status: 'pending' },
            { label: 'C', status: 'pending' },
        ])?.current).to.equal(2);
    });

    it('returns total when every item is completed', () => {
        expect(resolveTodoStepProgress([
            { label: 'A', status: 'completed' },
            { label: 'B', status: 'completed' },
        ])).to.deep.include({ current: 2, total: 2 });
    });

    it('returns undefined for an empty list', () => {
        expect(resolveTodoStepProgress([])).to.equal(undefined);
    });
});

describe('resolveLatestTranscriptTodos', () => {
    it('reads the latest TodoWrite from segments', () => {
        const segments: QaapAgentMessageSegmentDTO[] = [
            {
                type: 'tool',
                toolUseId: 't1',
                name: 'TodoWrite',
                args: JSON.stringify({
                    todos: [{ content: 'Old', status: 'pending' }],
                }),
                finished: true,
            },
            {
                type: 'tool',
                toolUseId: 't2',
                name: 'TodoWrite',
                args: JSON.stringify({
                    todos: [
                        { content: 'Done', status: 'completed' },
                        { content: 'Next', status: 'in_progress' },
                    ],
                }),
                finished: false,
            },
        ];
        expect(resolveLatestTranscriptTodos(segments)).to.deep.equal([
            { label: 'Done', status: 'completed' },
            { label: 'Next', status: 'in_progress' },
        ]);
    });

    it('scans conversation messages and keeps the newest checklist', () => {
        const messages: QaapAgentMessageDTO[] = [
            {
                id: 'u1',
                role: 'user',
                content: 'go',
                createdAt: 1,
            },
            {
                id: 'a1',
                role: 'agent',
                content: '',
                createdAt: 2,
                segments: [{
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'TodoWrite',
                    args: JSON.stringify({
                        todos: [{ content: 'First plan', status: 'pending' }],
                    }),
                    finished: true,
                }],
            },
            {
                id: 'a2',
                role: 'agent',
                content: '',
                createdAt: 3,
                segments: [{
                    type: 'tool',
                    toolUseId: 't2',
                    name: 'TodoWrite',
                    args: JSON.stringify({
                        todos: [
                            { content: 'Scaffold', status: 'completed' },
                            { content: 'Ship', status: 'pending' },
                        ],
                    }),
                    finished: true,
                }],
            },
        ];
        expect(resolveLatestTranscriptTodos(messages)).to.deep.equal([
            { label: 'Scaffold', status: 'completed' },
            { label: 'Ship', status: 'pending' },
        ]);
    });

    it('returns undefined when no parseable TodoWrite exists', () => {
        expect(resolveLatestTranscriptTodos([])).to.equal(undefined);
        expect(resolveLatestTranscriptTodos([{
            type: 'tool',
            toolUseId: 't1',
            name: 'Edit',
            args: '{"path":"a.ts"}',
            finished: true,
        }])).to.equal(undefined);
    });
});

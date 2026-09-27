// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO } from './qaap-agent-conversation-client';
import {
    formatAgentMessageForClipboard,
    formatConversationForClipboard,
    formatUserMessageForClipboard,
} from './qaap-conversation-clipboard-text';

const baseConv = (messages: QaapAgentConversationDTO['messages']): QaapAgentConversationDTO => ({
    id: 'conv-1',
    cwd: '/repo',
    agentId: 'opencode',
    title: 'Test',
    status: 'idle',
    createdAt: 1,
    updatedAt: 2,
    messages,
});

describe('qaap-conversation-clipboard-text', () => {
    it('formats user and agent turns with role labels and separators', () => {
        const text = formatConversationForClipboard(baseConv([
            { id: 'u1', role: 'user', content: 'Hola', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'Hola, ¿en qué puedo ayudarte?', createdAt: 2 },
        ]));
        expect(text).to.equal([
            'User:\nHola',
            'Assistant:\nHola, ¿en qué puedo ayudarte?',
        ].join('\n\n---\n\n'));
    });

    it('includes tool segments and skips thinking blocks', () => {
        const text = formatAgentMessageForClipboard({
            id: 'a1',
            role: 'agent',
            content: '',
            createdAt: 2,
            segments: [
                { type: 'thinking', content: 'internal reasoning' },
                { type: 'text', content: 'Running tests.' },
                {
                    type: 'tool',
                    toolUseId: 't1',
                    name: 'bash',
                    args: '{"command":"npm test"}',
                    finished: true,
                    result: 'ok 3 tests',
                },
            ],
        });
        expect(text).to.contain('Running tests.');
        expect(text).to.contain('[bash]');
        expect(text).to.contain('npm test');
        expect(text).to.contain('ok 3 tests');
        expect(text).not.to.contain('internal reasoning');
    });

    it('formats plain user messages', () => {
        const text = formatUserMessageForClipboard({
            id: 'u1',
            role: 'user',
            content: 'Describe this image',
            createdAt: 1,
        });
        expect(text).to.equal('Describe this image');
    });

    it('returns empty string when there are no messages', () => {
        expect(formatConversationForClipboard(baseConv([]))).to.equal('');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { isTrustedOpenTranscriptCache } from './mobile-projects-transcript-live-ui-activity2';

describe('isTrustedOpenTranscriptCache', () => {
    const summary = (overrides: Partial<QaapAgentConversationSummaryDTO> = {}): QaapAgentConversationSummaryDTO => ({
        id: 'conv-1',
        cwd: '/repo',
        agentId: 'codex',
        title: 'Thread',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 3,
        ...overrides,
    });

    const cached = (overrides: Partial<QaapAgentConversationDTO> = {}): QaapAgentConversationDTO => ({
        id: 'conv-1',
        cwd: '/repo',
        agentId: 'codex',
        title: 'Thread',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        messages: [
            { id: 'm1', role: 'user', content: 'a', createdAt: 1 },
            { id: 'm2', role: 'agent', content: 'b', createdAt: 2 },
            { id: 'm3', role: 'user', content: 'c', createdAt: 3 },
        ],
        ...overrides,
    });

    it('rejects summary-preview placeholder rows', () => {
        expect(isTrustedOpenTranscriptCache(cached({
            messages: [{
                id: 'conv-1:summary-preview',
                role: 'agent',
                content: 'uld you like to work on?',
                createdAt: 2,
            }],
        }), summary({ messageCount: 1 }))).to.equal(false);
    });

    it('rejects caches shorter than the list messageCount', () => {
        expect(isTrustedOpenTranscriptCache(cached({
            messages: [{ id: 'm1', role: 'user', content: 'a', createdAt: 1 }],
        }), summary({ messageCount: 5 }))).to.equal(false);
    });

    it('accepts complete caches', () => {
        expect(isTrustedOpenTranscriptCache(cached(), summary())).to.equal(true);
    });
});

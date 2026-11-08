// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { buildPromptExtracted } from './qaap-agent-conversation-store-live-status2';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

/**
 * Pi runs with `--no-session`, so it keeps no memory between turns. Continuity therefore comes from the
 * product: every follow-up prompt carries the conversation transcript. This pins that for `pi`.
 */
describe('qaap-agent-conversation Pi continuity (transcript reinjection)', () => {
    const ctx = {
        stripLeadingAgentMention: (text: string): string => text,
        appendTeamDelegation: (prompt: string): string => prompt,
        contextPreambleWithCompaction: (preamble: string | undefined): string => preamble ?? '',
    } as unknown as QaapAgentConversationStoreContext;

    const conv = {
        agentId: 'pi',
        contextPreamble: undefined,
        contextWindowSize: undefined,
        contextCompaction: undefined,
        messages: [
            { id: 'u1', role: 'user', content: 'Create app.js with a counter', createdAt: 1 },
            { id: 'a1', role: 'agent', content: 'Created app.js with a counter.', createdAt: 2, agentId: 'pi' },
            { id: 'u2', role: 'user', content: 'Now add a reset button', createdAt: 3 },
        ],
    } as unknown as QaapAgentConversation;

    it('a follow-up to Pi carries the earlier user and agent messages', () => {
        const prompt = buildPromptExtracted(ctx, conv, 'pi');
        expect(prompt).to.contain('Create app.js with a counter');
        expect(prompt).to.contain('Created app.js with a counter.');
        expect(prompt).to.contain('Now add a reset button');
    });

    it('the first message to Pi is sent as-is, with no transcript', () => {
        const first = { ...conv, messages: [conv.messages[0]] } as unknown as QaapAgentConversation;
        expect(buildPromptExtracted(ctx, first, 'pi')).to.equal('Create app.js with a counter');
    });
});

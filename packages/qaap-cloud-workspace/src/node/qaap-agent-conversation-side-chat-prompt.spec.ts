// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation, QaapAgentMessage } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';
import { buildPromptExtracted } from './qaap-agent-conversation-store-live-status2';

/** The store methods the prompt builder calls; the rest of the store is not needed to compose a turn. */
const context = {
    stripLeadingAgentMention: (text: string): string => text,
    appendTeamDelegation: (prompt: string): string => prompt,
    contextPreambleWithCompaction: (preamble: string | undefined, summary: string): string => `${preamble ?? ''}\n${summary}`,
} as unknown as QaapAgentConversationStoreContext;

const BACKGROUND = 'Background from the conversation "Fix login" this side chat was opened from. Use it only as context.\n\nLast agent reply:\nDone';

function conversation(messages: QaapAgentMessage[]): QaapAgentConversation {
    return {
        id: 'side-1', cwd: '/repo', agentId: 'opencode', title: 'Why red?', status: 'idle',
        createdAt: 1, updatedAt: 2, messages, contextWindowSize: 200_000,
    } as unknown as QaapAgentConversation;
}

describe('qaap-agent-conversation-side-chat-prompt', () => {

    it('sends the background in front of the first message, and the stored text stays the user words', () => {
        const first: QaapAgentMessage = { id: 'u1', role: 'user', content: 'Why is it red?', createdAt: 1, contextPreamble: BACKGROUND };
        const conv = conversation([first]);
        expect(buildPromptExtracted(context, conv, 'opencode')).to.equal(`${BACKGROUND}\n\n---\n\nWhy is it red?`);
        expect(conv.messages[0].content).to.equal('Why is it red?');
    });

    it('sends a message without a background as its own text', () => {
        const conv = conversation([{ id: 'u1', role: 'user', content: 'hi', createdAt: 1 }]);
        expect(buildPromptExtracted(context, conv, 'opencode')).to.equal('hi');
    });

    it('sends the background again when the same turn is resumed or retried from the stored message', () => {
        const first: QaapAgentMessage = { id: 'u1', role: 'user', content: 'Why is it red?', createdAt: 1, contextPreamble: BACKGROUND };
        const once = buildPromptExtracted(context, conversation([first]), 'opencode');
        const resumed = buildPromptExtracted(context, conversation([{ ...first }]), 'opencode');
        expect(resumed).to.equal(once);
        expect(once).to.contain(BACKGROUND);
    });

    it('does not repeat the background on a later turn of the side chat', () => {
        const first: QaapAgentMessage = { id: 'u1', role: 'user', content: 'Why is it red?', createdAt: 1, contextPreamble: BACKGROUND };
        const second: QaapAgentMessage = { id: 'u2', role: 'user', content: 'And now?', createdAt: 3 };
        const prompt = buildPromptExtracted(context, conversation([first, { id: 'a1', role: 'agent', content: 'Lock.', createdAt: 2 }, second]), 'opencode');
        expect(prompt).to.contain('And now?');
        expect(prompt).to.not.contain('Background from the conversation');
    });
});

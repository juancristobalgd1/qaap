// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';
import { persistExtracted } from './qaap-agent-conversation-store-thought-brief2';
import { clearRunActive } from './qaap-agent-conversation-store-helpers';
import * as rows from './qaap-agent-conversation-store-rows';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

describe('conversation persistence and turn completion', () => {
    afterEach(() => sinon.restore());

    it('serializes writes and continues after a failed save', async () => {
        const warn = sinon.stub(console, 'warn');
        const write = sinon.stub(rows, 'writePendingConversationRows');
        write.onFirstCall().returns({ namespace: 'agent-conversations.v2', entries: 1, chars: 10, stringifyMs: 1, totalMs: 7 });
        write.onSecondCall().throws(new Error('busy'));
        write.onThirdCall().returns(undefined);
        // Narrow unit test: `persistExtracted` only touches these members (plus `persistChain`,
        // which it initializes itself), so the fake implements a slice of the context.
        const ctx = {
            conversationRowsReady: true,
            persistFailureLoggedAtMs: 0,
        } as unknown as QaapAgentConversationStoreContext;
        const first = persistExtracted(ctx);
        const second = persistExtracted(ctx);
        await second;
        expect(warn.calledOnce).to.equal(true);
        expect(ctx.persistFailureLoggedAtMs).to.be.greaterThan(0);
        await Promise.all([first, persistExtracted(ctx)]);
        expect(write.callCount).to.equal(3);
        expect(ctx.lastPersistDurationMs).to.equal(7);
        expect(ctx.persistFailureLoggedAtMs).to.equal(0);
    });

    it('does not write rows before the migration and load finished', async () => {
        const write = sinon.stub(rows, 'writePendingConversationRows');
        const ctx = { conversationRowsReady: false, persistFailureLoggedAtMs: 0 } as unknown as QaapAgentConversationStoreContext;
        await persistExtracted(ctx);
        expect(write.called).to.equal(false);
    });

    it('retains a completed turn timestamp when later turns change the conversation', () => {
        const clock = sinon.useFakeTimers(50_000);
        const conv = { messages: [{ id: 'agent', role: 'agent', createdAt: 1000, runActive: true }] } as unknown as QaapAgentConversation;
        const completed = clearRunActive(conv, 'agent');
        expect(completed.messages[0].runFinishedAt).to.equal(50_000);
        const withoutActiveMarker = { ...conv, messages: conv.messages.map(message => ({ ...message, runActive: undefined })) };
        expect(clearRunActive(withoutActiveMarker, 'agent').messages[0].runFinishedAt).to.equal(50_000);
        clock.tick(20_000);
        expect(clearRunActive(completed, 'agent').messages[0].runFinishedAt).to.equal(50_000);
    });
});

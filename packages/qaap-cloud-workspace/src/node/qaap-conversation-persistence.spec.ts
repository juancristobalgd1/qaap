// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fsp from 'fs/promises';
import * as atomic from './qaap-write-json-atomic';
import { persistExtracted } from './qaap-agent-conversation-store-thought-brief2';
import { clearRunActive } from './qaap-agent-conversation-store-helpers';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';

describe('conversation persistence and turn completion', () => {
    afterEach(() => sinon.restore());

    it('serializes writes and continues after a failed save', async () => {
        sinon.stub(fsp, 'mkdir').resolves();
        sinon.stub(console, 'warn');
        let release!: () => void;
        const write = sinon.stub(atomic, 'writeJsonAtomic');
        write.onFirstCall().returns(new Promise<void>(resolve => { release = resolve; }));
        write.onSecondCall().rejects(new Error('busy'));
        write.onThirdCall().resolves();
        const ctx = { conversations: new Map(), persistFailureLoggedAtMs: 0 };
        const first = persistExtracted(ctx);
        await new Promise(resolve => setImmediate(resolve));
        const second = persistExtracted(ctx);
        const third = persistExtracted(ctx);
        await new Promise(resolve => setImmediate(resolve));
        expect(write.callCount).to.equal(1);
        release();
        await Promise.all([first, second, third]);
        expect(write.callCount).to.equal(3);
        expect(ctx.persistFailureLoggedAtMs).to.equal(0);
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

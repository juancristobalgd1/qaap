// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { flushPersistExtracted, schedulePersistExtracted } from './qaap-agent-conversation-store-live-status2';
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

interface PersistDebounceStub {
    persistTimer: ReturnType<typeof setTimeout> | undefined;
    lastPersistDurationMs: number | undefined;
    persist: sinon.SinonStub;
}

function createContext(lastPersistDurationMs?: number): PersistDebounceStub & QaapAgentConversationStoreContext {
    return {
        persistTimer: undefined,
        lastPersistDurationMs,
        persist: sinon.stub().resolves(),
    } as unknown as PersistDebounceStub & QaapAgentConversationStoreContext;
}

describe('qaap-agent-conversation-persist-debounce', () => {

    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        clock.restore();
        sinon.restore();
    });

    it('keeps the historical 500 ms delay before any write has been measured', () => {
        const ctx = createContext();
        schedulePersistExtracted(ctx);
        clock.tick(499);
        expect(ctx.persist.callCount).to.equal(0);
        clock.tick(1);
        expect(ctx.persist.callCount).to.equal(1);
    });

    it('waits 20x the last measured write before persisting while streaming', () => {
        const ctx = createContext(1000);
        schedulePersistExtracted(ctx);
        clock.tick(19_999);
        expect(ctx.persist.callCount).to.equal(0);
        clock.tick(1);
        expect(ctx.persist.callCount).to.equal(1);
    });

    it('caps the wait at 30 s for very slow writes', () => {
        const ctx = createContext(5000);
        schedulePersistExtracted(ctx);
        clock.tick(29_999);
        expect(ctx.persist.callCount).to.equal(0);
        clock.tick(1);
        expect(ctx.persist.callCount).to.equal(1);
    });

    it('shortens the wait again once writes speed up', () => {
        const slow = createContext(5000);
        schedulePersistExtracted(slow);
        clock.tick(30_000);
        expect(slow.persist.callCount).to.equal(1);

        slow.lastPersistDurationMs = 15;
        schedulePersistExtracted(slow);
        clock.tick(500);
        expect(slow.persist.callCount).to.equal(2);
    });

    it('does not re-arm a pending debounce', () => {
        const ctx = createContext(1000);
        schedulePersistExtracted(ctx);
        ctx.lastPersistDurationMs = 15;
        schedulePersistExtracted(ctx);
        clock.tick(19_999);
        expect(ctx.persist.callCount).to.equal(0);
        clock.tick(1);
        expect(ctx.persist.callCount).to.equal(1);
    });

    it('lets a turn-close flush persist immediately, not after the adaptive delay', () => {
        const ctx = createContext(5000);
        schedulePersistExtracted(ctx);
        clock.tick(1000);
        expect(ctx.persist.callCount).to.equal(0);

        flushPersistExtracted(ctx);
        expect(ctx.persist.callCount).to.equal(1);
        expect(ctx.persistTimer).to.equal(undefined);

        clock.tick(60_000);
        expect(ctx.persist.callCount).to.equal(1);
    });
});

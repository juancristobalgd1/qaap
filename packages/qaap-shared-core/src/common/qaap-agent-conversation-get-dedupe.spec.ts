// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { getConversation } from './qaap-agent-conversation-client';

describe('getConversation in-flight dedupe', () => {
    const originalFetch = globalThis.fetch;
    let requestedUrls: string[] = [];

    const stubFetch = (delayMs: number): void => {
        globalThis.fetch = (async (input: unknown): Promise<Response> => {
            requestedUrls.push(String(input));
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            return { ok: true, json: async () => ({ id: String(input) }) } as unknown as Response;
        }) as unknown as typeof fetch;
    };

    beforeEach(() => {
        requestedUrls = [];
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('shares one request between concurrent callers for the same id', async () => {
        stubFetch(5);
        const [first, second] = await Promise.all([getConversation('conv-a'), getConversation('conv-a')]);
        expect(requestedUrls).to.have.lengthOf(1);
        expect(first).to.equal(second);
    });

    it('keeps requests for different ids separate', async () => {
        stubFetch(5);
        await Promise.all([getConversation('conv-a'), getConversation('conv-b')]);
        expect(requestedUrls).to.have.lengthOf(2);
    });

    it('issues a fresh request once the previous one settled', async () => {
        stubFetch(0);
        await getConversation('conv-a');
        await getConversation('conv-a');
        expect(requestedUrls).to.have.lengthOf(2);
    });
});

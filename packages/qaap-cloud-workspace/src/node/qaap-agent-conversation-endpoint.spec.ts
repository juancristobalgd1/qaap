// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentConversationEndpoint } from './qaap-agent-conversation-endpoint';

interface FakeRes {
    statusCode: number;
    body: unknown;
    status(code: number): FakeRes;
    json(payload: unknown): FakeRes;
}

const fakeRes = (): FakeRes => ({
    statusCode: 200,
    body: undefined,
    status(code: number): FakeRes { this.statusCode = code; return this; },
    json(payload: unknown): FakeRes { this.body = payload; return this; },
});

/**
 * Idempotency of conversation creation (finding: a slow/timed-out create must not spawn a duplicate).
 * Exercises the real handleCreate dedup path with a minimal store/auth stub.
 */
describe('QaapAgentConversationEndpoint create idempotency', () => {

    function buildEndpoint(): { endpoint: QaapAgentConversationEndpoint; createCalls: number; store: Map<string, unknown> } {
        const store = new Map<string, unknown>();
        let createCalls = 0;
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, string>(),
            store: {
                create: (_req: unknown, _owner?: string) => {
                    createCalls += 1;
                    const conv = { id: `conv-${createCalls}`, cwd: '/workspace/repos/users/alice/o/r' };
                    store.set(conv.id, conv);
                    return conv;
                },
                get: (id: string) => store.get(id),
            },
            worktrees: {},
            auth: {
                resolveOwnedRepositoryCwd: (_ctx: unknown, cwd: string) => ({ kind: 'ok', cwd }),
                denyForbidden: () => false,
            },
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
        });
        return {
            endpoint,
            get createCalls(): number { return createCalls; },
            store,
        };
    }

    const call = (endpoint: QaapAgentConversationEndpoint, body: unknown, res: unknown): Promise<void> =>
        (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> })
            .handleCreate({ body }, res);

    const base = { cwd: '/workspace/repos/users/alice/o/r', message: 'hi' };

    it('creates once and returns the SAME conversation for a repeated clientRequestId (no duplicate)', async () => {
        const h = buildEndpoint();
        const res1 = fakeRes();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, res1);
        const res2 = fakeRes();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, res2);

        expect(h.createCalls).to.equal(1); // second call short-circuited
        expect((res1.body as { id: string }).id).to.equal('conv-1');
        expect((res2.body as { id: string }).id).to.equal('conv-1'); // same conversation echoed back
        expect(res2.statusCode).to.equal(201);
    });

    it('creates a distinct conversation for a different clientRequestId', async () => {
        const h = buildEndpoint();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, fakeRes());
        await call(h.endpoint, { ...base, clientRequestId: 'req-B' }, fakeRes());
        expect(h.createCalls).to.equal(2);
    });

    it('does not dedup when no clientRequestId is sent (legacy clients unaffected)', async () => {
        const h = buildEndpoint();
        await call(h.endpoint, { ...base }, fakeRes());
        await call(h.endpoint, { ...base }, fakeRes());
        expect(h.createCalls).to.equal(2);
    });

    it('re-creates if the remembered conversation no longer exists (e.g. deleted)', async () => {
        const h = buildEndpoint();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, fakeRes());
        h.store.delete('conv-1'); // conversation gone
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, fakeRes());
        expect(h.createCalls).to.equal(2); // stale mapping ignored, fresh create
    });
});

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
            clientRequestInFlight: new Set<string>(),
            store: {
                create: (_req: unknown, _owner?: string) => {
                    createCalls += 1;
                    const conv = { id: `conv-${createCalls}`, cwd: '/workspace/repos/users/alice/o/r' };
                    store.set(conv.id, conv);
                    return conv;
                },
                get: (id: string) => store.get(id),
            },
            worktrees: {
                // Async so a second concurrent request can observe the first still in flight.
                create: async (cwd: string) => { await Promise.resolve(); return { worktreePath: `${cwd}/.wt`, branch: 'qaap/wt' }; },
            },
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

    it('blocks a CONCURRENT duplicate (same key, worktree=true) instead of fanning out worktrees', async () => {
        const h = buildEndpoint();
        const res1 = fakeRes();
        const res2 = fakeRes();
        // Fire both before awaiting: the first reserves the key + enters the async worktree.create,
        // the second must see it in flight and 409 rather than create a second worktree/conversation.
        const p1 = call(h.endpoint, { ...base, clientRequestId: 'req-C', worktree: true }, res1);
        const p2 = call(h.endpoint, { ...base, clientRequestId: 'req-C', worktree: true }, res2);
        await Promise.all([p1, p2]);
        const statuses = [res1.statusCode, res2.statusCode].sort();
        expect(statuses).to.deep.equal([201, 409]); // exactly one created, one rejected
        expect(h.createCalls).to.equal(1);
    });

    it('re-creates if the remembered conversation no longer exists (e.g. deleted)', async () => {
        const h = buildEndpoint();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, fakeRes());
        h.store.delete('conv-1'); // conversation gone
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, fakeRes());
        expect(h.createCalls).to.equal(2); // stale mapping ignored, fresh create
    });
});

describe('QaapAgentConversationEndpoint message correlation', () => {

    it('forwards a valid optimistic client message id to the conversation store', async () => {
        let internal: unknown;
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            store: {
                get: () => undefined,
                getActiveTaskIdsForConversation: () => [],
                postUserMessage: (...args: unknown[]) => {
                    internal = args[9];
                    return { id: 'conv-1', messages: [] };
                },
            },
        });
        const response = fakeRes();

        await (endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> }).handlePostMessage({
            params: { id: 'conv-1' },
            body: { content: 'como estas?', clientMessageId: 'pending-user-123' },
        }, response);

        expect(response.statusCode).to.equal(202);
        expect(internal).to.deep.equal({ clientMessageId: 'pending-user-123' });
    });
});

describe('QaapAgentConversationEndpoint isolated parallel delivery', () => {

    function streamingParent(): { id: string; cwd: string; status: string; ownerLogin: string; agentId: string } {
        return { id: 'c1', cwd: '/tmp/project', status: 'streaming', ownerLogin: 'alice', agentId: 'qaiq' };
    }

    function buildEndpoint(options: { worktreeFails?: boolean } = {}): {
        endpoint: QaapAgentConversationEndpoint;
        created: Array<Record<string, unknown>>;
        queuedModes: string[];
        worktreeCalls: number;
    } {
        const parent = streamingParent();
        const created: Array<Record<string, unknown>> = [];
        const queuedModes: string[] = [];
        let worktreeCalls = 0;
        const conversations = new Map<string, typeof parent>([['c1', parent]]);
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, string>(),
            clientRequestInFlight: new Set<string>(),
            store: {
                get: (id: string) => conversations.get(id),
                getActiveTaskIdsForConversation: (id: string) => id === 'c1' ? ['task-1'] : [],
                countStreamingForks: () => 0,
                postUserMessage: (...args: unknown[]) => {
                    queuedModes.push(String(args[args.length - 1]));
                    return parent;
                },
                create: (request: Record<string, unknown>, owner?: string) => {
                    const conv = {
                        id: `fork-${created.length + 1}`,
                        cwd: request.cwd,
                        forkedFromId: request.forkedFromId,
                        worktreeBranch: request.worktreeBranch,
                        ownerLogin: owner,
                    };
                    created.push(conv);
                    conversations.set(conv.id, conv as unknown as typeof parent);
                    return conv;
                },
            },
            worktrees: {
                create: async (cwd: string, owner?: string) => {
                    worktreeCalls += 1;
                    if (options.worktreeFails) {
                        throw new Error('not a git repo');
                    }
                    return { worktreePath: `${cwd}/.wt-${owner ?? 'anon'}`, branch: 'qaap/worktree/abcd1234' };
                },
            },
        });
        return { endpoint, created, queuedModes, get worktreeCalls() { return worktreeCalls; } };
    }

    it('spawns a forked conversation in an isolated worktree when deliveryMode is parallel', async () => {
        const h = buildEndpoint();
        const response = fakeRes();
        await (h.endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> })
            .handlePostMessage({
                params: { id: 'c1' },
                body: { content: 'do this in parallel', deliveryMode: 'parallel' },
            }, response);

        expect(response.statusCode).to.equal(202);
        expect(h.worktreeCalls).to.equal(1);
        expect(h.created).to.have.length(1);
        expect(h.created[0].forkedFromId).to.equal('c1');
        expect(h.created[0].worktreeBranch).to.equal('qaap/worktree/abcd1234');
        expect((response.body as { id: string }).id).to.equal('fork-1');
        expect(h.queuedModes).to.deep.equal([]);
    });

    it('queues on the parent when the worktree cannot be created', async () => {
        const h = buildEndpoint({ worktreeFails: true });
        const response = fakeRes();
        await (h.endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> })
            .handlePostMessage({
                params: { id: 'c1' },
                body: { content: 'fallback', deliveryMode: 'parallel' },
            }, response);

        expect(response.statusCode).to.equal(202);
        expect(h.created).to.have.length(0);
        expect(h.queuedModes).to.deep.equal(['queue']);
        expect((response.body as { id: string }).id).to.equal('c1');
    });
});

describe('QaapAgentConversationEndpoint worktree apply', () => {

    function buildApplyEndpoint(overrides: {
        conv?: Record<string, unknown>;
        live?: boolean;
        applyResult?: { ok: boolean; branch?: string; error?: string };
        applyError?: string;
    } = {}): {
        endpoint: QaapAgentConversationEndpoint;
        deleted: string[];
        applied: Array<Record<string, unknown>>;
    } {
        const conv = {
            id: 'fork-1',
            cwd: '/tmp/wt',
            status: 'idle',
            forkedFromId: 'c1',
            worktreeBranch: 'qaap/worktree/abcd1234',
            parallelBaseCwd: '/tmp/project',
            ...overrides.conv,
        };
        const deleted: string[] = [];
        const applied: Array<Record<string, unknown>> = [];
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            store: {
                get: (id: string) => id === conv.id ? conv : id === 'c1' ? { id: 'c1', cwd: '/tmp/project' } : undefined,
                getActiveTaskIdsForConversation: () => overrides.live ? ['task-1'] : [],
                delete: (id: string) => {
                    deleted.push(id);
                    return true;
                },
            },
            worktrees: {
                apply: async (input: Record<string, unknown>) => {
                    applied.push(input);
                    if (overrides.applyError) {
                        throw new Error(overrides.applyError);
                    }
                    return overrides.applyResult ?? { ok: true, branch: conv.worktreeBranch };
                },
            },
            auth: {
                authenticate: () => ({ kind: 'skip' }),
                ownsWorkspacePath: () => true,
                denyForbidden: () => false,
            },
            requireAuth: () => ({ kind: 'skip' }),
        });
        return { endpoint, deleted, applied };
    }

    it('applies keep-branch and deletes the fork conversation', async () => {
        const h = buildApplyEndpoint();
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'keep-branch' } }, response);
        expect(response.statusCode).to.equal(200);
        expect(h.applied).to.have.length(1);
        expect(h.applied[0].action).to.equal('keep-branch');
        expect(h.applied[0].baseCwd).to.equal('/tmp/project');
        expect(h.deleted).to.deep.equal(['fork-1']);
        expect(response.body).to.deep.equal({ ok: true, branch: 'qaap/worktree/abcd1234' });
    });

    it('does not delete the conversation when merge fails', async () => {
        const h = buildApplyEndpoint({ applyResult: { ok: false, error: 'conflict' } });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'merge' } }, response);
        expect(h.deleted).to.deep.equal([]);
        expect(response.body).to.deep.equal({ ok: false, error: 'conflict' });
    });

    it('rejects a live streaming fork with 409', async () => {
        const h = buildApplyEndpoint({ conv: { status: 'streaming' }, live: true });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'none' } }, response);
        expect(response.statusCode).to.equal(409);
        expect(h.applied).to.have.length(0);
        expect(h.deleted).to.deep.equal([]);
    });

    it('rejects multi-agent parallel-run variants', async () => {
        const h = buildApplyEndpoint({ conv: { parallelRunId: 'run-1' } });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'merge' } }, response);
        expect(response.statusCode).to.equal(400);
        expect(h.applied).to.have.length(0);
    });
});

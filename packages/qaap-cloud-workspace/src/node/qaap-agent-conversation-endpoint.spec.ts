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

type FakeAuthContext = { kind: 'authenticated' | 'skip'; userLogin?: string } | { kind: 'unauthorized' };

/** Mirrors the parts of `QaapGithubAuthGuard` the endpoint uses; `resolveUserLogin` matches the real guard. */
const fakeAuth = (ctx: FakeAuthContext = { kind: 'authenticated', userLogin: 'alice' }): Record<string, unknown> => ({
    authenticate: () => ctx,
    resolveUserLogin: (c: FakeAuthContext) => (c.kind === 'authenticated' || c.kind === 'skip' ? c.userLogin : undefined),
    resolveOwnedRepositoryCwd: (_ctx: unknown, cwd: string) => ({ kind: 'ok', cwd }),
    ownsWorkspacePath: () => true,
    denyForbidden: () => false,
});

/**
 * Idempotency of conversation creation (finding: a slow/timed-out create must not spawn a duplicate).
 * Exercises the real handleCreate dedup path with a minimal store/auth stub.
 */
describe('QaapAgentConversationEndpoint create idempotency', () => {

    function buildEndpoint(): {
        endpoint: QaapAgentConversationEndpoint;
        createCalls: number;
        store: Map<string, unknown>;
        owners: Array<string | undefined>;
    } {
        const store = new Map<string, unknown>();
        const owners: Array<string | undefined> = [];
        let createCalls = 0;
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, string>(),
            clientRequestInFlight: new Set<string>(),
            repoClaims: new Map<string, number>(),
            store: {
                create: (_req: unknown, owner?: string) => {
                    createCalls += 1;
                    owners.push(owner);
                    const conv = { id: `conv-${createCalls}`, cwd: '/workspace/repos/users/alice/o/r' };
                    store.set(conv.id, conv);
                    return conv;
                },
                get: (id: string) => store.get(id),
                conversations: store,
                getActiveTaskIdsForConversation: () => [],
            },
            worktrees: {
                // Async so a second concurrent request can observe the first still in flight.
                create: async (cwd: string) => { await Promise.resolve(); return { worktreePath: `${cwd}/.wt`, branch: 'qaap/wt' }; },
            },
            auth: fakeAuth(),
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
        });
        return {
            endpoint,
            get createCalls(): number { return createCalls; },
            store,
            owners,
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
        expect(h.owners).to.deep.equal(['alice']); // owner resolved from the auth context
    });

    it('scopes the dedup key per owner so two users cannot collide on a clientRequestId', async () => {
        const h = buildEndpoint();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, fakeRes());
        Object.assign(h.endpoint, {
            auth: fakeAuth({ kind: 'authenticated', userLogin: 'bob' }),
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'bob' }),
        });
        const res = fakeRes();
        await call(h.endpoint, { ...base, clientRequestId: 'req-A' }, res);
        expect(h.createCalls).to.equal(2);
        expect(h.owners).to.deep.equal(['alice', 'bob']);
        expect((res.body as { id: string }).id).to.equal('conv-2');
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

/** Where a new thread runs: isolation 'auto' | 'worktree' | 'none', decided by the server at creation. */
describe('QaapAgentConversationEndpoint create isolation', () => {

    const repo = '/workspace/repos/users/alice/o/r';

    interface CreatedConversation {
        id: string;
        cwd: string;
        parallelBaseCwd?: string;
        worktreeBranch?: string;
    }

    function build(options: {
        /** Threads that already have a queued or running turn. */
        active?: Array<{ cwd: string; parallelBaseCwd?: string; ownerLogin?: string }>;
        notGit?: boolean;
    } = {}): { endpoint: QaapAgentConversationEndpoint; worktreeCreates: string[] } {
        const conversations = new Map<string, Record<string, unknown>>();
        const activeIds = new Set<string>();
        (options.active ?? []).forEach((conv, index) => {
            const id = `active-${index}`;
            conversations.set(id, { id, ownerLogin: 'alice', status: 'streaming', ...conv });
            activeIds.add(id);
        });
        conversations.set('idle', { id: 'idle', cwd: repo, ownerLogin: 'alice', status: 'settled' });
        const worktreeCreates: string[] = [];
        let created = 0;
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, string>(),
            clientRequestInFlight: new Set<string>(),
            repoClaims: new Map<string, number>(),
            store: {
                conversations,
                get: (id: string) => conversations.get(id),
                getActiveTaskIdsForConversation: (id: string) => activeIds.has(id) ? ['task'] : [],
                create: (req: { cwd: string; message?: string }, ownerLogin?: string) => {
                    created += 1;
                    const conv = { ...req, id: `conv-${created}`, ownerLogin };
                    conversations.set(conv.id, conv);
                    // Like the real store, the first turn's task is registered synchronously by create.
                    if (req.message) {
                        activeIds.add(conv.id);
                    }
                    return conv;
                },
            },
            worktrees: {
                create: async (cwd: string) => {
                    await Promise.resolve();
                    if (options.notGit) {
                        throw new Error('Worktree tasks need the project to be a git repository.');
                    }
                    worktreeCreates.push(cwd);
                    return { worktreePath: `${cwd}-wt-${worktreeCreates.length}`, branch: `qaap/worktree/${worktreeCreates.length}` };
                },
            },
            auth: fakeAuth(),
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
        });
        return { endpoint, worktreeCreates };
    }

    async function create(
        endpoint: QaapAgentConversationEndpoint,
        body: Record<string, unknown>,
    ): Promise<{ status: number; conv: CreatedConversation }> {
        const res = fakeRes();
        await (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> })
            .handleCreate({ body: { cwd: repo, message: 'hi', ...body } }, res);
        return { status: res.statusCode, conv: res.body as CreatedConversation };
    }

    const isolated = (conv: CreatedConversation): boolean => !!conv.worktreeBranch && conv.parallelBaseCwd === repo && conv.cwd !== repo;
    const shared = (conv: CreatedConversation): boolean => !conv.worktreeBranch && conv.parallelBaseCwd === undefined && conv.cwd === repo;

    it('auto isolates when another thread on the same repository has a queued or running turn', async () => {
        const h = build({ active: [{ cwd: repo }] });
        const { status, conv } = await create(h.endpoint, { isolation: 'auto' });
        expect(status).to.equal(201);
        expect(isolated(conv)).to.equal(true);
        expect(h.worktreeCreates).to.deep.equal([repo]);
    });

    it('auto shares the working tree when the only active thread runs in its own worktree', async () => {
        const h = build({ active: [{ cwd: '/tmp/qaap-worktrees/alice/abc', parallelBaseCwd: repo }] });
        expect(shared((await create(h.endpoint, {})).conv)).to.equal(true); // no isolation field → 'auto'
        expect(h.worktreeCreates).to.deep.equal([]);
    });

    it('auto shares when the only threads are idle, on another repository, or owned by someone else', async () => {
        const h = build({
            active: [
                { cwd: '/workspace/repos/users/alice/o/other' },
                { cwd: repo, ownerLogin: 'bob' },
            ],
        });
        expect(shared((await create(h.endpoint, { isolation: 'auto' })).conv)).to.equal(true);
        expect(h.worktreeCreates).to.deep.equal([]);
    });

    it('"none" shares the working tree even when another thread is active', async () => {
        const h = build({ active: [{ cwd: repo }] });
        expect(shared((await create(h.endpoint, { isolation: 'none' })).conv)).to.equal(true);
        expect(h.worktreeCreates).to.deep.equal([]);
    });

    it('"worktree" always isolates', async () => {
        const h = build();
        expect(isolated((await create(h.endpoint, { isolation: 'worktree' })).conv)).to.equal(true);
    });

    it('maps the legacy worktree boolean when isolation is absent', async () => {
        const h = build({ active: [{ cwd: repo }] });
        expect(shared((await create(h.endpoint, { worktree: false })).conv)).to.equal(true);
        expect(isolated((await create(build().endpoint, { worktree: true })).conv)).to.equal(true);
        expect(isolated((await create(h.endpoint, { worktree: false, isolation: 'auto' })).conv)).to.equal(true);
    });

    it('auto shares a non-git project instead of failing; an explicit worktree still fails', async () => {
        const h = build({ active: [{ cwd: repo }], notGit: true });
        const auto = await create(h.endpoint, { isolation: 'auto' });
        expect(auto.status).to.equal(201);
        expect(shared(auto.conv)).to.equal(true);
        expect((await create(h.endpoint, { isolation: 'worktree' })).status).to.equal(400);
    });

    it('two concurrent auto creates on an idle repository: one shares, the other gets a worktree', async () => {
        const h = build();
        // No message: neither thread has a turn, so only the in-flight claim can tell them apart.
        const [first, second] = await Promise.all([
            create(h.endpoint, { isolation: 'auto', message: undefined }),
            create(h.endpoint, { isolation: 'auto', message: undefined }),
        ]);
        expect([first, second].filter(result => shared(result.conv))).to.have.length(1);
        expect([first, second].filter(result => isolated(result.conv))).to.have.length(1);
        // The claim is released once the creates finish: the repository is idle again.
        expect(shared((await create(h.endpoint, { isolation: 'auto', message: undefined })).conv)).to.equal(true);
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
            auth: fakeAuth(),
        });
        const response = fakeRes();

        await (endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> }).handlePostMessage({
            params: { id: 'conv-1' },
            body: { content: 'como estas?', clientMessageId: 'pending-user-123' },
        }, response);

        expect(response.statusCode).to.equal(202);
        expect(internal).to.deep.equal({ clientMessageId: 'pending-user-123' });
    });

    it('warms the billing account of the authenticated sender, falling back to the conversation owner', async () => {
        const warmed: string[] = [];
        const post = async (ctx: FakeAuthContext): Promise<FakeRes> => {
            const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
            Object.assign(endpoint, {
                store: {
                    get: () => ({ id: 'conv-1', ownerLogin: 'owner' }),
                    getActiveTaskIdsForConversation: () => [],
                    postUserMessage: () => ({ id: 'conv-1', messages: [] }),
                },
                billingStore: { getOrCreateAccount: async (login: string) => { warmed.push(login); } },
                auth: fakeAuth(ctx),
            });
            const response = fakeRes();
            await (endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> })
                .handlePostMessage({ params: { id: 'conv-1' }, body: { content: 'hola' } }, response);
            return response;
        };

        expect((await post({ kind: 'authenticated', userLogin: 'alice' })).statusCode).to.equal(202);
        // Ownership is enforced by the route (getConversationIfOwned); a local skip-auth context has no login.
        expect((await post({ kind: 'skip' })).statusCode).to.equal(202);
        expect(warmed).to.deep.equal(['alice', 'owner']);
    });
});

describe('QaapAgentConversationEndpoint same-conversation parallel delivery', () => {

    function streamingParent(): { id: string; cwd: string; status: string; ownerLogin: string; agentId: string } {
        return { id: 'c1', cwd: '/tmp/project', status: 'streaming', ownerLogin: 'alice', agentId: 'qaiq' };
    }

    function buildEndpoint(): {
        endpoint: QaapAgentConversationEndpoint;
        created: Array<Record<string, unknown>>;
        posted: Array<{ readonly conversationId: string; readonly content: string; readonly deliveryMode: string }>;
        dispatched: string[];
        worktreeCalls: number;
    } {
        const parent = streamingParent();
        const created: Array<Record<string, unknown>> = [];
        const posted: Array<{ readonly conversationId: string; readonly content: string; readonly deliveryMode: string }> = [];
        const dispatched: string[] = [];
        let worktreeCalls = 0;
        const conversations = new Map<string, typeof parent>([['c1', parent]]);
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, string>(),
            clientRequestInFlight: new Set<string>(),
            store: {
                get: (id: string) => conversations.get(id),
                getActiveTaskIdsForConversation: (id: string) => id === 'c1' ? ['task-1'] : [],
                postUserMessage: (...args: unknown[]) => {
                    posted.push({
                        conversationId: String(args[0]),
                        content: String(args[1]),
                        deliveryMode: String(args[args.length - 1]),
                    });
                    return parent;
                },
                dispatchQueuedMessage: (_id: string, _queuedId: string, mode: string) => {
                    dispatched.push(mode);
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
                    return { worktreePath: `${cwd}/.wt-${owner ?? 'anon'}`, branch: 'qaap/worktree/abcd1234' };
                },
            },
            auth: fakeAuth(),
        });
        return { endpoint, created, posted, dispatched, get worktreeCalls() { return worktreeCalls; } };
    }

    it('posts a parallel task to the current conversation instead of creating a worktree conversation', async () => {
        const h = buildEndpoint();
        const response = fakeRes();
        await (h.endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> })
            .handlePostMessage({
                params: { id: 'c1' },
                body: { content: 'do this in parallel', deliveryMode: 'parallel' },
            }, response);

        expect(response.statusCode).to.equal(202);
        expect(h.worktreeCalls).to.equal(0);
        expect(h.created).to.have.length(0);
        expect(h.posted).to.deep.equal([{
            conversationId: 'c1',
            content: 'do this in parallel',
            deliveryMode: 'parallel',
        }]);
        expect((response.body as { id: string }).id).to.equal('c1');
    });

    it('dispatches a queued message as a parallel run on the same conversation', async () => {
        const h = buildEndpoint();
        const response = fakeRes();
        await (h.endpoint as unknown as { handleDispatchQueuedMessage(req: unknown, res: unknown): Promise<void> })
            .handleDispatchQueuedMessage({
                params: { id: 'c1', queuedMessageId: 'pending-1' },
                body: { deliveryMode: 'parallel' },
            }, response);

        expect(response.statusCode).to.equal(202);
        expect(h.worktreeCalls).to.equal(0);
        expect(h.created).to.have.length(0);
        expect(h.dispatched).to.deep.equal(['parallel']);
        expect((response.body as { id: string }).id).to.equal('c1');
    });
});

describe('QaapAgentConversationEndpoint worktree apply', () => {

    function buildApplyEndpoint(overrides: {
        conv?: Record<string, unknown>;
        live?: boolean;
        applyResult?: { ok: boolean; branch?: string; error?: string };
        applyError?: string;
        /** Another thread with a running turn directly in this cwd. */
        activeThreadCwd?: string;
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
        const other = { id: 'other', cwd: overrides.activeThreadCwd ?? '/tmp/elsewhere' };
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            repoClaims: new Map(),
            store: {
                conversations: new Map([[conv.id, conv], [other.id, other]]),
                get: (id: string) => id === conv.id ? conv : id === 'c1' ? { id: 'c1', cwd: '/tmp/project' } : undefined,
                getActiveTaskIdsForConversation: (id: string) => id === other.id ? ['task-2'] : overrides.live ? ['task-1'] : [],
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
            auth: fakeAuth({ kind: 'skip' }),
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

    it('refuses a merge with 409 while another thread runs in the base working tree, without merging', async () => {
        const h = buildApplyEndpoint({ activeThreadCwd: '/tmp/project' });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'merge' } }, response);
        expect(response.statusCode).to.equal(409);
        expect((response.body as { reason?: string }).reason).to.equal('busy');
        expect(h.applied).to.have.length(0);
        expect(h.deleted).to.deep.equal([]);
    });

    it('merges when the only other active thread runs in its own worktree', async () => {
        const h = buildApplyEndpoint({ activeThreadCwd: '/tmp/qaap-worktrees/alice/other' });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'merge' } }, response);
        expect(response.statusCode).to.equal(200);
        expect(h.applied).to.have.length(1);
        expect(h.deleted).to.deep.equal(['fork-1']);
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

    it('merges a thread auto-isolated at creation (no fork parent) back into its base repository', async () => {
        const h = buildApplyEndpoint({ conv: { forkedFromId: undefined } });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'merge' } }, response);
        expect(response.statusCode).to.equal(200);
        expect(h.applied[0].baseCwd).to.equal('/tmp/project');
        expect(h.deleted).to.deep.equal(['fork-1']);
    });

    it('rejects a thread that shares the working tree (no worktree of its own)', async () => {
        const h = buildApplyEndpoint({ conv: { forkedFromId: undefined, parallelBaseCwd: undefined, worktreeBranch: undefined } });
        const response = fakeRes();
        await (h.endpoint as unknown as { handleApplyWorktree(req: unknown, res: unknown): Promise<void> })
            .handleApplyWorktree({ params: { id: 'fork-1' }, body: { action: 'merge' } }, response);
        expect(response.statusCode).to.equal(400);
        expect(h.applied).to.have.length(0);
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

/**
 * SSE `Last-Event-ID` resume and the snapshot cut. Drives the real handleStream / snapshotCursor with a
 * stub store backed by a real event log.
 */
describe('QaapAgentConversationEndpoint live feed resume', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QaapConversationEventLog } = require('./qaap-conversation-event-log') as typeof import('./qaap-conversation-event-log');
    type Entry = import('./qaap-conversation-event-log').QaapConversationLogEntry;

    function build(): {
        endpoint: QaapAgentConversationEndpoint;
        log: import('./qaap-conversation-event-log').QaapConversationEventLog;
        listeners: Set<(entry: Entry) => void>;
        flushes: { count: number };
        emit(event: import('../common/qaap-agent-conversation').QaapAgentConversationEvent): void;
    } {
        const log = new QaapConversationEventLog({ epoch: 'boot-1' });
        const listeners = new Set<(entry: Entry) => void>();
        const flushes = { count: 0 };
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            store: {
                eventLog: log,
                sseBatcher: { flush: () => { flushes.count++; } },
                onDidChangeStamped: (listener: (entry: Entry) => void) => {
                    listeners.add(listener);
                    return { dispose: () => listeners.delete(listener) };
                },
                listAllGroupedByCwd: () => [{ cwd: '/w/alice', conversations: [] }],
            },
            auth: {
                ...fakeAuth(),
                ownsWorkspacePath: (_ctx: unknown, cwd: string) => cwd.startsWith('/w/alice'),
            },
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
        });
        return { endpoint, log, listeners, flushes, emit: event => { const entry = log.append(event); listeners.forEach(l => l(entry)); } };
    }

    function connect(endpoint: QaapAgentConversationEndpoint, req: { headers?: Record<string, string>; query?: Record<string, string> }): { writes: string[]; close(): void } {
        const writes: string[] = [];
        const closers: Array<() => void> = [];
        const res = {
            status() { return this; },
            set() { return this; },
            flushHeaders() { /* noop */ },
            write(chunk: string) { writes.push(chunk); return true; },
            on(event: string, handler: () => void) { if (event === 'close') { closers.push(handler); } },
        };
        const request = { headers: req.headers ?? {}, query: req.query ?? {}, on: (event: string, handler: () => void) => { if (event === 'close') { closers.push(handler); } } };
        (endpoint as unknown as { handleStream(req: unknown, res: unknown): void }).handleStream(request, res);
        return { writes, close: () => closers.forEach(c => c()) };
    }

    const upd = (id: string, cwd = '/w/alice'): import('../common/qaap-agent-conversation').QaapAgentConversationEvent =>
        ({ type: 'updated', conversation: { id, cwd } } as never);

    it('without a cursor writes only live events (plus id lines) and no snapshot/resync', () => {
        const h = build();
        h.emit(upd('old'));
        const sse = connect(h.endpoint, {});
        expect(sse.writes).to.deep.equal([': qaap-agent-conversations stream\n\n']);
        expect(h.flushes.count).to.equal(0);
        h.emit(upd('a'));
        h.emit(upd('hidden', '/w/bob'));
        expect(sse.writes.slice(1)).to.deep.equal([
            `id: boot-1:2\nevent: updated\ndata: ${JSON.stringify(upd('a'))}\n\n`,
        ]);
        sse.close();
        expect(h.listeners.size).to.equal(0);
    });

    it('replays owned events after Last-Event-ID (header) when the epoch matches', () => {
        const h = build();
        h.emit(upd('a'));
        h.emit(upd('b'));
        h.emit(upd('x', '/w/bob'));
        h.emit(upd('c'));
        const sse = connect(h.endpoint, { headers: { 'last-event-id': 'boot-1:1' } });
        expect(h.flushes.count).to.equal(1);
        const frames = sse.writes.slice(1);
        expect(frames.map(f => f.split('\n')[0])).to.deep.equal(['id: boot-1:2', 'id: boot-1:4']);
        h.emit(upd('d'));
        expect(sse.writes.at(-1)!.startsWith('id: boot-1:5\n')).to.equal(true);
    });

    it('accepts ?lastEventId= and resyncs on an epoch mismatch, a gap or garbage', () => {
        const h = build();
        h.emit(upd('a'));
        const same = connect(h.endpoint, { query: { lastEventId: 'boot-1:1' } });
        expect(same.writes).to.have.length(1);
        for (const cursor of ['boot-0:1', 'boot-1:99', 'garbage']) {
            const sse = connect(h.endpoint, { query: { lastEventId: cursor } });
            const frame = sse.writes[1];
            expect(frame, cursor).to.match(/^id: boot-1:1\nevent: resync\ndata: /);
            const payload = JSON.parse(frame.split('data: ')[1]);
            expect(payload).to.deep.equal({ type: 'resync', epoch: 'boot-1', seq: 1, groups: [] });
        }
    });

    it('snapshot cut flushes the batcher and reports the cursor', () => {
        const h = build();
        h.emit(upd('a'));
        const cursor = (h.endpoint as unknown as { snapshotCursor(): unknown }).snapshotCursor();
        expect(cursor).to.deep.equal({ epoch: 'boot-1', seq: 1 });
        expect(h.flushes.count).to.equal(1);
    });
});

describe('QaapAgentConversationEndpoint project clone missing from disk', () => {
    const cwd = '/workspace/repos/users/alice/octo/app';
    const error = 'I cannot find the repository octo/app on the server and could not clone it again: no access.';

    function buildEndpoint(recovered: unknown): { endpoint: QaapAgentConversationEndpoint; created: unknown[]; posted: string[]; recoveredCwds: string[] } {
        const created: unknown[] = [];
        const posted: string[] = [];
        const recoveredCwds: string[] = [];
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            clientRequestDedup: new Map<string, string>(),
            clientRequestInFlight: new Set<string>(),
            repoClaims: new Map<string, number>(),
            store: {
                conversations: new Map(),
                create: (request: unknown) => { created.push(request); return { id: 'conv-1', cwd }; },
                get: () => ({ id: 'conv-1', cwd, ownerLogin: 'alice' }),
                getActiveTaskIdsForConversation: () => [],
                postUserMessage: (_id: string, content: string) => { posted.push(content); return { id: 'conv-1', messages: [] }; },
            },
            auth: {
                ...fakeAuth(),
                // The plain resolver denies a cwd whose clone is gone; the recovery re-clones it.
                resolveOwnedRepositoryCwd: () => ({ kind: 'denied' }),
            },
            cloneRecovery: {
                resolveOwnedRepositoryCwd: async (_ctx: unknown, rawCwd: string) => { recoveredCwds.push(rawCwd); return recovered; },
            },
            requireAuth: () => ({ kind: 'authenticated', userLogin: 'alice' }),
        });
        return { endpoint, created, posted, recoveredCwds };
    }

    const create = (endpoint: QaapAgentConversationEndpoint, res: FakeRes): Promise<void> =>
        (endpoint as unknown as { handleCreate(req: unknown, res: unknown): Promise<void> })
            .handleCreate({ body: { cwd: 'github:octo/app', message: 'fix it' } }, res);
    const post = (endpoint: QaapAgentConversationEndpoint, res: FakeRes): Promise<void> =>
        (endpoint as unknown as { handlePostMessage(req: unknown, res: unknown): Promise<void> })
            .handlePostMessage({ params: { id: 'conv-1' }, body: { content: 'and now this' } }, res);

    it('starts a new conversation in the re-cloned project', async () => {
        const { endpoint, created } = buildEndpoint({ kind: 'ok', cwd });
        const res = fakeRes();
        await create(endpoint, res);
        expect(res.statusCode).to.equal(201);
        expect((created[0] as { cwd: string }).cwd).to.equal(cwd);
    });

    it('answers a readable error instead of a cwd error when the clone cannot be restored', async () => {
        const { endpoint, created } = buildEndpoint({ kind: 'clone-failed', error });
        const res = fakeRes();
        await create(endpoint, res);
        expect(res.statusCode).to.equal(422);
        expect(res.body).to.deep.equal({ error, code: 'repository_clone_unavailable' });
        expect(created).to.deep.equal([]);
    });

    it('re-clones the project of an existing conversation before the next message', async () => {
        const { endpoint, posted, recoveredCwds } = buildEndpoint({ kind: 'ok', cwd });
        const res = fakeRes();
        await post(endpoint, res);
        expect(recoveredCwds).to.deep.equal([cwd]);
        expect(res.statusCode).to.equal(202);
        expect(posted).to.deep.equal(['and now this']);
    });

    it('fails a follow-up message with the readable error when the clone cannot be restored', async () => {
        const { endpoint, posted } = buildEndpoint({ kind: 'clone-failed', error });
        const res = fakeRes();
        await post(endpoint, res);
        expect(res.statusCode).to.equal(422);
        expect(res.body).to.deep.equal({ error, code: 'repository_clone_unavailable' });
        expect(posted).to.deep.equal([]);
    });

    it('does not block a follow-up message on anything but a failed restore', async () => {
        // A worktree conversation's cwd is not a project clone: the resolver denies it, the send proceeds.
        const { endpoint, posted } = buildEndpoint({ kind: 'denied' });
        const res = fakeRes();
        await post(endpoint, res);
        expect(res.statusCode).to.equal(202);
        expect(posted).to.deep.equal(['and now this']);
    });
});

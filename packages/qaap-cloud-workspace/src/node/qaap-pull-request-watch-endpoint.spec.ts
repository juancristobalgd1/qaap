// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationEndpoint } from './qaap-agent-conversation-endpoint';
import { QaapPullRequestWatchError } from './qaap-pull-request-watch-service';

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

type Handler = (req: unknown, res: FakeRes) => void | Promise<void>;

describe('QaapAgentConversationEndpoint pull-request-watch routes', () => {

    function setup(callerLogin: string, convOwner: string): {
        post: Handler;
        del: Handler;
        startedCalls: Array<{ id: string; body: unknown }>;
        stoppedCalls: string[];
    } {
        const routes = new Map<string, Handler>();
        const app = {
            use: () => undefined,
            get: () => undefined,
            post: (route: string, handler: Handler) => routes.set(`POST ${route}`, handler),
            patch: () => undefined,
            delete: (route: string, handler: Handler) => routes.set(`DELETE ${route}`, handler),
        };
        const conv: QaapAgentConversation = {
            id: 'c1',
            cwd: '/workspace/repos/users/alice/acme/demo',
            agentId: 'claude',
            ownerLogin: convOwner,
            title: 'Test',
            status: 'idle',
            createdAt: 1,
            updatedAt: 1,
            messages: [],
        };
        const startedCalls: Array<{ id: string; body: unknown }> = [];
        const stoppedCalls: string[] = [];
        const endpoint = Object.create(QaapAgentConversationEndpoint.prototype) as QaapAgentConversationEndpoint;
        Object.assign(endpoint, {
            store: {
                get: (id: string) => (id === conv.id ? conv : undefined),
                conversations: new Map([[conv.id, conv]]),
            },
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: callerLogin }),
                resolveUserLogin: (ctx: { userLogin?: string }) => ctx.userLogin,
                ownsWorkspacePath: (_ctx: unknown, _cwd: string) => callerLogin === convOwner,
                denyForbidden: (res: FakeRes) => { res.status(403).json({ error: 'Forbidden' }); return true; },
            },
            pullRequestWatches: {
                startWatch: async (id: string, body: unknown) => {
                    startedCalls.push({ id, body });
                    if ((body as { number?: number }).number === -1) {
                        throw new QaapPullRequestWatchError(400, 'Invalid number');
                    }
                    return { ...conv, pullRequestWatch: { owner: 'acme', repo: 'demo', number: 42, startedAt: 1, startedBy: 'user', state: 'watching', lastSeen: { reviewIds: [], commentIds: [] } } };
                },
                stopWatch: (id: string) => {
                    stoppedCalls.push(id);
                    return { ...conv, pullRequestWatch: { owner: 'acme', repo: 'demo', number: 42, startedAt: 1, startedBy: 'user', state: 'stopped', stopReason: 'user', lastSeen: { reviewIds: [], commentIds: [] } } };
                },
            },
        });
        endpoint.configure(app as never);
        return {
            post: routes.get('POST /qaap/api/agent-conversations/:id/pull-request-watch')!,
            del: routes.get('DELETE /qaap/api/agent-conversations/:id/pull-request-watch')!,
            startedCalls,
            stoppedCalls,
        };
    }

    it('allows the owner to start and stop watching a PR', async () => {
        const h = setup('alice', 'alice');
        const startRes = fakeRes();
        await h.post({ params: { id: 'c1' }, body: { number: 42 } }, startRes);
        expect(startRes.statusCode).to.equal(200);
        expect(h.startedCalls).to.deep.equal([{ id: 'c1', body: { number: 42, startedBy: 'user' } }]);
        expect((startRes.body as { pullRequestWatch?: { state: string } }).pullRequestWatch?.state).to.equal('watching');

        const stopRes = fakeRes();
        await h.del({ params: { id: 'c1' } }, stopRes);
        expect(stopRes.statusCode).to.equal(200);
        expect(h.stoppedCalls).to.deep.equal(['c1']);
        expect((stopRes.body as { pullRequestWatch?: { state: string } }).pullRequestWatch?.state).to.equal('stopped');
    });

    it('rejects non-owners on both start and stop', async () => {
        const h = setup('bob', 'alice');
        const startRes = fakeRes();
        await h.post({ params: { id: 'c1' }, body: { number: 42 } }, startRes);
        expect(startRes.statusCode).to.equal(403);
        expect(h.startedCalls).to.have.length(0);

        const stopRes = fakeRes();
        await h.del({ params: { id: 'c1' } }, stopRes);
        expect(stopRes.statusCode).to.equal(403);
        expect(h.stoppedCalls).to.have.length(0);
    });
});

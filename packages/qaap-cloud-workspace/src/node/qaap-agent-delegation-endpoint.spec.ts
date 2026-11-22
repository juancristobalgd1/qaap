// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The delegation endpoint on a real Express app (ephemeral port), with the real token service and the
 * real delegation service over a fake conversation store. The second suite drives the real MCP shim
 * against it end to end (delegate → status → wait), with no model involved.
 */

import { expect } from 'chai';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as express from '@theia/core/shared/express';
import {
    QAAP_AGENT_DELEGATION_API_PATH,
    QAAP_AGENT_DELEGATION_TOKEN_ENV,
    QAAP_AGENT_DELEGATION_TOKEN_HEADER,
    QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN,
    QAAP_AGENT_DELEGATION_URL_ENV,
} from '../common/qaap-agent-delegation-protocol';
import { QaapAgentDelegationEndpoint } from './qaap-agent-delegation-endpoint';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';
import { FakeStore, makeService, parentConversation, useDelegationFlag } from './test/qaap-agent-delegation-fake-store';
import { startQaapDelegateShim } from './test/qaap-delegate-mcp-client';

class TestDelegationEndpoint extends QaapAgentDelegationEndpoint {
    testEnv: NodeJS.ProcessEnv = { QAAP_AGENT_DELEGATION: '1' };
    protected override env(): NodeJS.ProcessEnv {
        return this.testEnv;
    }
}

interface Harness {
    readonly store: FakeStore;
    readonly tokens: QaapToolGateTokenService;
    readonly endpoint: TestDelegationEndpoint;
    readonly baseUrl: string;
    close(): Promise<void>;
}

/** Parent `parent` (owner alice) with its running turn `turn-1` on task `task-parent`. */
async function startHarness(): Promise<Harness> {
    const store = new FakeStore();
    store.conversations.set('parent', parentConversation({ autoApprove: undefined, approvalPolicyId: undefined }));
    store.conversations.set('parent-2', parentConversation({ id: 'parent-2', autoApprove: undefined, approvalPolicyId: undefined }));
    store.taskToConversation.set('task-parent', { conversationId: 'parent', userMessageId: 'turn-1', turnAgentId: 'claude' });
    store.taskToConversation.set('task-parent-2', { conversationId: 'parent-2', userMessageId: 'turn-1', turnAgentId: 'claude' });
    const { service } = makeService(store);
    const tokens = new QaapToolGateTokenService();
    const endpoint = new TestDelegationEndpoint();
    Object.assign(endpoint, { tokens, delegation: service, store });
    const app = express();
    endpoint.configure(app);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        store,
        tokens,
        endpoint,
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: async () => {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        },
    };
}

async function post(harness: Harness, route: string, body: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${harness.baseUrl}${QAAP_AGENT_DELEGATION_API_PATH}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { [QAAP_AGENT_DELEGATION_TOKEN_HEADER]: token } : {}) },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('QaapAgentDelegationEndpoint', function (): void {
    useDelegationFlag();
    this.timeout(15_000);
    let harness: Harness;
    let parentToken: string;

    beforeEach(async () => {
        harness = await startHarness();
        parentToken = harness.tokens.issueDelegation('task-parent', 'alice', '/repo')!.token;
    });
    afterEach(() => harness.close());

    it('answers 404 disabled for every route while the flag is off', async () => {
        harness.endpoint.testEnv = {};
        for (const route of ['/delegate', '/wait', '/status', '/cancel', '/child-apply']) {
            const response = await post(harness, route, {}, parentToken);
            expect(response.status, route).to.equal(404);
            expect(response.body.code).to.equal('disabled');
        }
        expect(harness.store.conversations.size).to.equal(2);
    });

    it('answers 401 without a token and with an unknown, revoked or expired one', async () => {
        expect((await post(harness, '/status', {})).status).to.equal(401);
        expect((await post(harness, '/status', {}, 'deadbeef')).body.code).to.equal('unauthorized');
        harness.tokens.revoke('task-parent');
        expect((await post(harness, '/status', {}, parentToken)).status).to.equal(401);
    });

    it('answers 403 for a token without the delegate scope (a child or a plain gate token)', async () => {
        const gateOnly = harness.tokens.issue('task-gate', 'alice', '/repo');
        const child = harness.tokens.issue('task-child', 'alice', '/repo');
        const oneShot = harness.tokens.issueOneShot('claude', 'alice', '/repo').token;
        for (const token of [gateOnly, child, oneShot]) {
            const response = await post(harness, '/delegate', { prompt: 'x' }, token);
            expect(response.status).to.equal(403);
            expect(response.body.code).to.equal('forbidden');
        }
        expect(harness.store.conversations.size).to.equal(2);
    });

    it('on a tenant backend refuses a token of another tenant, and everything when the tenant is unknown', async () => {
        harness.endpoint.testEnv = { QAAP_AGENT_DELEGATION: '1', QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'bob' };
        expect((await post(harness, '/status', {}, parentToken)).status).to.equal(403);
        harness.endpoint.testEnv = { QAAP_AGENT_DELEGATION: '1', QAAP_TENANT_BACKEND_MODE: '1' };
        expect((await post(harness, '/status', {}, parentToken)).status).to.equal(403);
        harness.endpoint.testEnv = { QAAP_AGENT_DELEGATION: '1', QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'Alice' };
        expect((await post(harness, '/status', {}, parentToken)).status).to.equal(200);
    });

    it('answers 403 when the token belongs to no conversation turn', async () => {
        const orphan = harness.tokens.issueDelegation('task-standalone', 'alice', '/repo')!.token;
        expect((await post(harness, '/delegate', { prompt: 'x' }, orphan)).status).to.equal(403);
    });

    it('answers 400 for a body that names a cwd, an owner or a parent', async () => {
        for (const body of [{ prompt: 'x', cwd: '/etc' }, { prompt: 'x', ownerLogin: 'bob' }, { prompt: 'x', parentConversationId: 'parent-2' }, []]) {
            const response = await post(harness, '/delegate', body, parentToken);
            expect(response.status).to.equal(400);
            expect(response.body.code).to.equal('invalid-request');
        }
    });

    it('creates a child of the token\'s conversation and turn (happy path)', async () => {
        const response = await post(harness, '/delegate', { prompt: 'audit the parser', title: 'Audit' }, parentToken);
        expect(response.status).to.equal(200);
        const child = response.body.child as Record<string, unknown>;
        expect(child.state).to.equal('running');
        expect(child.title).to.equal('Audit');
        const stored = harness.store.conversations.get(child.childId as string)!;
        expect(stored.parentConversationId).to.equal('parent');
        expect(stored.ownerLogin).to.equal('alice');
        expect(stored.delegation?.parentTurnId).to.equal('turn-1');
    });

    it('answers 404 for a child of another parent, without revealing it exists', async () => {
        const otherToken = harness.tokens.issueDelegation('task-parent-2', 'alice', '/repo')!.token;
        const foreign = (await post(harness, '/delegate', { prompt: 'x' }, otherToken)).body.child as Record<string, unknown>;
        for (const route of ['/status', '/cancel', '/child-apply']) {
            const response = await post(harness, route, { childId: foreign.childId }, parentToken);
            expect(response.status, route).to.equal(404);
            expect(response.body.code).to.equal('not-found');
        }
        expect((await post(harness, '/wait', { childIds: [foreign.childId], timeoutSec: 1 }, parentToken)).status).to.equal(404);
        expect(harness.store.cancelled).to.deep.equal([]);
    });

    it('lists the selectable harnesses for the token\'s parent', async () => {
        const response = await post(harness, '/list-agents', {}, parentToken);
        expect(response.status).to.equal(200);
        const agents = response.body.agents as { agent: string; selectable: boolean }[];
        expect(agents.some(agent => agent.agent === 'codex' && agent.selectable)).to.equal(true);
        expect((await post(harness, '/list-agents', { agent: 'x' }, parentToken)).status).to.equal(400);
    });

    it('maps the per-turn limit to 429', async () => {
        for (let i = 0; i < 12; i++) {
            expect((await post(harness, '/delegate', { prompt: `part ${i}` }, parentToken)).status).to.equal(200);
        }
        const response = await post(harness, '/delegate', { prompt: 'one too many' }, parentToken);
        expect(response.status).to.equal(429);
        expect(response.body.code).to.equal('limit-reached');
    });
});

describe('agent delegation end to end: MCP shim → endpoint → service (no model)', function (): void {
    useDelegationFlag();
    this.timeout(20_000);
    let harness: Harness;

    beforeEach(async () => {
        harness = await startHarness();
    });
    afterEach(() => harness.close());

    it('delegates, reads status and waits for the report through the real shim', async () => {
        const token = harness.tokens.issueDelegation('task-parent', 'alice', '/repo')!.token;
        const shim = startQaapDelegateShim({ [QAAP_AGENT_DELEGATION_URL_ENV]: harness.baseUrl, [QAAP_AGENT_DELEGATION_TOKEN_ENV]: token });
        try {
            await shim.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
            const delegated = await shim.request('tools/call', { name: 'qaaq_delegate', arguments: { prompt: 'Count the TODOs in src/', isolation: 'worktree' } });
            expect(delegated.result.isError).to.equal(undefined);
            const childId = JSON.parse(delegated.result.content[0].text).child.childId as string;
            expect(harness.store.conversations.get(childId)?.parentConversationId).to.equal('parent');

            const status = await shim.request('tools/call', { name: 'qaaq_task_status', arguments: { childId } });
            const statusBody = JSON.parse(status.result.content[0].text);
            expect(statusBody.children[0].state).to.equal('running');
            expect(statusBody.totals.maxConcurrent).to.equal(3);

            const waiting = shim.request('tools/call', { name: 'qaaq_task_wait', arguments: { childIds: [childId], timeoutSec: 10 } });
            await new Promise(resolve => setTimeout(resolve, 200));
            harness.store.settle(childId, 'completed', 'Found 7 TODOs.');
            const waited = await waiting;
            const report = JSON.parse(waited.result.content[0].text);
            expect(report.timedOut).to.equal(false);
            expect(report.finished).to.have.length(1);
            expect(report.finished[0].state).to.equal('completed');
            expect(report.finished[0].summary.startsWith(QAAP_AGENT_DELEGATION_UNTRUSTED_OPEN)).to.equal(true);
            expect(report.finished[0].summary).to.contain('Found 7 TODOs.');
            expect(shim.stderr()).to.not.contain(token);
        } finally {
            await shim.close();
        }
    });

    it('a child\'s token (no delegate scope) gets an error result, not a child', async () => {
        const childToken = harness.tokens.issue('task-parent', 'alice', '/repo');
        const shim = startQaapDelegateShim({ [QAAP_AGENT_DELEGATION_URL_ENV]: harness.baseUrl, [QAAP_AGENT_DELEGATION_TOKEN_ENV]: childToken });
        try {
            const reply = await shim.request('tools/call', { name: 'qaaq_delegate', arguments: { prompt: 'x' } });
            expect(reply.result.isError).to.equal(true);
            expect(reply.result.content[0].text).to.contain('403 forbidden');
            expect(harness.store.conversations.size).to.equal(2);
        } finally {
            await shim.close();
        }
    });
});

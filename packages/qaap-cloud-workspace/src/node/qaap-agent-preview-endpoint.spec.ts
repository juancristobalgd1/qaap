// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import type { QaapAgentPreviewOperation } from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import { QaapAgentPreviewEndpoint } from './qaap-agent-preview-endpoint';
import type { QaapAgentPreviewCaller } from './qaap-agent-preview-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

interface FakeTask {
    readonly cwd: string;
    readonly readOnlyWorkspace?: boolean;
    readonly delegationRole?: 'parent' | 'child';
}

class TestEndpoint extends QaapAgentPreviewEndpoint {
    envValues: NodeJS.ProcessEnv = { QAAP_AGENT_PREVIEW_TOOLS: '1' };
    readonly calls: { operation: string; caller: QaapAgentPreviewCaller; body: unknown }[] = [];
    readonly tasks = new Map<string, FakeTask>();
    readonly conversations = new Map<string, { cwd: string; parentConversationId?: string }>();
    readonly turns = new Map<string, { conversationId: string; userMessageId: string }>();
    constructor(readonly tokenService: QaapToolGateTokenService) {
        super();
        const self = this as unknown as Record<string, unknown>;
        self.tokens = tokenService;
        self.store = {
            taskToConversation: this.turns,
            findTaskById: (id: string) => this.tasks.get(id),
            get: (id: string) => this.conversations.get(id),
        };
        const record = (operation: string) => async (caller: QaapAgentPreviewCaller, body: unknown) => {
            this.calls.push({ operation, caller, body });
            return { status: 'ready' };
        };
        self.previews = {
            start: record('start'), restart: record('restart'), status: record('status'),
            logs: (caller: QaapAgentPreviewCaller, body: unknown) => {
                this.calls.push({ operation: 'logs', caller, body });
                return { lines: [], droppedLines: 0, note: '' };
            },
            stop: record('stop'), snapshot: record('snapshot'),
        };
        self.auth = {
            authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
            ownsWorkspacePath: (_ctx: unknown, cwd: string) => cwd.startsWith('/work/alice'),
        };
    }
    protected override env(): NodeJS.ProcessEnv {
        return this.envValues;
    }
    async call(operation: QaapAgentPreviewOperation, token: string | undefined, body: unknown = {}, user = false): Promise<{ status: number; json: Record<string, unknown> }> {
        let status = 200;
        let json: Record<string, unknown> = {};
        const res: { headersSent: boolean; status(code: number): unknown; json(value: Record<string, unknown>): unknown } = {
            headersSent: false,
            status(code: number): unknown {
                status = code;
                return res;
            },
            json(value: Record<string, unknown>): unknown {
                json = value;
                res.headersSent = true;
                return res;
            },
        };
        const req = {
            path: user ? `/qaap/api/preview/${operation}` : `/qaap/api/agent-preview/${operation}`,
            body,
            header: (name: string) => name.toLowerCase() === 'x-qaap-delegation-token' ? token : undefined,
        } as unknown as Request;
        await this.handle(req, res as unknown as Response, operation, user ? () => this.userCaller(req) : () => this.agentCaller(req));
        return { status, json };
    }
}

describe('QaapAgentPreviewEndpoint', () => {
    function setup(task: FakeTask = { cwd: '/work/alice/app' }, conversation: { cwd: string; parentConversationId?: string } = { cwd: '/work/alice/app' }): { endpoint: TestEndpoint; token: string } {
        const tokens = new QaapToolGateTokenService();
        const endpoint = new TestEndpoint(tokens);
        endpoint.tasks.set('task-1', task);
        endpoint.turns.set('task-1', { conversationId: 'conv-1', userMessageId: 'm1' });
        endpoint.conversations.set('conv-1', conversation);
        const issued = tokens.issueAgentMcp('task-1', 'alice', task.cwd, ['preview'])!;
        return { endpoint, token: issued.token };
    }

    it('derives owner, conversation and cwd from the token\'s task', async () => {
        const { endpoint, token } = setup();
        const result = await endpoint.call('start', token, { script: 'start' });
        expect(result.status).to.equal(200);
        expect(endpoint.calls[0].caller).to.deep.include({ ownerLogin: 'alice', conversationId: 'conv-1', cwd: '/work/alice/app', canControl: true, ownership: 'agent' });
        expect(endpoint.calls[0].body).to.deep.equal({ script: 'start' });
    });

    it('lets an ownerless local task (desktop, no signed-in user) use its preview as the local login', async () => {
        // Desktop QA, 26 Nov 2026: every preview call answered 403 "This task has no preview tools".
        const tokens = new QaapToolGateTokenService();
        const endpoint = new TestEndpoint(tokens);
        endpoint.tasks.set('task-1', { cwd: '/work/app' });
        endpoint.turns.set('task-1', { conversationId: 'conv-1', userMessageId: 'm1' });
        endpoint.conversations.set('conv-1', { cwd: '/work/app' });
        const token = tokens.issueAgentMcp('task-1', undefined, '/work/app', ['preview'])!.token;
        const result = await endpoint.call('start', token, { script: 'start' });
        expect(result.status).to.equal(200);
        expect(endpoint.calls[0].caller).to.deep.include({ ownerLogin: '_dev', conversationId: 'conv-1', canControl: true });
    });

    it('a hosted tenant backend still refuses an ownerless preview token', async () => {
        const tokens = new QaapToolGateTokenService();
        const endpoint = new TestEndpoint(tokens);
        endpoint.envValues = { ...endpoint.envValues, QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'alice' };
        endpoint.tasks.set('task-1', { cwd: '/work/app' });
        endpoint.turns.set('task-1', { conversationId: 'conv-1', userMessageId: 'm1' });
        endpoint.conversations.set('conv-1', { cwd: '/work/app' });
        const token = tokens.issueAgentMcp('task-1', undefined, '/work/app', ['preview'])!.token;
        expect((await endpoint.call('start', token, { script: 'start' })).status).to.equal(403);
    });

    it('answers 404 while the agent tools are off', async () => {
        const { endpoint, token } = setup();
        endpoint.envValues = {};
        expect((await endpoint.call('status', token)).status).to.equal(404);
    });

    it('refuses a missing token, a gate token and a delegation-only token', async () => {
        const { endpoint } = setup();
        expect((await endpoint.call('status', undefined)).status).to.equal(401);
        const gate = endpoint.tokenService.issue('task-1', 'alice', '/work/alice/app');
        expect((await endpoint.call('status', gate)).status).to.equal(403);
        const delegateOnly = endpoint.tokenService.issueAgentMcp('task-1', 'alice', '/work/alice/app', ['delegate'])!.token;
        const refused = await endpoint.call('status', delegateOnly);
        expect(refused.status).to.equal(403);
        expect(refused.json.error).to.include('no preview tools');
    });

    it('refuses a token of another tenant on a tenant backend', async () => {
        const { endpoint, token } = setup();
        endpoint.envValues = { QAAP_AGENT_PREVIEW_TOOLS: '1', QAAP_TENANT_BACKEND_MODE: '1', QAAP_TENANT_LOGIN: 'bob' };
        expect((await endpoint.call('status', token)).status).to.equal(403);
    });

    it('lets a plan-mode turn read but not start, restart or stop (D7)', async () => {
        const { endpoint, token } = setup({ cwd: '/work/alice/app', readOnlyWorkspace: true });
        for (const operation of ['start', 'restart', 'stop'] as const) {
            const result = await endpoint.call(operation, token);
            expect(result.status, operation).to.equal(403);
            expect(result.json.code).to.equal('read-only');
        }
        expect((await endpoint.call('status', token)).status).to.equal(200);
        expect((await endpoint.call('logs', token)).status).to.equal(200);
        expect((await endpoint.call('snapshot', token)).status).to.equal(200);
    });

    it('points a delegated child at its parent\'s preview, read-only (D3)', async () => {
        const { endpoint, token } = setup({ cwd: '/work/alice/wt-child', delegationRole: 'child' }, { cwd: '/work/alice/wt-child', parentConversationId: 'parent-1' });
        endpoint.conversations.set('parent-1', { cwd: '/work/alice/app' });
        expect((await endpoint.call('start', token)).json.code).to.equal('read-only');
        await endpoint.call('status', token);
        expect(endpoint.calls[0].caller).to.deep.include({ conversationId: 'parent-1', cwd: '/work/alice/app', canControl: false });
    });

    it('rejects invalid bodies before calling the service', async () => {
        const { endpoint, token } = setup();
        const result = await endpoint.call('start', token, { argv: ['npm run dev'] });
        expect(result.status).to.equal(400);
        expect(endpoint.calls).to.have.length(0);
    });

    it('serves signed-in users on their own workspace paths only', async () => {
        const { endpoint } = setup();
        endpoint.envValues = { QAAP_PREVIEW_SERVICE: '1' };
        const ok = await endpoint.call('start', undefined, { cwd: '/work/alice/app', conversationId: 'c-9', script: 'dev' }, true);
        expect(ok.status).to.equal(200);
        expect(endpoint.calls[0].caller).to.deep.include({ ownerLogin: 'alice', conversationId: 'c-9', cwd: '/work/alice/app', ownership: 'user' });
        expect(endpoint.calls[0].body).to.deep.equal({ script: 'dev' });
        expect((await endpoint.call('start', undefined, { cwd: '/work/bob/app' }, true)).status).to.equal(403);
        endpoint.envValues = {};
        expect((await endpoint.call('status', undefined, { cwd: '/work/alice/app' }, true)).status).to.equal(404);
    });

    it('exposes backend preview feature flags from GET /qaap/api/preview/config for signed-in users', () => {
        const { endpoint } = setup();
        endpoint.envValues = { QAAP_AGENT_PREVIEW_TOOLS: '1', QAAP_PREVIEW_AGENT_DRIVEN: '1' };
        let status = 200;
        let payload: unknown;
        const res = {
            headersSent: false,
            status(code: number): unknown { status = code; return this; },
            json(data: unknown): void { payload = data; },
        };
        (endpoint as unknown as { handleConfig(req: unknown, res: unknown): void }).handleConfig({ header: () => undefined }, res);
        expect(status).to.equal(200);
        expect(payload).to.deep.equal({ previewService: true, agentPreviewTools: true, agentDriven: true });
    });
});

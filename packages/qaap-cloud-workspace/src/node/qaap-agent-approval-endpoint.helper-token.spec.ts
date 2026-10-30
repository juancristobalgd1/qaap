// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import { QAAP_AGENT_APPROVAL_API_PATH } from '../common/qaap-agent-approval';
import { QaapAgentApprovalEndpoint } from './qaap-agent-approval-endpoint';

type Handler = (req: Request, res: Response) => void;

/**
 * The per-owner agent helper token (`x-qaap-task-token`) is only meant to create sub-tasks. A
 * model-controlled agent holding it must not be able to list, approve or reject tool approvals.
 */
describe('QaapAgentApprovalEndpoint rejects the agent helper token', () => {

    const ENV_KEYS = ['QAAP_SKIP_AUTH', 'QAAP_TENANT_BACKEND_MODE'];
    const saved: Record<string, string | undefined> = {};
    let routes: Map<string, Handler>;
    let storeCalls: string[];

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
        routes = new Map();
        storeCalls = [];
        const guard = Object.create(QaapGithubAuthGuard.prototype) as QaapGithubAuthGuard;
        // Real guard: no session store entry exists for a request that only carries the helper token.
        Object.assign(guard, { sessions: { getSession: () => undefined }, apiTokens: undefined });
        const record = (name: string) => async (): Promise<unknown> => { storeCalls.push(name); return { ok: true }; };
        const endpoint = Object.create(QaapAgentApprovalEndpoint.prototype) as QaapAgentApprovalEndpoint;
        Object.assign(endpoint, {
            auth: guard,
            store: { list: record('list'), approve: record('approve'), reject: record('reject') },
        });
        endpoint.configure({
            get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
            post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
        } as unknown as Application);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    async function call(route: string): Promise<number> {
        const handler = routes.get(route);
        expect(handler, route).to.not.equal(undefined);
        let statusCode = 200;
        let settle: () => void = () => undefined;
        const done = new Promise<void>(resolve => { settle = resolve; });
        const res = {
            status: (code: number) => { statusCode = code; return res; },
            json: () => { settle(); return res; },
        };
        const req = {
            headers: { 'x-qaap-task-token': 'any-helper-token' },
            params: { id: 'a1' },
            query: {},
            body: {},
            header: (name: string) => name.toLowerCase() === 'x-qaap-task-token' ? 'any-helper-token' : undefined,
        };
        handler!(req as unknown as Request, res as unknown as Response);
        await done;
        return statusCode;
    }

    it('answers 401 on the approvals list', async () => {
        expect(await call(`GET ${QAAP_AGENT_APPROVAL_API_PATH}`)).to.equal(401);
    });

    it('answers 401 on approve', async () => {
        expect(await call(`POST ${QAAP_AGENT_APPROVAL_API_PATH}/:id/approve`)).to.equal(401);
    });

    it('answers 401 on reject', async () => {
        expect(await call(`POST ${QAAP_AGENT_APPROVAL_API_PATH}/:id/reject`)).to.equal(401);
    });

    it('never reaches the approval store', async () => {
        await call(`GET ${QAAP_AGENT_APPROVAL_API_PATH}`);
        await call(`POST ${QAAP_AGENT_APPROVAL_API_PATH}/:id/approve`);
        await call(`POST ${QAAP_AGENT_APPROVAL_API_PATH}/:id/reject`);
        expect(storeCalls).to.deep.equal([]);
    });
});

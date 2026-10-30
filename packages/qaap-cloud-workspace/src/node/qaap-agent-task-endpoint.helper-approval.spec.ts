// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { QAAP_AGENT_TASK_API_PATH } from '../common/qaap-agent-task';
import { QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';

type Handler = (req: Request, res: Response) => void;

/**
 * A sub-task created with the agent helper token must never be more permissive than its parent:
 * the body's autoApprove / approvalPolicyId are ignored.
 */
describe('QaapAgentTaskEndpoint helper-token sub-task approval policy', () => {

    const LOGIN = 'alice';
    let created: Array<Record<string, unknown>>;
    let routes: Map<string, Handler>;
    let parentTasks: Array<Record<string, unknown>>;

    beforeEach(() => {
        created = [];
        routes = new Map();
        parentTasks = [];
        const endpoint = Object.create(QaapAgentTaskEndpoint.prototype) as QaapAgentTaskEndpoint;
        Object.assign(endpoint, {
            billingStore: undefined,
            modelFallback: undefined,
            cloneRecovery: undefined,
            auth: {
                authenticate: () => ({ kind: 'unauthorized' }),
                resolveOwnedRepositoryCwdForLogin: () => ({ kind: 'ok', cwd: '/repo' }),
                denyForbidden: () => undefined,
            },
            runner: {
                resolveHelperTokenOwner: (token: string) => token === 'good' ? { ownerLogin: LOGIN } : undefined,
                defaultAgentFresh: async () => undefined,
                storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
                list: () => parentTasks,
                create: (request: Record<string, unknown>) => {
                    created.push(request);
                    return { id: 'new' };
                },
            },
        });
        const app = {
            get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
            post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
            delete: (path: string, handler: Handler) => routes.set(`DELETE ${path}`, handler),
        } as unknown as Application;
        endpoint.configure(app);
    });

    async function createWithHelper(body: Record<string, unknown>): Promise<number> {
        const handler = routes.get(`POST ${QAAP_AGENT_TASK_API_PATH}`)!;
        let statusCode = 200;
        let settle: () => void = () => undefined;
        const done = new Promise<void>(resolve => { settle = resolve; });
        const res = {
            status: (code: number) => { statusCode = code; return res; },
            set: () => res,
            json: () => { settle(); return res; },
        };
        const header = (name: string): string | undefined => name.toLowerCase() === 'x-qaap-task-token' ? 'good' : undefined;
        handler({ params: {}, query: {}, body, header } as unknown as Request, res as unknown as Response);
        await done;
        return statusCode;
    }

    const escalation = { cwd: '/repo', prompt: 'x', agent: 'qaiq', autoApprove: true, approvalPolicyId: 'full-access' };

    it('forces request-approval when the parent is unknown', async () => {
        expect(await createWithHelper(escalation)).to.equal(201);
        expect(created[0].autoApprove).to.equal(false);
        expect(created[0].approvalPolicyId).to.equal('request-approval');
    });

    it('forces request-approval when the parent requires approval', async () => {
        parentTasks = [{ id: 'p1', ownerLogin: LOGIN, autoApprove: false }];
        await createWithHelper({ ...escalation, parentId: 'p1' });
        expect(created[0].autoApprove).to.equal(false);
        expect(created[0].approvalPolicyId).to.equal('request-approval');
    });

    it('never forwards full-access from the body, even with an auto-approving parent', async () => {
        parentTasks = [{ id: 'p1', ownerLogin: LOGIN, autoApprove: true }];
        await createWithHelper({ ...escalation, parentId: 'p1' });
        expect(created[0].autoApprove).to.equal(undefined);
        expect(created[0].approvalPolicyId).to.equal(undefined);
    });

    it('ignores a parent owned by someone else', async () => {
        parentTasks = [{ id: 'p1', ownerLogin: 'bob', autoApprove: true }];
        await createWithHelper({ ...escalation, parentId: 'p1' });
        expect(created[0].approvalPolicyId).to.equal('request-approval');
    });
});

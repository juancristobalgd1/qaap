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
 * Every runner call that resolves per-user AI settings, credentials or agent availability must receive the
 * authenticated caller (their BYOK keys, model lists, disabled harnesses) — never run owner-less.
 */
describe('QaapAgentTaskEndpoint passes the caller to owner-scoped runner calls', () => {

    const LOGIN = 'alice';
    let calls: Array<[string, unknown[]]>;
    let routes: Map<string, Handler>;
    let endpoint: QaapAgentTaskEndpoint;

    const record = (name: string, result: unknown) => (...args: unknown[]): unknown => {
        calls.push([name, args]);
        return result;
    };
    const ownerArgs = (name: string): unknown[][] => calls.filter(([called]) => called === name).map(([, args]) => args);

    beforeEach(() => {
        calls = [];
        routes = new Map();
        const task = { id: 't1', cwd: '/repo', ownerLogin: LOGIN };
        endpoint = Object.create(QaapAgentTaskEndpoint.prototype) as QaapAgentTaskEndpoint;
        Object.assign(endpoint, {
            billingStore: undefined,
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: LOGIN }),
                resolveUserLogin: () => LOGIN,
                ownsWorkspacePath: () => true,
                resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' }),
                denyForbidden: () => undefined,
            },
            runner: {
                listForCwd: () => [task],
                isAgentConfigured: () => true,
                isQaiqInstalled: () => true,
                refreshAgentCatalog: () => undefined,
                resolveHelperTokenOwner: () => undefined,
                listAgents: record('listAgents', []),
                defaultAgent: record('defaultAgent', 'qaiq'),
                listQaiqModels: record('listQaiqModels', []),
                listModelsForAgent: record('listModelsForAgent', [{ modelId: 'm' }]),
                retry: record('retry', task),
                resume: record('resume', task),
                create: record('create', task),
                improveComposerPrompt: async (options: unknown) => {
                    calls.push(['improveComposerPrompt', [options]]);
                    return 'better';
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

    function response(): Response & { done: Promise<void> } {
        let settle: () => void = () => undefined;
        const done = new Promise<void>(resolve => { settle = resolve; });
        const res = {
            done,
            status: () => res,
            set: () => res,
            setHeader: () => res,
            json: () => { settle(); return res; },
        };
        return res as unknown as Response & { done: Promise<void> };
    }

    async function call(route: string, req: Partial<Request>): Promise<void> {
        const handler = routes.get(route);
        expect(handler, route).to.not.equal(undefined);
        const res = response();
        handler!({ params: {}, query: {}, body: {}, header: () => undefined, ...req } as unknown as Request, res);
        await res.done;
    }

    it('task list and dashboard feed resolve agents, default agent and QAIQ models for the caller', async () => {
        await call(`GET ${QAAP_AGENT_TASK_API_PATH}`, {});
        await call(`GET ${QAAP_AGENT_TASK_API_PATH}/all`, {});
        for (const name of ['listAgents', 'defaultAgent', 'listQaiqModels']) {
            expect(ownerArgs(name), name).to.deep.equal([[LOGIN], [LOGIN]]);
        }
    });

    it('agent model picker, retry, resume, create and improve prompt run as the caller', async () => {
        await call(`GET ${QAAP_AGENT_TASK_API_PATH}/agent-models`, { query: { agent: '@codex' } as never });
        await call(`POST ${QAAP_AGENT_TASK_API_PATH}/:id/retry`, { params: { id: 't1' } as never });
        await call(`POST ${QAAP_AGENT_TASK_API_PATH}/:id/resume`, { params: { id: 't1' } as never });
        await call(`POST ${QAAP_AGENT_TASK_API_PATH}`, { body: { cwd: '/repo', prompt: 'hola', agent: 'qaiq' } });
        await call(`POST ${QAAP_AGENT_TASK_API_PATH}/improve-prompt`, { body: { prompt: 'hola', agentId: 'qaiq', cwd: '/repo' } });

        expect(ownerArgs('listModelsForAgent')).to.deep.equal([['codex', LOGIN]]);
        expect(ownerArgs('retry')).to.deep.equal([['t1', LOGIN]]);
        expect(ownerArgs('resume')).to.deep.equal([['t1', LOGIN]]);
        expect(ownerArgs('create').map(args => args[1])).to.deep.equal([LOGIN]);
        expect(ownerArgs('improveComposerPrompt').map(([options]) => (options as { ownerLogin?: string }).ownerLogin)).to.deep.equal([LOGIN]);
    });
});

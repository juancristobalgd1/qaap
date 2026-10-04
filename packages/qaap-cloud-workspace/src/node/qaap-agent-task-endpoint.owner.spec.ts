// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { QAAP_AGENT_TASK_API_PATH } from '../common/qaap-agent-task';
import { QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';
import { ComposerPromptImproveTimeoutError } from '@theia/qaap-composer/lib/common/qaap-composer-prompt-improve';

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
            cliUpdates: { isInstallSupported: () => false },
            runner: {
                listForCwd: () => [task],
                isAgentConfigured: () => true,
                isQaiqInstalled: () => true,
                refreshAgentCatalog: () => undefined,
                resolveHelperTokenOwner: () => undefined,
                listAgents: record('listAgents', []),
                // `/all` lists agents through the probe-budgeted variant; it must stay owner-scoped too.
                listAgentsFresh: record('listAgents', Promise.resolve([])),
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

    function response(): Response & { done: Promise<void>; result: () => { statusCode: number; body: unknown } } {
        let settle: () => void = () => undefined;
        let statusCode = 200;
        let body: unknown;
        const done = new Promise<void>(resolve => { settle = resolve; });
        const res = {
            done,
            status: (code: number) => { statusCode = code; return res; },
            set: () => res,
            setHeader: () => res,
            json: (value: unknown) => { body = value; settle(); return res; },
            result: () => ({ statusCode, body }),
        };
        return res as unknown as Response & { done: Promise<void>; result: () => { statusCode: number; body: unknown } };
    }

    async function call(route: string, req: Partial<Request>): Promise<{ statusCode: number; body: unknown }> {
        const handler = routes.get(route);
        expect(handler, route).to.not.equal(undefined);
        const res = response();
        handler!({ params: {}, query: {}, body: {}, header: () => undefined, ...req } as unknown as Request, res);
        await res.done;
        return res.result();
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

    it('returns a logged 504 when Improve prompt times out without logging the prompt', async () => {
        const runner = (endpoint as unknown as { runner: { improveComposerPrompt: (options: unknown) => Promise<string> } }).runner;
        runner.improveComposerPrompt = async () => { throw new ComposerPromptImproveTimeoutError(); };
        const previousError = console.error;
        const logEntries: unknown[][] = [];
        console.error = (...data: unknown[]) => { logEntries.push(data); };
        try {
            const result = await call(`POST ${QAAP_AGENT_TASK_API_PATH}/improve-prompt`, {
                body: { prompt: 'private prompt text', agentId: 'qaiq' },
            });
            expect(result.statusCode).to.equal(504);
            expect(result.body).to.deep.equal({ error: 'Prompt improvement timed out. Try again.' });
            expect(logEntries).to.have.length(1);
            expect(JSON.stringify(logEntries)).not.to.contain('private prompt text');
        } finally {
            console.error = previousError;
        }
    });
});

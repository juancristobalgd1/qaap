// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as nodePath from 'path';
import type { AddressInfo } from 'net';
import { WebSocket as WsClient } from '@theia/core/shared/ws';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { QAAP_AGENT_TASK_API_PATH } from '../common/qaap-agent-task';
import { nativeModelChangeMatchesSocketOwner, QaapAgentTaskEndpoint } from './qaap-agent-task-endpoint';
import {
    clearNativeAgentModelCache,
    expireNativeAgentModels,
    prepareNativeAgentModels,
    setNativeModelCatalogStoreDirForTests,
} from './qaap-agent-native-models';
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
                storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
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
                isAgentEnabled: record('isAgentEnabled', true),
                // Pi lists its models from the caller's sign-in, so the picker discovers as the caller.
                nativeModelDiscoverySpawner: record('nativeModelDiscoverySpawner', () => undefined),
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
        expect(ownerArgs('nativeModelDiscoverySpawner')).to.deep.equal([[LOGIN]]);
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
            expect(result.body).to.deep.equal({ error: 'Prompt improvement timed out. Try again.', kind: 'timeout' });
            expect(logEntries).to.have.length(1);
            expect(JSON.stringify(logEntries)).not.to.contain('private prompt text');
        } finally {
            console.error = previousError;
        }
    });
});

describe('QaapAgentTaskEndpoint WebSocket models-changed owner scoping', () => {
    it('delivers owner-scoped events only to matching sockets and never across authenticated owners', () => {
        const aliceCtx = { kind: 'authenticated', userLogin: 'alice', sessionId: 's1', session: { accessToken: '', user: { login: 'alice' } } } as never;
        const bobCtx = { kind: 'authenticated', userLogin: 'bob', sessionId: 's2', session: { accessToken: '', user: { login: 'bob' } } } as never;
        const skipCtx = { kind: 'skip', userLogin: '_dev' } as never;
        const unauthCtx = { kind: 'unauthorized' } as never;

        expect(nativeModelChangeMatchesSocketOwner('alice', aliceCtx, 'alice')).to.equal(true);
        expect(nativeModelChangeMatchesSocketOwner('Alice', aliceCtx, 'ALICE')).to.equal(true);
        expect(nativeModelChangeMatchesSocketOwner('alice', bobCtx, 'bob')).to.equal(false);
        expect(nativeModelChangeMatchesSocketOwner('alice', unauthCtx, undefined)).to.equal(false);
        expect(nativeModelChangeMatchesSocketOwner(undefined, aliceCtx, 'alice')).to.equal(false);
        expect(nativeModelChangeMatchesSocketOwner(undefined, skipCtx, '_dev')).to.equal(true);
    });

    it('pushes models-changed over /ws only to the owner whose native catalog changed', async function (): Promise<void> {
        if (process.platform === 'win32') {
            this.skip();
        }
        const sandbox = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'qaap-ws-models-owner-'));
        const piBin = nodePath.join(sandbox, 'pi');
        fs.writeFileSync(
            piBin,
            '#!/bin/sh\necho "provider  model  context"\necho "groq  llama-3.3-70b-versatile  128K"\n',
            { mode: 0o755 },
        );
        setNativeModelCatalogStoreDirForTests(nodePath.join(sandbox, 'store'));
        clearNativeAgentModelCache();

        const server = http.createServer();
        const endpoint = Object.create(QaapAgentTaskEndpoint.prototype) as QaapAgentTaskEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: (req: { headers?: Record<string, string | string[] | undefined> }) => {
                    const user = String(req.headers?.['x-test-user'] ?? '').trim();
                    return user
                        ? { kind: 'authenticated', userLogin: user, sessionId: `s-${user}`, session: { accessToken: '', user: { login: user } } }
                        : { kind: 'unauthorized' };
                },
                resolveUserLogin: (ctx: { kind: string; userLogin?: string }) => (ctx.kind === 'authenticated' ? ctx.userLogin : undefined),
                ownsWorkspacePath: () => true,
            },
            runner: {
                bindHelperApiUrl: () => undefined,
                listAllGroupedByCwd: () => [],
                isAgentConfigured: () => true,
                isQaiqInstalled: () => false,
                listAgents: () => [],
                defaultAgent: () => 'pi',
                onDidChangeTask: () => ({ dispose: () => undefined }),
            },
        });
        endpoint.onStart(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;

        const connect = (user: string): Promise<{ ws: WsClient; messages: Array<Record<string, unknown>> }> => new Promise((resolve, reject) => {
            const messages: Array<Record<string, unknown>> = [];
            const ws = new WsClient(`ws://127.0.0.1:${port}${QAAP_AGENT_TASK_API_PATH}/ws`, {
                headers: { 'x-test-user': user },
            });
            ws.on('message', data => {
                const parsed = JSON.parse(String(data)) as Record<string, unknown>;
                messages.push(parsed);
                if (parsed.type === 'snapshot') {
                    resolve({ ws, messages });
                }
            });
            ws.once('error', reject);
        });

        let alice: { ws: WsClient; messages: Array<Record<string, unknown>> } | undefined;
        let bob: { ws: WsClient; messages: Array<Record<string, unknown>> } | undefined;
        try {
            alice = await connect('alice');
            bob = await connect('bob');

            const spawner = (file: string, args: readonly string[]) => ({
                file: file === 'pi' ? piBin : file,
                args: [...args],
                env: process.env,
            });
            expireNativeAgentModels('pi', 'alice');
            await prepareNativeAgentModels('pi', { ownerLogin: 'alice', spawner });
            await new Promise(resolve => setTimeout(resolve, 60));

            const aliceEvents = alice.messages.filter(msg => msg.type === 'models-changed');
            const bobEvents = bob.messages.filter(msg => msg.type === 'models-changed');
            expect(aliceEvents).to.deep.equal([{ type: 'models-changed', agentId: 'pi' }]);
            expect(bobEvents).to.deep.equal([]);
        } finally {
            alice?.ws.close();
            bob?.ws.close();
            await new Promise<void>(resolve => server.close(() => resolve()));
            clearNativeAgentModelCache();
            setNativeModelCatalogStoreDirForTests(undefined);
            fs.rmSync(sandbox, { recursive: true, force: true });
        }
    });
});

// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapAgentTaskEndpoint, describeImprovePromptFailure } from './qaap-agent-task-endpoint';
import { QAAP_AGENT_TASK_API_PATH, type QaapAgentTask } from '../common/qaap-agent-task';
import { QAAP_AGENT_CONNECTION_REFRESH_BUDGET_MS } from './qaap-agent-task-runner';
import { QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS } from './qaap-agent-task-runner-utils3';
import { QaapAgentQueueFullError } from './qaap-agent-queue-policy';
import { QaapAgentStorageUnavailableError } from './qaap-agent-storage-unavailable-error';
import type { QaapAgentCliUpdateResult } from '@theia/qaap-agents-ui/lib/common/qaap-agent-cli-update';

class TestableTaskEndpoint extends QaapAgentTaskEndpoint {
    allForTest(req: Request, res: Response): Promise<void> {
        return this.handleListAll(req, res);
    }
    detailForTest(req: Request, res: Response): Promise<void> {
        return this.handleDetail(req, res);
    }
    agentModelsForTest(req: Request, res: Response): Promise<void> {
        return this.handleListAgentModels(req, res);
    }
    retryForTest(req: Request, res: Response): Promise<void> {
        return this.handleStorageRetry(req, res);
    }
    harnessStatusesForTest(req: Request, res: Response): void {
        this.handleListHarnessStatuses(req, res);
    }
    healthForTest(req: Request, res: Response): void {
        this.handleStorageHealth(req, res);
    }
    createForTest(req: Request, res: Response): Promise<void> {
        return this.handleCreate(req, res);
    }
    listCliUpdatesForTest(req: Request, res: Response): Promise<void> {
        return this.handleListCliUpdates(req, res);
    }
    installCliUpdateForTest(req: Request, res: Response): Promise<void> {
        return this.handleInstallCliUpdate(req, res);
    }
    attestForTest(req: Request, res: Response): Promise<void> {
        return this.handleAttestAgentSession(req, res);
    }
}

describe('QaapAgentTaskEndpoint install capability', () => {
    it('reports the backend install policy to authenticated settings clients', async () => {
        for (const installSupported of [false, true]) {
            const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
            const authContext = { kind: 'authenticated', userLogin: 'alice' };
            let payload: unknown;
            Object.assign(endpoint, {
                requireAuth: () => authContext,
                auth: { resolveUserLogin: (context: typeof authContext) => context.userLogin },
                runner: {
                    isAgentConfigured: () => true,
                    isQaiqInstalled: () => false,
                    listAgentsFresh: async () => [],
                    defaultAgent: () => 'shell',
                    defaultAgentFresh: async () => 'shell',
                    listQaiqModels: () => [],
                },
                cliUpdates: { isInstallSupported: () => installSupported },
            });
            const response = { json: (body: unknown) => { payload = body; } };

            await endpoint.allForTest({ query: {} } as Request, response as unknown as Response);

            expect(payload).to.deep.equal({
                agentConfigured: true,
                qaiqInstalled: false,
                agents: [],
                defaultAgent: 'shell',
                qaiqModels: [],
                installSupported,
            });
        }
    });
});

describe('QaapAgentTaskEndpoint catalog refresh', () => {
    it('waits for the real auth probe on an explicit refresh and keeps the short budget otherwise', async () => {
        const budgets: Array<number | undefined> = [];
        let refreshed = 0;
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const authContext = { kind: 'authenticated', userLogin: 'alice' };
        Object.assign(endpoint, {
            requireAuth: () => authContext,
            auth: { resolveUserLogin: (context: typeof authContext) => context.userLogin },
            runner: {
                isAgentConfigured: () => true,
                isQaiqInstalled: () => false,
                refreshAgentCatalog: () => { refreshed++; },
                listAgentsFresh: async (_owner: string, budgetMs?: number) => { budgets.push(budgetMs); return []; },
                defaultAgent: () => 'shell',
                defaultAgentFresh: async () => 'shell',
                listQaiqModels: () => [],
            },
            cliUpdates: { isInstallSupported: () => false },
        });
        const response = { json: () => undefined };

        await endpoint.allForTest({ query: {} } as Request, response as unknown as Response);
        await endpoint.allForTest({ query: { refresh: '1' } } as unknown as Request, response as unknown as Response);

        expect(refreshed).to.equal(1);
        expect(budgets[0]).to.equal(undefined);
        expect(budgets[1]).to.equal(QAAP_AGENT_CONNECTION_REFRESH_BUDGET_MS);
        expect(QAAP_AGENT_CONNECTION_REFRESH_BUDGET_MS).to.be.greaterThan(QAAP_AGENT_CONNECTION_PROBE_TIMEOUT_MS);
    });
});

describe('QaapAgentTaskEndpoint harness status', () => {
    it('returns the full caller-scoped status list, including disabled disconnected harnesses', () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const authContext = { kind: 'authenticated', userLogin: 'alice' };
        let payload: unknown;
        let ownerLogin: string | undefined;
        let cacheControl: string | undefined;
        Object.assign(endpoint, {
            requireAuth: () => authContext,
            auth: { resolveUserLogin: (context: typeof authContext) => context.userLogin },
            runner: {
                resolveAgentCliInstallTarget: () => ({ home: '/home/qaap-agent', uid: 1001, gid: 1001 }),
                listHarnessStatuses: (owner: string | undefined, supports: (id: string) => boolean) => {
                    ownerLogin = owner;
                    return [{
                        id: 'codex',
                        installed: true,
                        enabled: false,
                        connectionState: 'disconnected',
                        installSupported: supports('codex'),
                    }];
                },
            },
            cliUpdates: {
                isAgentInstallSupported: (id: string, target: { uid?: number }) => id === 'codex' && target.uid === 1001,
                hasInstallablePackage: (id: string) => id === 'codex',
            },
        });
        const response = {
            setHeader: (_name: string, value: string) => { cacheControl = value; },
            json: (body: unknown) => { payload = body; },
        };

        endpoint.harnessStatusesForTest({} as Request, response as unknown as Response);

        expect(ownerLogin).to.equal('alice');
        expect(cacheControl).to.equal('no-store');
        expect(payload).to.deep.equal({
            harnesses: [{
                id: 'codex',
                installed: true,
                enabled: false,
                connectionState: 'disconnected',
                installSupported: true,
                installPackageAvailable: true,
            }],
            // Not the desktop app: Settings → Harness hides the binary path and configuration folder.
            launchOverridesSupported: false,
        });
    });
});

describe('QaapAgentTaskEndpoint CLI updates', () => {
    const outdated = { updates: [
        { id: 'claude', label: 'Claude Code', latestVersion: '2.0.0', updateAvailable: true, updateSupported: true },
        { id: 'codex', label: 'Codex', latestVersion: '2.0.0', updateAvailable: true, updateSupported: true },
    ] };

    async function listWith(allowed: boolean, enabledHarnesses: readonly string[] = ['codex']): Promise<{ payload: unknown; listed: number }> {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        let listed = 0;
        let payload: unknown;
        const authContext = { kind: 'authenticated', userLogin: 'alice' };
        Object.assign(endpoint, {
            requireAuth: () => authContext,
            auth: { resolveUserLogin: (context: typeof authContext) => context.userLogin },
            runner: {
                resolveAgentCliInstallTarget: () => ({ home: '/home/alice', uid: 1001, gid: 1001 }),
                isAgentEnabled: (agentId: string, ownerLogin: string) =>
                    ownerLogin === 'alice' && enabledHarnesses.includes(agentId),
            },
            cliUpdates: {
                isInstallSupportedForTarget: () => allowed,
                listOutdated: async () => { listed++; return outdated; },
                isAgentInstallSupported: () => true,
            },
        });
        const res = { json: (body: unknown) => { payload = body; } } as unknown as Response;
        await endpoint.listCliUpdatesForTest({} as Request, res);
        return { payload, listed };
    }

    it('hides "Update available" when a tenant-prefix install is not supported', async () => {
        expect(await listWith(false)).to.deep.equal({ payload: { updates: [] }, listed: 0 });
    });

    it('lists only harnesses enabled in the authenticated user configuration', async () => {
        expect(await listWith(true, ['codex'])).to.deep.equal({
            payload: { updates: [outdated.updates[1]] },
            listed: 1,
        });
    });

    it('includes Claude Code for an owner who has it enabled', async () => {
        expect(await listWith(true, ['claude', 'codex'])).to.deep.equal({
            payload: outdated,
            listed: 1,
        });
    });
});

describe('QaapAgentTaskEndpoint queue admission', () => {
    it('checks workspace freshness only after ownership is authorized', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        let owned = false;
        let snapshots = 0;
        let payload: unknown;
        Object.assign(endpoint, {
            requireAuth: () => ({}),
            auth: { ownsWorkspacePath: () => owned, denyForbidden: () => undefined },
            runner: { detail: async () => ({ id: 't', cwd: '/repo' }), checkTaskWorkspaceSnapshot: () => { snapshots++; return 'changed'; } }
        });
        const req = { params: { id: 't' }, query: { verifySnapshot: '1' } } as unknown as Request;
        const res = { set: () => undefined, json: (body: unknown) => { payload = body; } } as unknown as Response;
        await endpoint.detailForTest(req, res);
        expect(snapshots).to.equal(0);
        owned = true;
        await endpoint.detailForTest(req, res);
        expect(snapshots).to.equal(1);
        expect(payload).to.deep.equal({ id: 't', cwd: '/repo', workspaceSnapshot: 'changed' });
    });
    it('requires authentication to retry storage and reports the resulting state', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        let authorized = false;
        let calls = 0;
        const health = { ready: false, recovery: 'ready', writeFailed: true };
        Object.assign(endpoint, {
            requireAuth: () => authorized ? {} : undefined,
            runner: { retryStorage: async () => { calls++; return health; } }
        });
        let status = 0;
        const response = {
            set: () => response,
            status: (code: number) => { status = code; return response; },
            json: (body: unknown) => { expect(body).to.deep.equal(health); return response; }
        };
        await endpoint.retryForTest({} as Request, response as unknown as Response);
        expect(calls).to.equal(0);
        authorized = true;
        await endpoint.retryForTest({} as Request, response as unknown as Response);
        expect(calls).to.equal(1);
        expect(status).to.equal(503);
        health.ready = true;
        health.writeFailed = false;
        await endpoint.retryForTest({} as Request, response as unknown as Response);
        expect(status).to.equal(200);
    });
    it('exposes storage status only after authentication and prevents caching', () => {
        for (const authenticated of [false, true]) {
            for (const ready of [false, true]) {
                const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
                let reads = 0;
                const health = { ready, recovery: 'ready', writeFailed: !ready };
                Object.assign(endpoint, {
                    requireAuth: () => authenticated ? {} : undefined,
                    runner: { storageHealth: () => { reads++; return health; } }
                });
                let status = 0;
                let cache = '';
                let payload: unknown;
                const response = {
                    set: (_key: string, value: string) => { cache = value; return response; },
                    status: (code: number) => { status = code; return response; },
                    json: (body: unknown) => { payload = body; return response; }
                };
                endpoint.healthForTest({} as Request, response as unknown as Response);
                expect(reads).to.equal(authenticated ? 1 : 0);
                if (authenticated) {
                    expect(status).to.equal(ready ? 200 : 503);
                    expect(cache).to.equal('no-store');
                    expect(payload).to.deep.equal(health);
                } else {
                    expect(payload).to.equal(undefined);
                }
            }
        }
    });
    it('returns 429 for queue saturation and preserves 400 for invalid requests', async () => {
        for (const [error, expectedStatus] of [
            [new QaapAgentQueueFullError(), 429],
            [new QaapAgentStorageUnavailableError(), 503],
            [new Error('Invalid request'), 400]
        ] as const) {
            const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
            Object.assign(endpoint, {
                auth: {
                    authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                    resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' })
                },
                runner: {
                    defaultAgentFresh: async () => 'shell',
                    storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
                    create: () => { throw error; }
                }
            });
            let status = 0;
            let payload: unknown;
            const response = {
                status: (code: number) => { status = code; return response; },
                json: (body: unknown) => { payload = body; return response; }
            };
            await endpoint.createForTest({
                body: { cwd: '/repo', command: 'echo test' }, header: () => undefined
            } as unknown as Request, response as unknown as Response);
            expect(status).to.equal(expectedStatus);
            expect(payload).to.deep.equal({ error: error.message });
        }
    });

    it('retries a failed storage write once before creating: 201 when the retry recovers, 503 when it does not', async () => {
        for (const [retryRecovers, expectedStatus] of [[true, 201], [false, 503]] as const) {
            const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
            let writeFailed = true;
            let retries = 0;
            Object.assign(endpoint, {
                auth: {
                    authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                    resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' })
                },
                runner: {
                    defaultAgentFresh: async () => 'shell',
                    storageHealth: () => ({ ready: !writeFailed, recovery: 'ready', writeFailed }),
                    retryStorage: async () => {
                        retries++;
                        writeFailed = !retryRecovers;
                        return { ready: !writeFailed, recovery: 'ready', writeFailed };
                    },
                    create: () => {
                        if (writeFailed) {
                            throw new QaapAgentStorageUnavailableError();
                        }
                        return { id: 'task-1' };
                    }
                }
            });
            let status = 0;
            const response = {
                status: (code: number) => { status = code; return response; },
                json: () => response
            };
            await endpoint.createForTest({
                body: { cwd: '/repo', command: 'echo test' }, header: () => undefined
            } as unknown as Request, response as unknown as Response);
            expect(retries).to.equal(1);
            expect(status).to.equal(expectedStatus);
        }
    });

    it('does not retry storage when writes are healthy', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        let retries = 0;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' })
            },
            runner: {
                defaultAgentFresh: async () => 'shell',
                storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
                retryStorage: async () => { retries++; return { ready: true, recovery: 'ready', writeFailed: false }; },
                create: () => ({ id: 'task-2' })
            }
        });
        let status = 0;
        const response = {
            status: (code: number) => { status = code; return response; },
            json: () => response
        };
        await endpoint.createForTest({
            body: { cwd: '/repo', command: 'echo test' }, header: () => undefined
        } as unknown as Request, response as unknown as Response);
        expect(retries).to.equal(0);
        expect(status).to.equal(201);
    });
});

describe('QaapAgentTaskEndpoint standalone model fallback', () => {
    it('registers every task it creates, with the request it built, for model fallback', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const tracked: Array<{ taskId: string; prompt?: string; readOnlyWorkspace?: boolean; ownerLogin?: string }> = [];
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' })
            },
            runner: {
                defaultAgentFresh: async () => 'qaiq',
                storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
                create: () => ({ id: 'task-1', cwd: '/repo', state: 'running' }),
            },
            modelFallback: {
                track: (task: { id: string }, request: { prompt?: string; readOnlyWorkspace?: boolean }, ownerLogin?: string) => {
                    tracked.push({ taskId: task.id, prompt: request.prompt, readOnlyWorkspace: request.readOnlyWorkspace, ownerLogin });
                },
            },
        });
        let status = 0;
        const response = {
            status: (code: number) => { status = code; return response; },
            json: () => response,
        };

        await endpoint.createForTest({
            body: { cwd: '/repo', prompt: 'Reply with OK', readOnlyWorkspace: true }, header: () => undefined
        } as unknown as Request, response as unknown as Response);

        expect(status).to.equal(201);
        expect(tracked).to.deep.equal([{ taskId: 'task-1', prompt: 'Reply with OK', readOnlyWorkspace: true, ownerLogin: 'alice' }]);
    });

    it('never lets a client body claim its own worktree, so a shared-tree task still queues', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const created: Array<{ ownWorkingTree?: boolean }> = [];
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                resolveOwnedRepositoryCwd: () => ({ kind: 'ok', cwd: '/repo' })
            },
            runner: {
                defaultAgentFresh: async () => 'qaiq',
                storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
                create: (request: { ownWorkingTree?: boolean }) => {
                    created.push({ ownWorkingTree: request.ownWorkingTree });
                    return { id: `task-${created.length}`, cwd: '/repo', state: 'running' };
                },
            },
            modelFallback: { track: () => undefined },
        });
        const response = { status: () => response, json: () => response };

        await endpoint.createForTest({
            body: { cwd: '/repo', prompt: 'levanta la app', ownWorkingTree: true }, header: () => undefined
        } as unknown as Request, response as unknown as Response);

        expect(created).to.deep.equal([{ ownWorkingTree: undefined }]);
    });
});

describe('QaapAgentTaskEndpoint CLI install', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = originalNodeEnv;
        }
    });

    async function installWith(
        result: QaapAgentCliUpdateResult,
        userLogin: string | undefined,
    ): Promise<{ status: number; body: unknown; userKeys: Array<string | undefined>; refreshed: number }> {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const userKeys: Array<string | undefined> = [];
        let refreshed = 0;
        let status = 200;
        let body: unknown;
        const authContext = { kind: 'authenticated', userLogin };
        Object.assign(endpoint, {
            requireAuth: () => authContext,
            auth: { resolveUserLogin: (context: typeof authContext) => context.userLogin },
            runner: {
                resolveAgentCliInstallTarget: () => ({ home: '/home/alice', uid: 1001, gid: 1001 }),
                refreshAgentCatalog: () => { refreshed++; },
            },
            cliUpdates: {
                installUpdate: async (_agentId: string, _target: unknown, options: { userKey?: string }) => {
                    userKeys.push(options.userKey);
                    return result;
                },
            },
        });
        const res = {
            status(code: number): Response {
                status = code;
                return this as unknown as Response;
            },
            json(payload: unknown): void {
                body = payload;
            },
        } as unknown as Response;
        await endpoint.installCliUpdateForTest({ params: { agentId: 'copilot' } } as unknown as Request, res);
        return { status, body, userKeys, refreshed };
    }

    it('maps busy, rate-limited, refused and npm failures to distinct status codes', async () => {
        expect((await installWith({ ok: true, id: 'copilot' }, 'Alice')).status).to.equal(200);
        expect((await installWith({ ok: false, id: 'copilot', reason: 'busy' }, 'Alice')).status).to.equal(409);
        expect((await installWith({ ok: false, id: 'copilot', reason: 'rate-limited' }, 'Alice')).status).to.equal(429);
        expect((await installWith({ ok: false, id: 'copilot', reason: 'refused' }, 'Alice')).status).to.equal(403);
        expect((await installWith({ ok: false, id: 'copilot', reason: 'failed' }, 'Alice')).status).to.equal(502);
    });

    it('locks and rate limits per signed-in user and refreshes the catalog only after a successful install', async () => {
        const installed = await installWith({ ok: true, id: 'copilot' }, 'Alice');
        expect(installed.userKeys).to.deep.equal(['alice']);
        expect(installed.refreshed).to.equal(1);
        expect((await installWith({ ok: false, id: 'copilot', reason: 'busy' }, 'Alice')).refreshed).to.equal(0);
    });

    it('refuses an install without a signed-in user in production', async () => {
        process.env.NODE_ENV = 'production';
        const anonymous = await installWith({ ok: true, id: 'copilot' }, undefined);
        expect(anonymous.status).to.equal(403);
        expect(anonymous.userKeys).to.deep.equal([]);
    });
});

describe('QaapAgentTaskEndpoint project clone missing from disk', () => {
    const cwd = '/workspace/repos/users/alice/octo/app';

    async function create(recovered: unknown): Promise<{ status: number; payload: unknown; created: unknown[] }> {
        const created: unknown[] = [];
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'alice' }),
                // The plain resolver denies a cwd whose clone is gone; the recovery re-clones it.
                resolveOwnedRepositoryCwd: () => ({ kind: 'denied' }),
                denyForbidden: (res: Response) => { res.status(403).json({ error: 'Forbidden' }); return false; },
            },
            cloneRecovery: { resolveOwnedRepositoryCwd: async () => recovered },
            runner: {
                defaultAgentFresh: async () => 'shell',
                storageHealth: () => ({ ready: true, recovery: 'ready', writeFailed: false }),
                create: (request: unknown) => { created.push(request); return { id: 't1' }; }
            },
        });
        let status = 0;
        let payload: unknown;
        const response = {
            status: (code: number) => { status = code; return response; },
            json: (body: unknown) => { payload = body; return response; },
        };
        await endpoint.createForTest({
            body: { cwd: 'github:octo/app', prompt: 'fix it' }, header: () => undefined,
        } as unknown as Request, response as unknown as Response);
        return { status, payload, created };
    }

    it('starts the task in the re-cloned project', async () => {
        const { status, created } = await create({ kind: 'ok', cwd });
        expect(status).to.equal(201);
        expect(created).to.have.length(1);
        expect((created[0] as { cwd: string }).cwd).to.equal(cwd);
    });

    it('answers a readable error when the clone cannot be restored', async () => {
        const error = 'I cannot find the repository octo/app on the server and could not clone it again: no access.';
        const { status, payload, created } = await create({ kind: 'clone-failed', error });
        expect(status).to.equal(422);
        expect(payload).to.deep.equal({ error, code: 'repository_clone_unavailable' });
        expect(created).to.deep.equal([]);
    });

    it('keeps denying what the recovery denies', async () => {
        const { status, created } = await create({ kind: 'denied' });
        expect(status).to.equal(403);
        expect(created).to.deep.equal([]);
    });
});

describe('QaapAgentTaskEndpoint single-task delete', () => {
    const mineCwd = '/workspace/repos/users/alice/octo/app';
    const theirsCwd = '/workspace/repos/users/bob/octo/app';

    /** Captures the `DELETE /:id` handler that `configure` registers, without starting a server. */
    function deleteHandler(endpoint: TestableTaskEndpoint): (req: Request, res: Response) => void {
        let handler: ((req: Request, res: Response) => void) | undefined;
        const app = {
            get: () => undefined,
            post: () => undefined,
            delete: (routePath: string, fn: (req: Request, res: Response) => void) => {
                if (routePath === `${QAAP_AGENT_TASK_API_PATH}/:id`) {
                    handler = fn;
                }
            },
        };
        endpoint.configure(app as unknown as Parameters<TestableTaskEndpoint['configure']>[0]);
        if (!handler) {
            throw new Error('DELETE /:id was not registered');
        }
        return handler;
    }

    async function remove(authenticated: boolean, taskId: string, tasks: QaapAgentTask[]): Promise<{ status: number; payload: unknown; cancelled: string[]; remaining: string[] }> {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const cancelled: string[] = [];
        const remaining = [...tasks];
        Object.assign(endpoint, {
            auth: {
                authenticate: () => authenticated ? { kind: 'authenticated', userLogin: 'alice' } : { kind: 'unauthorized' },
                ownsWorkspacePath: (ctx: { userLogin: string }, cwd: string) => cwd.startsWith(`/workspace/repos/users/${ctx.userLogin}/`),
            },
            runner: {
                listForCwd: () => remaining,
                cancel: (id: string) => { cancelled.push(id); return undefined; },
                deleteTask: (id: string) => {
                    const index = remaining.findIndex(task => task.id === id);
                    if (index < 0) {
                        return false;
                    }
                    remaining.splice(index, 1);
                    return true;
                },
            },
        });
        let status = 200;
        let payload: unknown;
        const response = {
            status: (code: number) => { status = code; return response; },
            json: (body: unknown) => { payload = body; return response; },
        };
        deleteHandler(endpoint)({ params: { id: taskId } } as unknown as Request, response as unknown as Response);
        return { status, payload, cancelled, remaining: remaining.map(task => task.id) };
    }

    const tasks = [
        { id: 'mine-running', cwd: mineCwd, state: 'running' },
        { id: 'mine-done', cwd: mineCwd, state: 'completed' },
        { id: 'theirs', cwd: theirsCwd, state: 'completed' },
    ] as unknown as QaapAgentTask[];

    it('answers 401 to an anonymous caller and removes nothing', async () => {
        const { status, cancelled, remaining } = await remove(false, 'mine-done', tasks);
        expect(status).to.equal(401);
        expect(cancelled).to.deep.equal([]);
        expect(remaining).to.have.length(3);
    });

    it('answers 404 for an unknown task id', async () => {
        const { status, payload, remaining } = await remove(true, 'nope', tasks);
        expect(status).to.equal(404);
        expect(payload).to.deep.equal({ error: 'Task not found.' });
        expect(remaining).to.have.length(3);
    });

    it('answers 404 for another owner\'s task and leaves it in place', async () => {
        const { status, cancelled, remaining } = await remove(true, 'theirs', tasks);
        expect(status).to.equal(404);
        expect(cancelled).to.deep.equal([]);
        expect(remaining).to.include('theirs');
    });

    it('cancels a running task first, then removes it, and answers { ok: true }', async () => {
        const { status, payload, cancelled, remaining } = await remove(true, 'mine-running', tasks);
        expect(status).to.equal(200);
        expect(payload).to.deep.equal({ ok: true });
        expect(cancelled).to.deep.equal(['mine-running']);
        expect(remaining).to.not.include('mine-running');
    });

    it('removes a finished task of its own without cancelling it', async () => {
        const { status, payload, cancelled, remaining } = await remove(true, 'mine-done', tasks);
        expect(status).to.equal(200);
        expect(payload).to.deep.equal({ ok: true });
        expect(cancelled).to.deep.equal([]);
        expect(remaining).to.not.include('mine-done');
    });
});

describe('QaapAgentTaskEndpoint improve-prompt failures', () => {
    it('returns the classified reason and status for a Codex usage limit, without the raw stderr', () => {
        const stderr = 'ERROR: You\'ve hit your usage limit. Upgrade to Plus, or try again at Nov 19th, 2026 12:56 AM. (token sk-test-secret)';
        const failure = describeImprovePromptFailure(new Error(stderr), 'codex');
        expect(failure.status).to.equal(429);
        expect(failure.kind).to.equal('usage_limit');
        expect(failure.error).to.contain('usage limit reached');
        expect(failure.error).to.contain('Nov 19th, 2026 12:56 AM');
        expect(failure.error).to.not.contain('sk-test-secret');
    });

    it('maps a signed-out CLI to 401 and a Squid egress refusal to a network 502', () => {
        expect(describeImprovePromptFailure(new Error('No authentication information found.'), 'copilot')).to.deep.include({ status: 401, kind: 'sign_in' });
        expect(describeImprovePromptFailure(new Error('403 Forbidden\nAccess Denied.\nGenerated by squid'), 'opencode')).to.deep.include({ status: 502, kind: 'network' });
    });

    it('keeps the generic message and 500 for an unclassified CLI failure', () => {
        expect(describeImprovePromptFailure(new Error('Agent exited with code 1.'), 'codex')).to.deep.equal({
            status: 500,
            error: 'Could not improve the prompt. Try again.',
            kind: 'unknown',
        });
        expect(describeImprovePromptFailure('not an error object', 'codex').kind).to.equal('unknown');
    });
});

describe('QaapAgentTaskEndpoint agent-models availability', () => {
    it('answers an empty model list for a harness the owner turned off, without listing its catalog', async () => {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const authContext = { kind: 'authenticated', userLogin: 'alice' };
        let body: unknown;
        Object.assign(endpoint, {
            requireAuth: () => authContext,
            auth: { resolveUserLogin: (context: typeof authContext) => context.userLogin },
            runner: { isAgentEnabled: () => false },
        });
        const res = {
            setHeader: () => undefined,
            json: (payload: unknown) => { body = payload; },
            status: () => res,
            headersSent: false,
            writableEnded: false,
        };
        await endpoint.agentModelsForTest({ query: { agent: 'opencode' } } as unknown as Request, res as unknown as Response);
        expect(body).to.deep.equal({ agent: 'opencode', models: [] });
    });
});

describe('QaapAgentTaskEndpoint agent session attestation', () => {
    async function attest(options: {
        readonly authContext: { kind: string; userLogin?: string };
        readonly body?: unknown;
        readonly headers?: Record<string, string>;
    }): Promise<{ status: number; body: unknown; attested: Array<[string, string | undefined]> }> {
        const endpoint = Object.create(TestableTaskEndpoint.prototype) as TestableTaskEndpoint;
        const attested: Array<[string, string | undefined]> = [];
        let status = 200;
        let body: unknown;
        Object.assign(endpoint, {
            auth: {
                authenticate: () => options.authContext,
                resolveUserLogin: (context: { kind: string; userLogin?: string }) => context.kind === 'unauthorized' ? undefined : context.userLogin,
            },
            runner: {
                attestAgentSession: (agentId: string, ownerLogin: string | undefined) => {
                    attested.push([agentId, ownerLogin]);
                    return true;
                },
            },
        });
        const res = {
            status(code: number): Response {
                status = code;
                return this as unknown as Response;
            },
            setHeader: () => undefined,
            json(payload: unknown): void {
                body = payload;
            },
        } as unknown as Response;
        await endpoint.attestForTest({
            headers: options.headers ?? { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
            body: options.body ?? { agentId: 'copilot' },
        } as unknown as Request, res);
        return { status, body, attested };
    }

    it('refuses a caller without a session', async () => {
        const result = await attest({ authContext: { kind: 'unauthorized' } });
        expect(result.status).to.equal(401);
        expect(result.attested).to.deep.equal([]);
    });

    it('refuses cross-site requests and non-JSON requests without Sec-Fetch-Site', async () => {
        const crossSite = await attest({ authContext: { kind: 'authenticated', userLogin: 'alice' }, headers: { 'sec-fetch-site': 'cross-site' } });
        expect(crossSite.status).to.equal(403);
        const form = await attest({ authContext: { kind: 'authenticated', userLogin: 'alice' }, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        expect(form.status).to.equal(415);
        expect([...crossSite.attested, ...form.attested]).to.deep.equal([]);
    });

    it('refuses harnesses that have a real auth probe', async () => {
        for (const agentId of ['codex', 'claude', '', undefined]) {
            const result = await attest({ authContext: { kind: 'authenticated', userLogin: 'alice' }, body: { agentId } });
            expect(result.status, String(agentId)).to.equal(400);
            expect(result.attested).to.deep.equal([]);
        }
    });

    it('attests for the session owner, never an owner named in the body', async () => {
        const result = await attest({
            authContext: { kind: 'authenticated', userLogin: 'alice' },
            body: { agentId: 'Copilot', ownerLogin: 'mallory', userLogin: 'mallory' },
        });
        expect(result.status).to.equal(200);
        expect(result.body).to.deep.equal({ ok: true, agentId: 'copilot' });
        expect(result.attested).to.deep.equal([['copilot', 'alice']]);
    });

    it('uses the skip-auth owner in local mode', async () => {
        const result = await attest({ authContext: { kind: 'skip', userLogin: 'local-dev' } });
        expect(result.attested).to.deep.equal([['copilot', 'local-dev']]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import * as os from 'os';
import type { AddressInfo } from 'net';
import { spawn, type ChildProcess } from 'child_process';
import * as express from '@theia/core/shared/express';
import { QaapGithubOauthEndpoint } from '@theia/qaap-shared-core/lib/node/qaap-github-oauth-endpoint';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';

/**
 * In-process end-to-end check of the cancellation chain that the VPS relies on:
 * browser -> control-plane proxy (forwardHttp deadline, 504) -> tenant express handler
 * (abortOnResponseClose) -> runLocalGit -> the long-running child is killed.
 */
describe('tenant proxy deadline cancels tenant git work end to end', () => {
    const servers: http.Server[] = [];
    let child: ChildProcess | undefined;

    afterEach(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
        }
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    async function listen(app: express.Application): Promise<number> {
        const server = http.createServer(app);
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return (server.address() as AddressInfo).port;
    }

    it('kills the git child when the proxy gives up with 504', async function (): Promise<void> {
        this.timeout(10_000);
        // Tenant side: the real endpoint helpers, with the git binary swapped for a process that
        // would otherwise run for a minute.
        const endpoint = Object.create(QaapGithubOauthEndpoint.prototype) as QaapGithubOauthEndpoint;
        let childSpawned!: (spawned: ChildProcess) => void;
        const spawnedChild = new Promise<ChildProcess>(resolve => { childSpawned = resolve; });
        Object.assign(endpoint, {
            gitOperationTimeoutMs: 60_000,
            spawnLocalGit: (): ChildProcess => {
                child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'ignore', 'pipe'] });
                childSpawned(child);
                return child;
            },
        });
        const tenantEndpoint = endpoint as unknown as {
            abortOnResponseClose(res: express.Response): AbortSignal;
            runLocalGit(cwd: string, args: string[], capture: boolean, options: { signal?: AbortSignal }): Promise<string>;
        };
        let tenantFailure!: (error: unknown) => void;
        const tenantFailed = new Promise<unknown>(resolve => { tenantFailure = resolve; });
        const tenant = express();
        tenant.post('/qaap/api/github/repositories/octocat/hello/open', async (req, res) => {
            try {
                await tenantEndpoint.runLocalGit(os.tmpdir(), ['clone'], false, { signal: tenantEndpoint.abortOnResponseClose(res) });
                res.json({ ok: true });
            } catch (err) {
                tenantFailure(err);
                if (!res.headersSent) {
                    res.status(502).json({ error: String(err) });
                }
            }
        });
        const tenantPort = await listen(tenant);

        // Control plane: the real proxy forwarding with a short response deadline.
        const invalidations: unknown[] = [];
        const proxy = new QaapTenantBackendProxyContribution() as unknown as Record<string, unknown> & {
            forwardHttp(req: express.Request, res: express.Response, target: unknown, assertion: string, tenantLogin: string, timeoutMs: number): void;
        };
        proxy.docker = { invalidateTenantBackendTarget: (...args: unknown[]) => invalidations.push(args) };
        const target = { containerId: 'c', containerName: 'qaap-backend-alice', host: '127.0.0.1', port: tenantPort, tenantLogin: 'alice' };
        const controlPlane = express();
        controlPlane.use((req, res) => proxy.forwardHttp(req, res, target, 'assertion', 'alice', 300));
        const controlPort = await listen(controlPlane);

        // Browser.
        const status = await new Promise<number>((resolve, reject) => {
            const request = http.request({
                host: '127.0.0.1',
                port: controlPort,
                method: 'POST',
                path: '/qaap/api/github/repositories/octocat/hello/open',
            }, response => {
                response.resume();
                resolve(response.statusCode ?? 0);
            });
            request.once('error', reject);
            request.end();
        });
        expect(status).to.equal(504);

        const spawned = await spawnedChild;
        const exit = await new Promise<NodeJS.Signals | null>(resolve => {
            if (spawned.exitCode !== null || spawned.signalCode !== null) {
                resolve(spawned.signalCode);
                return;
            }
            spawned.once('exit', (_code, signal) => resolve(signal));
        });
        expect(exit).to.equal('SIGTERM');
        expect(String((await tenantFailed as Error).message)).to.contain('cancelled');
        // The tenant backend was alive (just slow): the proxy keeps its cached target.
        expect(invalidations).to.deep.equal([]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Application, Request, Response } from '@theia/core/shared/express';
import { QAAP_TENANT_UPDATE_API_PATH } from '../common/qaap-cloud-api-types';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { QaapTenantUpdateEndpoint } from './qaap-tenant-update-endpoint';

interface RecordedResponse {
    statusCode: number;
    body: unknown;
    headersSent: boolean;
}

type Handler = (req: Request, res: Response) => void;

/** Express-shaped stand-in that records the handlers registered for the update path. */
function captureRoutes(endpoint: QaapTenantUpdateEndpoint): { get: Handler; post: Handler } {
    const routes: { get?: Handler; post?: Handler } = {};
    const app = {
        get: (routePath: string, handler: Handler) => {
            if (routePath === QAAP_TENANT_UPDATE_API_PATH) {
                routes.get = handler;
            }
        },
        post: (routePath: string, handler: Handler) => {
            if (routePath === QAAP_TENANT_UPDATE_API_PATH) {
                routes.post = handler;
            }
        },
    };
    endpoint.configure(app as unknown as Application);
    if (!routes.get || !routes.post) {
        throw new Error('the update endpoint did not register both routes');
    }
    return { get: routes.get, post: routes.post };
}

/** Runs a handler and resolves with what it answered (handlers are fire-and-forget async wrappers). */
async function invoke(handler: Handler, request: Partial<Request>): Promise<RecordedResponse> {
    const recorded: RecordedResponse = { statusCode: 200, body: undefined, headersSent: false };
    const response = {
        status(code: number) {
            recorded.statusCode = code;
            return response;
        },
        json(body: unknown) {
            recorded.body = body;
            recorded.headersSent = true;
            return response;
        },
        end() {
            recorded.headersSent = true;
            return response;
        },
    };
    handler({ headers: {}, method: 'GET', ...request } as unknown as Request, response as unknown as Response);
    await new Promise(resolve => setImmediate(resolve));
    return recorded;
}

/** Auth stand-in: `login` is the session's owner; `undefined` means no signed-in session. */
function authFor(login: string | undefined): unknown {
    return {
        authenticate: () => ({ kind: login ? 'authenticated' : 'anonymous' }),
        resolveUserLogin: () => login,
    };
}

describe('QaapTenantUpdateEndpoint', () => {

    const savedPerTenant = process.env.QAAP_BACKEND_PER_TENANT;

    afterEach(() => {
        if (savedPerTenant === undefined) {
            delete process.env.QAAP_BACKEND_PER_TENANT;
        } else {
            process.env.QAAP_BACKEND_PER_TENANT = savedPerTenant;
        }
    });

    function endpointWith(login: string | undefined, docker: Partial<QaapDockerOrchestrator>): { endpoint: QaapTenantUpdateEndpoint; calls: string[] } {
        const calls: string[] = [];
        const endpoint = new QaapTenantUpdateEndpoint();
        (endpoint as unknown as { auth: unknown }).auth = authFor(login);
        (endpoint as unknown as { docker: unknown }).docker = {
            tenantUpdateStatus: async (owner: string) => {
                calls.push(`status:${owner}`);
                return docker.tenantUpdateStatus?.(owner) ?? { updateAvailable: false, runningTasks: 0 };
            },
            applyTenantUpdateNow: async (owner: string) => {
                calls.push(`apply:${owner}`);
                return docker.applyTenantUpdateNow?.(owner) ?? false;
            },
        };
        return { endpoint, calls };
    }

    it('answers the status of the session owner', async () => {
        const { endpoint, calls } = endpointWith('alice', {
            tenantUpdateStatus: async () => ({ updateAvailable: true, runningTasks: 2 }),
        });
        const routes = captureRoutes(endpoint);
        const result = await invoke(routes.get, {});
        expect(result.body).to.deep.equal({ updateAvailable: true, runningTasks: 2 });
        expect(calls).to.deep.equal(['status:alice']);
    });

    it('refuses the status without a session', async () => {
        const { endpoint, calls } = endpointWith(undefined, {});
        const result = await invoke(captureRoutes(endpoint).get, {});
        expect(result.statusCode).to.equal(401);
        expect(calls).to.have.length(0);
    });

    it('applies the update for the session owner and ignores a login sent by the client', async () => {
        const { endpoint, calls } = endpointWith('alice', { applyTenantUpdateNow: async () => true });
        const result = await invoke(captureRoutes(endpoint).post, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-origin' },
            body: { login: 'mallory', ownerLogin: 'mallory' },
        } as Partial<Request>);
        expect(result.body).to.deep.equal({ applied: true });
        expect(calls).to.deep.equal(['apply:alice']);
    });

    it('refuses an update without a session and never reaches the orchestrator', async () => {
        const { endpoint, calls } = endpointWith(undefined, {});
        const result = await invoke(captureRoutes(endpoint).post, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-origin' },
        } as Partial<Request>);
        expect(result.statusCode).to.equal(401);
        expect(calls).to.have.length(0);
    });

    it('refuses a cross-site update', async () => {
        const { endpoint, calls } = endpointWith('alice', {});
        const result = await invoke(captureRoutes(endpoint).post, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'cross-site' },
        } as Partial<Request>);
        expect(result.statusCode).to.equal(403);
        expect(calls).to.have.length(0);
    });

    it('refuses a same-site (sibling subdomain) update', async () => {
        const { endpoint, calls } = endpointWith('alice', {});
        const result = await invoke(captureRoutes(endpoint).post, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-site' },
        } as Partial<Request>);
        expect(result.statusCode).to.equal(403);
        expect(calls).to.have.length(0);
    });

    it('requires a JSON body when the browser sent no Sec-Fetch-Site', async () => {
        const { endpoint, calls } = endpointWith('alice', {});
        const routes = captureRoutes(endpoint);
        const formPost = await invoke(routes.post, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
        } as Partial<Request>);
        expect(formPost.statusCode).to.equal(415);
        const jsonPost = await invoke(routes.post, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
        } as Partial<Request>);
        expect(jsonPost.body).to.deep.equal({ applied: false });
        expect(calls).to.deep.equal(['apply:alice']);
    });

    it('answers neutral values outside backend-per-tenant mode, using the real orchestrator', async () => {
        delete process.env.QAAP_BACKEND_PER_TENANT;
        const endpoint = new QaapTenantUpdateEndpoint();
        (endpoint as unknown as { auth: unknown }).auth = authFor('alice');
        (endpoint as unknown as { docker: unknown }).docker = new QaapDockerOrchestrator();
        const routes = captureRoutes(endpoint);
        expect((await invoke(routes.get, {})).body).to.deep.equal({ updateAvailable: false, runningTasks: 0 });
        expect((await invoke(routes.post, {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-origin' },
        } as Partial<Request>)).body).to.deep.equal({ applied: false });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapTenantBackendProxyContribution } from './qaap-tenant-backend-proxy';

const TARGET = {
    containerId: 'container-id',
    containerName: 'qaap-backend-alice',
    host: '127.0.0.1',
    port: 4873,
    tenantLogin: 'alice',
};

describe('QaapTenantBackendProxyContribution', () => {
    function createProxy(): QaapTenantBackendProxyContribution {
        return new QaapTenantBackendProxyContribution();
    }

    it('keeps OAuth, health and auth-session paths on the control-plane', () => {
        const proxy = createProxy() as unknown as { isControlPlanePath(url: string): boolean };
        expect(proxy.isControlPlanePath('/qaap/api/health')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/auth/session')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/auth/github/start?next=/')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/cloud/runtime/status')).to.equal(true);
        expect(proxy.isControlPlanePath('/qaap/api/cloud/runtime/wake')).to.equal(true);
        expect(proxy.isControlPlanePath('/services')).to.equal(false);
    });

    it('does not forward the control-plane cookie to a tenant backend', () => {
        const proxy = createProxy() as unknown as {
            forwardHeaders(headers: Record<string, string>, target: typeof TARGET, assertion: string): Record<string, string | string[]>;
        };
        const headers = proxy.forwardHeaders({
            host: 'qaap.example.test',
            cookie: 'qaap-auth-session=control-plane-secret',
            connection: 'keep-alive',
            'x-request-id': 'request-1',
        }, TARGET, 'tenant-assertion');
        expect(headers.cookie).to.equal(undefined);
        expect(headers.connection).to.equal(undefined);
        expect(headers.host).to.equal('127.0.0.1:4873');
        expect(headers['x-request-id']).to.equal('request-1');
    });

    it('restores the required upgrade headers only for the tenant WebSocket hop', () => {
        const proxy = createProxy() as unknown as {
            forwardWebSocketHeaders(headers: Record<string, string>, target: typeof TARGET, assertion: string, tenantConnectionToken: string): Record<string, string | string[]>;
        };
        const headers = proxy.forwardWebSocketHeaders({
            host: 'qaap.example.test',
            connection: 'keep-alive, Upgrade',
            upgrade: 'websocket',
            cookie: 'qaap-auth-session=control-plane-secret',
            'sec-websocket-key': 'key',
        }, TARGET, 'tenant-assertion', 'tenant-private-token');
        expect(headers.connection).to.equal('Upgrade');
        expect(headers.upgrade).to.equal('websocket');
        expect(headers.cookie).to.equal('theia-connection-token=tenant-private-token');
        expect(headers.origin).to.equal('http://127.0.0.1:4873');
        expect(headers['sec-websocket-key']).to.equal('key');
    });
});

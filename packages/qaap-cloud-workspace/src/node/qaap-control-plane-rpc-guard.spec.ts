// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as http from 'http';
import { QaapControlPlaneRpcGuard } from './qaap-control-plane-rpc-guard';

describe('QaapControlPlaneRpcGuard', () => {
    const ENV_KEYS = ['NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_TENANT_BACKEND_MODE', 'QAAP_BACKEND_PER_TENANT', 'QAAP_TENANT_PROXY_EARLY_ROUTING'] as const;
    const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]));
    let events: Array<{ event: string; reason?: unknown }>;

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            delete process.env[key];
        }
        events = [];
    });

    afterEach(() => {
        for (const [key, value] of savedEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    function guard(): QaapControlPlaneRpcGuard {
        const instance = new QaapControlPlaneRpcGuard();
        (instance as unknown as { auth: unknown }).auth = {
            logSecurityEvent: (event: string, detail: { reason?: unknown }) => events.push({ event, reason: detail.reason }),
        };
        return instance;
    }

    function handshake(): http.IncomingMessage {
        return { url: '/socket.io/?EIO=4&transport=polling', headers: {} } as http.IncomingMessage;
    }

    it('refuses Theia RPC on a hosted control plane without the per-tenant backend', () => {
        process.env.NODE_ENV = 'production';
        expect(guard().allowWsUpgrade(handshake())).to.equal(false);
        expect(events).to.deep.equal([{ event: 'control_plane_rpc_denied', reason: 'backend_per_tenant_disabled' }]);
    });

    it('refuses a handshake that reached the control plane instead of the tenant proxy', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        expect(guard().allowWsUpgrade(handshake())).to.equal(false);
        expect(events[0]).to.deep.equal({ event: 'control_plane_rpc_denied', reason: 'not_routed_to_tenant_backend' });
    });

    it('lets the tenant proxy run its outer check on a request it forwards', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        process.env.QAAP_BACKEND_PER_TENANT = '1';
        const request = handshake();
        QaapControlPlaneRpcGuard.markRoutedToTenantBackend(request);
        expect(guard().allowWsUpgrade(request)).to.equal(true);
    });

    it('keeps the QAAP_TENANT_PROXY_EARLY_ROUTING=0 fallback working and warns once', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        process.env.QAAP_BACKEND_PER_TENANT = 'true';
        process.env.QAAP_TENANT_PROXY_EARLY_ROUTING = '0';
        const instance = guard();
        expect(instance.allowWsUpgrade(handshake())).to.equal(true);
        expect(instance.allowWsUpgrade(handshake())).to.equal(true);
        expect(events.map(entry => entry.event)).to.deep.equal(['control_plane_rpc_fallback']);
    });

    it('leaves local mode and tenant backends alone', () => {
        expect(guard().allowWsUpgrade(handshake())).to.equal(true);
        process.env.QAAP_CLOUD_MODE = 'local';
        expect(guard().allowWsUpgrade(handshake())).to.equal(true);
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.NODE_ENV = 'production';
        expect(guard().allowWsUpgrade(handshake())).to.equal(true);
        expect(events).to.deep.equal([]);
    });
});

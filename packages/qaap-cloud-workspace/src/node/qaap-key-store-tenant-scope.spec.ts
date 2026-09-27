// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';
import {
    createQaapTenantKeyStoreRpcTarget,
    qaapTenantServiceName,
} from './qaap-key-store-tenant-scope';

describe('qaap-key-store-tenant-scope', () => {
    const calls: Array<{ method: string; service: string; account?: string; password?: string }> = [];
    const backing: KeyStoreService = {
        async setPassword(service, account, password) {
            calls.push({ method: 'setPassword', service, account, password });
        },
        async getPassword(service, account) {
            calls.push({ method: 'getPassword', service, account });
            return undefined;
        },
        async deletePassword(service, account) {
            calls.push({ method: 'deletePassword', service, account });
            return true;
        },
        async findPassword(service) {
            calls.push({ method: 'findPassword', service });
            return undefined;
        },
        async findCredentials(service) {
            calls.push({ method: 'findCredentials', service });
            return [];
        },
        async keys(service) {
            calls.push({ method: 'keys', service });
            return [];
        },
    };

    beforeEach(() => {
        calls.length = 0;
        delete process.env.NODE_ENV;
        delete process.env.QAAP_CLOUD_MODE;
    });

    it('uses a tenant-specific service namespace for every generic keystore operation', async () => {
        const registry = new QaapWebsocketAuthRegistry();
        await registry.runWithLogin('Alice', async () => {
            const scoped = createQaapTenantKeyStoreRpcTarget(backing, registry);
            await scoped.setPassword('github', 'alice', 'secret');
            await scoped.getPassword('github', 'alice');
            await scoped.deletePassword('github', 'alice');
            await scoped.findPassword('github');
            await scoped.findCredentials('github');
            await scoped.keys('github');
        });

        expect(calls).to.have.length(6);
        expect(calls.every(call => call.service === qaapTenantServiceName('alice', 'github'))).to.equal(true);
    });

    it('fails closed for hosted calls without an authenticated tenant', async () => {
        process.env.NODE_ENV = 'production';
        process.env.QAAP_CLOUD_MODE = 'docker';
        const registry = new QaapWebsocketAuthRegistry();
        const scoped = createQaapTenantKeyStoreRpcTarget(backing, registry);

        let error: unknown;
        try {
            await scoped.getPassword('github', 'alice');
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.match(/authenticated tenant/i);
        expect(calls).to.have.length(0);
    });

    it('preserves local development behavior', async () => {
        const registry = new QaapWebsocketAuthRegistry();
        const scoped = createQaapTenantKeyStoreRpcTarget(backing, registry);

        await scoped.keys('github');

        expect(calls).to.deep.equal([{ method: 'keys', service: 'github' }]);
    });
});

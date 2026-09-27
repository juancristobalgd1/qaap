// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { MCP_OAUTH_KEYSTORE_SERVICE } from '@theia/ai-mcp/lib/node/mcp-oauth-keystore';
import { createQaapScopedMcpKeyStore } from './qaap-mcp-oauth-tenant-scope';

class MemoryKeyStore implements KeyStoreService {
    readonly values = new Map<string, string>();

    async setPassword(service: string, account: string, password: string): Promise<void> {
        this.values.set(`${service}:${account}`, password);
    }

    async getPassword(service: string, account: string): Promise<string | undefined> {
        return this.values.get(`${service}:${account}`);
    }

    async deletePassword(service: string, account: string): Promise<boolean> {
        return this.values.delete(`${service}:${account}`);
    }

    async findPassword(service: string): Promise<string | undefined> {
        return [...this.values.entries()].find(([key]) => key.startsWith(`${service}:`))?.[1];
    }

    async findCredentials(service: string): Promise<Array<{ account: string; password: string }>> {
        const prefix = `${service}:`;
        return [...this.values.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, password]) => ({ account: key.slice(prefix.length), password }));
    }

    async keys(service: string): Promise<string[]> {
        const prefix = `${service}:`;
        return [...this.values.keys()]
            .filter(key => key.startsWith(prefix))
            .map(key => key.slice(prefix.length));
    }
}

describe('qaap-mcp-oauth-tenant-scope', () => {
    it('separates MCP OAuth accounts, keys and credential listings by tenant', async () => {
        const backing = new MemoryKeyStore();
        const alice = createQaapScopedMcpKeyStore(backing, 'Alice');
        const bob = createQaapScopedMcpKeyStore(backing, 'Bob');

        await alice.setPassword(MCP_OAUTH_KEYSTORE_SERVICE, 'server:scope:tokens', 'alice-token');
        await bob.setPassword(MCP_OAUTH_KEYSTORE_SERVICE, 'server:scope:tokens', 'bob-token');

        expect(await alice.getPassword(MCP_OAUTH_KEYSTORE_SERVICE, 'server:scope:tokens')).to.equal('alice-token');
        expect(await bob.getPassword(MCP_OAUTH_KEYSTORE_SERVICE, 'server:scope:tokens')).to.equal('bob-token');
        expect(await alice.keys(MCP_OAUTH_KEYSTORE_SERVICE)).to.deep.equal(['server:scope:tokens']);
        expect(await alice.findCredentials(MCP_OAUTH_KEYSTORE_SERVICE)).to.deep.equal([
            { account: 'server:scope:tokens', password: 'alice-token' },
        ]);
        expect(await alice.deletePassword(MCP_OAUTH_KEYSTORE_SERVICE, 'server:scope:tokens')).to.equal(true);
        expect(await bob.getPassword(MCP_OAUTH_KEYSTORE_SERVICE, 'server:scope:tokens')).to.equal('bob-token');
    });

    it('does not rewrite unrelated keystore services', async () => {
        const backing = new MemoryKeyStore();
        const scoped = createQaapScopedMcpKeyStore(backing, 'Alice');
        await scoped.setPassword('github-copilot', 'alice', 'token');
        expect(await backing.getPassword('github-copilot', 'alice')).to.equal('token');
    });
});

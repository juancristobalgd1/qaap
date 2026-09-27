// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceScope } from '@theia/core/lib/common/preferences';
import {
    installMcpMarketplacePlugin,
    readInstalledMcpServerSlugs,
    removeMcpServer,
} from './qaap-mcp-plugin-install';

describe('qaap-mcp-plugin-install', () => {

    it('installMcpMarketplacePlugin writes MCP server config', async () => {
        const writes: Array<{ key: string; value: unknown; scope: PreferenceScope }> = [];
        const preferenceService = {
            get: () => ({}),
            set: async (key: string, value: unknown, scope: PreferenceScope) => {
                writes.push({ key, value, scope });
            },
        };
        const plugin = await installMcpMarketplacePlugin('slack', preferenceService as never);
        expect(plugin?.slug).to.equal('slack');
        expect(writes).to.have.length(1);
        expect(writes[0].key).to.equal('ai-features.mcp.mcpServers');
        expect(writes[0].scope).to.equal(PreferenceScope.User);
        expect((writes[0].value as Record<string, unknown>).slack).to.be.an('object');
    });

    it('readInstalledMcpServerSlugs and removeMcpServer update preferences', async () => {
        let stored: Record<string, object> = { github: { command: 'npx' } };
        const preferenceService = {
            get: () => stored,
            set: async (_key: string, value: Record<string, object>) => {
                stored = value;
            },
        };
        expect([...readInstalledMcpServerSlugs(preferenceService as never)]).to.deep.equal(['github']);
        const removed = await removeMcpServer('github', preferenceService as never);
        expect(removed).to.equal(true);
        expect(stored).to.deep.equal({});
    });
});

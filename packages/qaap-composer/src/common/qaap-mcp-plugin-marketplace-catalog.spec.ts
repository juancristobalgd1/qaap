// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    filterMcpMarketplacePlugins,
    QAAP_MCP_MARKETPLACE_PLUGINS,
} from './qaap-mcp-plugin-marketplace-catalog';

describe('qaap-mcp-plugin-marketplace-catalog', () => {

    it('filterMcpMarketplacePlugins matches name, slug, and description', () => {
        const results = filterMcpMarketplacePlugins(QAAP_MCP_MARKETPLACE_PLUGINS, 'figma');
        expect(results.map(plugin => plugin.slug)).to.deep.equal(['figma']);
    });

    it('filterMcpMarketplacePlugins hides installed slugs', () => {
        const installed = new Set(['slack']);
        const results = filterMcpMarketplacePlugins(QAAP_MCP_MARKETPLACE_PLUGINS, '', installed);
        expect(results.some(plugin => plugin.slug === 'slack')).to.equal(false);
    });
});

describe('qaap-mcp-plugin-marketplace-catalog launchable defaults', () => {
    it('ships no default whose npm package does not exist (every start would fail with a 404)', () => {
        const packages = QAAP_MCP_MARKETPLACE_PLUGINS.map(plugin => (plugin.serverConfig.args as string[] | undefined)?.[1]);
        expect(packages).to.not.include('@linear/mcp-server');
        expect(packages).to.not.include('@datadog/mcp-server');
    });
});

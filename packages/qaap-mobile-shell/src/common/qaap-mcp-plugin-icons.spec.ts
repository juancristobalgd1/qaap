// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MCP_PLUGIN_ICON_SVGS } from './qaap-mcp-plugin-icon-assets';
import { hasMcpPluginIcon, resolveMcpPluginIconAssetKey } from './qaap-mcp-plugin-icons';
import { QAAP_MCP_MARKETPLACE_PLUGINS } from './qaap-mcp-plugin-marketplace-catalog';

describe('qaap-mcp-plugin-icons', () => {

    it('bundles brand SVGs for every marketplace plugin slug', () => {
        for (const plugin of QAAP_MCP_MARKETPLACE_PLUGINS) {
            expect(hasMcpPluginIcon(plugin.slug), plugin.slug).to.equal(true);
            expect(MCP_PLUGIN_ICON_SVGS[resolveMcpPluginIconAssetKey(plugin.slug)]).to.include('<svg');
        }
    });

    it('maps brave-search slug to the brave asset key', () => {
        expect(resolveMcpPluginIconAssetKey('brave-search')).to.equal('brave');
        expect(hasMcpPluginIcon('brave-search')).to.equal(true);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';

/** Keep in sync with `@theia/ai-mcp` `MCP_SERVERS_PREF`. */
const MCP_SERVERS_PREF = 'ai-features.mcp.mcpServers';
import {
    QAAP_MCP_MARKETPLACE_PLUGINS,
    type QaapMcpMarketplacePlugin,
} from './qaap-mcp-plugin-marketplace-catalog';

export function readInstalledMcpServerSlugs(preferenceService: PreferenceService): Set<string> {
    const current = preferenceService.get<Record<string, unknown>>(MCP_SERVERS_PREF, {});
    return new Set(Object.keys(current));
}

export function resolveMcpMarketplacePlugin(pluginId: string): QaapMcpMarketplacePlugin | undefined {
    return QAAP_MCP_MARKETPLACE_PLUGINS.find(plugin => plugin.id === pluginId || plugin.slug === pluginId);
}

export async function installMcpMarketplacePlugin(
    pluginId: string,
    preferenceService: PreferenceService,
): Promise<QaapMcpMarketplacePlugin | undefined> {
    const plugin = resolveMcpMarketplacePlugin(pluginId);
    if (!plugin) {
        return undefined;
    }
    const current = preferenceService.get<Record<string, object>>(MCP_SERVERS_PREF, {});
    if (current[plugin.slug]) {
        return plugin;
    }
    await preferenceService.set(
        MCP_SERVERS_PREF,
        { ...current, [plugin.slug]: plugin.serverConfig },
        PreferenceScope.User,
    );
    return plugin;
}

export async function removeMcpServer(
    serverSlug: string,
    preferenceService: PreferenceService,
): Promise<boolean> {
    const current = preferenceService.get<Record<string, object>>(MCP_SERVERS_PREF, {});
    if (!current[serverSlug]) {
        return false;
    }
    const next = { ...current };
    delete next[serverSlug];
    await preferenceService.set(MCP_SERVERS_PREF, next, PreferenceScope.User);
    return true;
}

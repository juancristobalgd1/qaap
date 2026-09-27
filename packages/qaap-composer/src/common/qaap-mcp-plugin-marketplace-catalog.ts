// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

export interface QaapMcpMarketplacePlugin {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly iconLetter: string;
    readonly iconColor: string;
    readonly serverConfig: Record<string, unknown>;
}

/** Curated MCP plugins shown in the composer slash "Add Plugin" picker (Cursor-style). */
export const QAAP_MCP_MARKETPLACE_PLUGINS: readonly QaapMcpMarketplacePlugin[] = [
    {
        id: 'datadog',
        name: 'Datadog',
        slug: 'datadog',
        description: nls.localize(
            'qaap/mobileProjects/mcpPlugin/datadog',
            'Use Datadog directly in Qaap to query metrics, logs, and incidents.',
        ),
        iconLetter: 'D',
        iconColor: '#632CA6',
        serverConfig: {
            command: 'npx',
            args: ['-y', '@datadog/mcp-server'],
            autostart: true,
        },
    },
    {
        id: 'slack',
        name: 'Slack',
        slug: 'slack',
        description: nls.localize(
            'qaap/mobileProjects/mcpPlugin/slack',
            'Search channels, read threads, and send messages from the agent.',
        ),
        iconLetter: 'S',
        iconColor: '#4A154B',
        serverConfig: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-slack'],
            autostart: true,
        },
    },
    {
        id: 'figma',
        name: 'Figma',
        slug: 'figma',
        description: nls.localize(
            'qaap/mobileProjects/mcpPlugin/figma',
            'Inspect Figma files, components, and design tokens from chat.',
        ),
        iconLetter: 'F',
        iconColor: '#F24E1E',
        serverConfig: {
            command: 'npx',
            args: ['-y', 'figma-developer-mcp'],
            autostart: true,
        },
    },
    {
        id: 'linear',
        name: 'Linear',
        slug: 'linear',
        description: nls.localize(
            'qaap/mobileProjects/mcpPlugin/linear',
            'Create and update Linear issues, projects, and cycles.',
        ),
        iconLetter: 'L',
        iconColor: '#5E6AD2',
        serverConfig: {
            command: 'npx',
            args: ['-y', '@linear/mcp-server'],
            autostart: true,
        },
    },
    {
        id: 'github',
        name: 'GitHub',
        slug: 'github',
        description: nls.localize(
            'qaap/mobileProjects/mcpPlugin/github',
            'Browse repos, issues, and pull requests with the GitHub MCP server.',
        ),
        iconLetter: 'G',
        iconColor: '#24292F',
        serverConfig: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            autostart: true,
        },
    },
    {
        id: 'brave-search',
        name: 'Brave Search',
        slug: 'brave-search',
        description: nls.localize(
            'qaap/mobileProjects/mcpPlugin/braveSearch',
            'Web search for up-to-date answers via the Brave Search API.',
        ),
        iconLetter: 'B',
        iconColor: '#FB542B',
        serverConfig: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search'],
            autostart: true,
        },
    },
];

export function filterMcpMarketplacePlugins(
    plugins: readonly QaapMcpMarketplacePlugin[],
    query: string,
    installedSlugs: ReadonlySet<string> = new Set(),
): QaapMcpMarketplacePlugin[] {
    const needle = query.trim().toLowerCase();
    return plugins.filter(plugin => {
        if (installedSlugs.has(plugin.slug)) {
            return false;
        }
        if (!needle) {
            return true;
        }
        return plugin.name.toLowerCase().includes(needle)
            || plugin.slug.toLowerCase().includes(needle)
            || plugin.description.toLowerCase().includes(needle);
    });
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { MCP_PLUGIN_ICON_SLUG_TO_ASSET_KEY, MCP_PLUGIN_ICON_SVGS } from './qaap-mcp-plugin-icon-assets';

export interface McpPluginIconFallback {
    readonly letter: string;
    readonly color?: string;
}

export function resolveMcpPluginIconAssetKey(slug: string): string {
    return MCP_PLUGIN_ICON_SLUG_TO_ASSET_KEY[slug] ?? slug;
}

export function hasMcpPluginIcon(slug: string): boolean {
    const assetKey = resolveMcpPluginIconAssetKey(slug);
    return !!MCP_PLUGIN_ICON_SVGS[assetKey];
}

/** Renders the bundled brand SVG or a letter monogram fallback. */
export function createMcpPluginIconElement(
    slug: string,
    className: string,
    fallback?: McpPluginIconFallback,
): HTMLElement {
    const host = document.createElement('span');
    host.className = className;
    host.setAttribute('aria-hidden', 'true');

    const assetKey = resolveMcpPluginIconAssetKey(slug);
    const svg = MCP_PLUGIN_ICON_SVGS[assetKey];
    if (svg) {
        host.classList.add('theia-mod-branded');
        host.innerHTML = svg;
        return host;
    }

    if (fallback?.color) {
        host.style.backgroundColor = fallback.color;
        host.textContent = fallback.letter;
        return host;
    }

    host.classList.add('theia-mod-generic');
    host.textContent = fallback?.letter ?? slug.charAt(0).toUpperCase();
    return host;
}

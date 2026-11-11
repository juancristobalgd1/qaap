// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { MCP_SERVERS_PREF } from '@theia/ai-mcp/lib/common/mcp-preferences';
import { QAAP_MCP_MARKETPLACE_PLUGINS } from '@theia/qaap-composer/lib/common/qaap-mcp-plugin-marketplace-catalog';
import { MobileWorkHubMcpServerSummary } from './mobile-work-hub-mcp-server-summary';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const PLUGIN_SLUG = QAAP_MCP_MARKETPLACE_PLUGINS[0].slug;
const USER_SLUG = 'linear';

describe('MobileWorkHubMcpServerSummary', () => {

    useSuiteJSDOM();

    function createHarness(servers: Record<string, unknown>, descriptions: Record<string, { status: MCPServerStatus; error?: string }>): {
        summary: MobileWorkHubMcpServerSummary;
        calls: string[];
        fireServersChanged: () => void;
        disposed: () => boolean;
        setServers: (next: Record<string, unknown>) => void;
    } {
        const calls: string[] = [];
        let current = servers;
        const listeners: ((event: { preferenceName: string }) => void)[] = [];
        let disposed = false;
        const preferenceService = {
            get: (name: string, fallback?: unknown) => name === MCP_SERVERS_PREF ? current : fallback,
            onPreferenceChanged: (listener: (event: { preferenceName: string }) => void) => {
                listeners.push(listener);
                return { dispose: () => { disposed = true; } };
            },
        };
        const mcpFrontendService = {
            getStartedServers: async () => [PLUGIN_SLUG],
            getServerDescription: async (slug: string) => descriptions[slug] ? { name: slug, ...descriptions[slug] } : undefined,
            startServer: async (slug: string) => { calls.push(`start:${slug}`); },
            stopServer: async (slug: string) => { calls.push(`stop:${slug}`); },
        };
        const summary = new MobileWorkHubMcpServerSummary({
            preferenceService: preferenceService as never,
            mcpFrontendService: mcpFrontendService as never,
        });
        return {
            summary,
            calls,
            fireServersChanged: () => listeners.forEach(listener => listener({ preferenceName: MCP_SERVERS_PREF })),
            disposed: () => disposed,
            setServers: next => { current = next; },
        };
    }

    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    it('lists the composer User and Plugins sections with status and error hint', async () => {
        const harness = createHarness(
            { [USER_SLUG]: {}, [PLUGIN_SLUG]: {} },
            { [USER_SLUG]: { status: MCPServerStatus.Errored, error: 'bad token' }, [PLUGIN_SLUG]: { status: MCPServerStatus.Running } },
        );
        await harness.summary.refresh();

        const titles = Array.from(harness.summary.node.querySelectorAll('.theia-mobile-mcp-attach-section-title')).map(el => el.textContent);
        expect(titles).to.deep.equal(['User', 'Plugins']);
        const hint = harness.summary.node.querySelector<HTMLElement>('.theia-mobile-mcp-attach-server-hint');
        expect(hint?.title).to.equal('bad token');
        harness.summary.dispose();
    });

    it('toggles through the same stop/start action and refreshes on preference change', async () => {
        const harness = createHarness(
            { [USER_SLUG]: {}, [PLUGIN_SLUG]: {} },
            { [PLUGIN_SLUG]: { status: MCPServerStatus.Running } },
        );
        await harness.summary.refresh();
        document.body.appendChild(harness.summary.node);

        harness.summary.node.querySelectorAll<HTMLButtonElement>('.theia-mobile-mcp-attach-toggle')[1].click();
        expect(harness.calls).to.deep.equal([`stop:${PLUGIN_SLUG}`]);
        await settle();

        harness.setServers({ [USER_SLUG]: {} });
        harness.fireServersChanged();
        await settle();
        expect(harness.summary.node.querySelectorAll('.theia-mobile-mcp-attach-server-row').length).to.equal(1);

        harness.summary.dispose();
        expect(harness.disposed()).to.equal(true);
        harness.summary.node.remove();
    });
});

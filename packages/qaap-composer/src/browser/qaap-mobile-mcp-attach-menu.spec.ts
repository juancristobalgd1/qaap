// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { QAAP_MCP_MARKETPLACE_PLUGINS } from '../common/qaap-mcp-plugin-marketplace-catalog';
import {
    createMobileMcpAttachRowElement,
    groupMobileMcpAttachRows,
    loadMobileMcpAttachServerRows,
    MobileMcpAttachServerRow,
    renderMobileMcpAttachSections,
} from './qaap-mobile-mcp-attach-menu';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const PLUGIN_SLUG = QAAP_MCP_MARKETPLACE_PLUGINS[0].slug;
const USER_SLUG = 'linear';

interface FakeFrontendState {
    readonly started?: string[];
    readonly descriptions?: Record<string, { status: MCPServerStatus; error?: string }>;
}

/** Records every start/stop call; `service` is the manager surface the composer and Settings read. */
function createFrontend(state: FakeFrontendState = {}): { calls: string[]; service: unknown } {
    const calls: string[] = [];
    const started = [...(state.started ?? [])];
    const descriptions = state.descriptions ?? {};
    const service = {
        getStartedServers: async () => [...started],
        getServerDescription: async (slug: string) => descriptions[slug] ? { name: slug, ...descriptions[slug] } : undefined,
        startServer: async (slug: string) => { calls.push(`start:${slug}`); },
        stopServer: async (slug: string) => { calls.push(`stop:${slug}`); },
    };
    return { calls, service };
}

function createPreferenceService(servers: Record<string, unknown>): Parameters<typeof loadMobileMcpAttachServerRows>[0]['preferenceService'] {
    return {
        get: (_name: string, defaultValue?: unknown) => servers ?? defaultValue,
    } as unknown as Parameters<typeof loadMobileMcpAttachServerRows>[0]['preferenceService'];
}

describe('loadMobileMcpAttachServerRows', () => {

    it('maps preference servers to rows with live status and error message', async () => {
        const frontend = createFrontend({
            started: [PLUGIN_SLUG],
            descriptions: {
                [USER_SLUG]: { status: MCPServerStatus.Errored, error: 'invalid token' },
                [PLUGIN_SLUG]: { status: MCPServerStatus.Running },
            },
        });
        const rows = await loadMobileMcpAttachServerRows({
            preferenceService: createPreferenceService({ [USER_SLUG]: {}, [PLUGIN_SLUG]: {} }),
            mcpFrontendService: frontend.service as never,
        });

        expect(rows.map(row => row.slug)).to.deep.equal([PLUGIN_SLUG, USER_SLUG].sort());
        const user = rows.find(row => row.slug === USER_SLUG)!;
        expect(user.errored).to.equal(true);
        expect(user.statusHint).to.be.a('string');
        expect(user.statusMessage).to.equal('invalid token');
        expect(user.isMarketplacePlugin).to.equal(false);
        const plugin = rows.find(row => row.slug === PLUGIN_SLUG)!;
        expect(plugin.running).to.equal(true);
        expect(plugin.errored).to.equal(false);
        expect(plugin.statusMessage).to.equal(undefined);
        expect(plugin.isMarketplacePlugin).to.equal(true);
    });

    it('returns no rows when no server is configured', async () => {
        const rows = await loadMobileMcpAttachServerRows({
            preferenceService: createPreferenceService({}),
            mcpFrontendService: createFrontend().service as never,
        });
        expect(rows).to.deep.equal([]);
    });
});

describe('groupMobileMcpAttachRows', () => {

    it('splits rows into User and Plugins', () => {
        const base = { label: '', iconLetter: 'x', running: false, errored: false, slug: '' };
        const rows: MobileMcpAttachServerRow[] = [
            { ...base, slug: USER_SLUG, isMarketplacePlugin: false },
            { ...base, slug: PLUGIN_SLUG, isMarketplacePlugin: true },
        ];
        const { userRows, pluginRows } = groupMobileMcpAttachRows(rows);
        expect(userRows.map(row => row.slug)).to.deep.equal([USER_SLUG]);
        expect(pluginRows.map(row => row.slug)).to.deep.equal([PLUGIN_SLUG]);
    });
});

describe('renderMobileMcpAttachSections', () => {

    useSuiteJSDOM();

    it('renders User and Plugins sections and toggles through the shared stop/start actions', async () => {
        const frontend = createFrontend({ started: [PLUGIN_SLUG] });
        const mcpOptions = {
            preferenceService: createPreferenceService({}),
            mcpFrontendService: frontend.service as never,
        };
        const rows: MobileMcpAttachServerRow[] = [
            { slug: USER_SLUG, label: USER_SLUG, iconLetter: 'L', running: false, errored: true, statusHint: 'Errored', statusMessage: 'boom', isMarketplacePlugin: false },
            { slug: PLUGIN_SLUG, label: PLUGIN_SLUG, iconLetter: 'G', running: true, errored: false, isMarketplacePlugin: true },
        ];
        const container = document.createElement('div');
        const toggling = new Set<string>();
        let reloads = 0;
        const render = (): void => {
            container.replaceChildren();
            renderMobileMcpAttachSections(container, rows, {
                mcpOptions: mcpOptions as never,
                toggling,
                rerender: render,
                reload: async () => { reloads++; },
            });
        };
        render();

        const titles = Array.from(container.querySelectorAll('.theia-mobile-mcp-attach-section-title')).map(el => el.textContent);
        expect(titles).to.deep.equal(['User', 'Plugins']);
        const hint = container.querySelector<HTMLElement>('.theia-mobile-mcp-attach-server-hint')!;
        expect(hint.title).to.equal('boom');

        const toggles = Array.from(container.querySelectorAll<HTMLButtonElement>('.theia-mobile-mcp-attach-toggle'));
        expect(toggles.map(toggle => toggle.getAttribute('aria-checked'))).to.deep.equal(['false', 'true']);

        toggles[1].click();
        expect(frontend.calls).to.deep.equal([`stop:${PLUGIN_SLUG}`]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(reloads).to.equal(1);
        expect(toggling.size).to.equal(0);

        container.querySelectorAll<HTMLButtonElement>('.theia-mobile-mcp-attach-toggle')[0].click();
        expect(frontend.calls).to.deep.equal([`stop:${PLUGIN_SLUG}`, `start:${USER_SLUG}`]);
    });
});

describe('createMobileMcpAttachRowElement settings button', () => {

    const row: MobileMcpAttachServerRow = {
        slug: USER_SLUG,
        label: 'Linear',
        iconLetter: 'L',
        running: false,
        errored: false,
        isMarketplacePlugin: false,
    };

    it('is left out in the composer, where only the switch is shown', () => {
        const element = createMobileMcpAttachRowElement(row, { toggleDisabled: false, onToggle: () => undefined });
        expect(element.querySelector('.theia-mobile-mcp-attach-settings-button')).to.equal(null);
        expect(element.querySelector('.theia-mobile-mcp-attach-toggle')).to.not.equal(null);
    });

    it('sits immediately left of the switch and opens settings without toggling', () => {
        const opened: MobileMcpAttachServerRow[] = [];
        let toggles = 0;
        const element = createMobileMcpAttachRowElement(row, {
            toggleDisabled: false,
            onToggle: () => { toggles++; },
            onOpenSettings: opened.push.bind(opened),
        });
        const settings = element.querySelector<HTMLButtonElement>('.theia-mobile-mcp-attach-settings-button')!;
        const toggle = element.querySelector<HTMLButtonElement>('.theia-mobile-mcp-attach-toggle')!;
        expect(settings.nextElementSibling).to.equal(toggle);
        expect(settings.getAttribute('aria-label')).to.equal('Server settings: Linear');

        settings.click();
        expect(opened).to.deep.equal([row]);
        expect(toggles).to.equal(0);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { MobileWorkHubMcpServerSettingsDialog } from './mobile-work-hub-mcp-server-settings-dialog';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const SLUG = 'linear';

describe('MobileWorkHubMcpServerSettingsDialog', () => {

    useSuiteJSDOM();

    interface HarnessOptions {
        readonly running?: boolean;
        readonly description?: Record<string, unknown>;
        readonly upstreamCard?: HTMLElement;
    }

    function createHarness(options: HarnessOptions = {}): {
        dialog: MobileWorkHubMcpServerSettingsDialog;
        calls: string[];
        changes: () => number;
    } {
        const calls: string[] = [];
        let changes = 0;
        const started = options.running ? [SLUG] : [];
        const description = options.description ?? {
            name: SLUG,
            command: 'npx',
            args: ['-y', 'linear-mcp'],
            env: { LINEAR_API_KEY: 'lin_secret_value', REGION: 'eu' },
            autostart: true,
            status: MCPServerStatus.Running,
            tools: [{ name: 'list_issues', description: 'Lists issues' }],
        };
        const preferenceService = {
            get: () => ({ [SLUG]: {} }),
            onPreferenceChanged: () => ({ dispose: () => undefined }),
        };
        const mcpFrontendService = {
            getStartedServers: async () => [...started],
            getServerDescription: async () => description,
            startServer: async (slug: string) => { calls.push(`start:${slug}`); },
            stopServer: async (slug: string) => { calls.push(`stop:${slug}`); },
        };
        const dialog = new MobileWorkHubMcpServerSettingsDialog({
            preferenceService: preferenceService as never,
            mcpFrontendService: mcpFrontendService as never,
            findUpstreamCard: () => options.upstreamCard,
            onChanged: () => { changes++; },
        });
        return { dialog, calls, changes: () => changes };
    }

    function createUpstreamCard(): { card: HTMLElement; clicks: string[] } {
        const clicks: string[] = [];
        const card = document.createElement('div');
        card.className = 'mcp-server-card';
        const header = document.createElement('div');
        header.className = 'mcp-server-header';
        const name = document.createElement('div');
        name.className = 'mcp-server-name';
        name.textContent = SLUG;
        const controls = document.createElement('div');
        controls.className = 'mcp-server-header-controls';
        const edit = document.createElement('button');
        edit.className = 'mcp-action-button codicon codicon-edit';
        edit.addEventListener('click', () => clicks.push('edit'));
        const remove = document.createElement('button');
        remove.className = 'mcp-action-button mcp-delete-button codicon codicon-trash';
        remove.addEventListener('click', () => clicks.push('delete'));
        controls.append(edit, remove);
        header.append(name, controls);
        card.append(header);
        document.body.append(card);
        return { card, clicks };
    }

    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

    function findButton(dialog: MobileWorkHubMcpServerSettingsDialog, text: string): HTMLButtonElement | undefined {
        return Array.from(dialog.node.querySelectorAll<HTMLButtonElement>('.theia-mobile-work-hub-mcp-server-dialog-actions button'))
            .find(button => button.textContent === text);
    }

    it('shows the error and tools, and lists environment keys with masked values only', async () => {
        const harness = createHarness({
            description: {
                name: SLUG,
                command: 'npx',
                args: ['-y', 'linear-mcp'],
                env: { LINEAR_API_KEY: 'lin_secret_value' },
                autostart: false,
                status: MCPServerStatus.Errored,
                error: 'bad token',
                tools: [{ name: 'list_issues', description: 'Lists issues' }],
            },
        });
        document.body.append(harness.dialog.node);
        await harness.dialog.show(SLUG);
        await settle();

        const text = harness.dialog.node.textContent ?? '';
        expect(text).to.contain('LINEAR_API_KEY');
        expect(text).to.contain('••••');
        expect(text).to.not.contain('lin_secret_value');
        expect(harness.dialog.node.querySelector('.theia-mobile-work-hub-mcp-server-dialog-error')?.textContent).to.equal('bad token');
        expect(harness.dialog.node.querySelector('.theia-mobile-work-hub-mcp-server-dialog-badge')?.classList.contains('theia-mod-errored')).to.equal(true);
        expect(text).to.contain('list_issues');
        expect(text).to.contain('Disabled');
        harness.dialog.dispose();
    });

    it('starts a stopped server through the same service calls as the switch and refreshes', async () => {
        const harness = createHarness({ running: false });
        document.body.append(harness.dialog.node);
        await harness.dialog.show(SLUG);
        await settle();

        findButton(harness.dialog, 'Start')!.click();
        await settle();

        expect(harness.calls).to.deep.equal([`start:${SLUG}`]);
        expect(harness.changes()).to.equal(1);
        harness.dialog.dispose();
    });

    it('Edit clicks the matching hidden upstream card button and closes the dialog', async () => {
        const upstream = createUpstreamCard();
        const harness = createHarness({ upstreamCard: upstream.card });
        document.body.append(harness.dialog.node);
        await harness.dialog.show(SLUG);
        await settle();

        findButton(harness.dialog, 'Edit')!.click();

        expect(upstream.clicks).to.deep.equal(['edit']);
        expect(harness.dialog.isVisible()).to.equal(false);
        harness.dialog.dispose();
        upstream.card.remove();
    });

    it('Delete clicks the upstream delete button; the action is hidden when no card is found', async () => {
        const upstream = createUpstreamCard();
        const withCard = createHarness({ upstreamCard: upstream.card });
        document.body.append(withCard.dialog.node);
        await withCard.dialog.show(SLUG);
        await settle();

        findButton(withCard.dialog, 'Delete')!.click();
        expect(upstream.clicks).to.deep.equal(['delete']);
        withCard.dialog.dispose();
        upstream.card.remove();

        const withoutCard = createHarness();
        document.body.append(withoutCard.dialog.node);
        await withoutCard.dialog.show(SLUG);
        await settle();
        expect(findButton(withoutCard.dialog, 'Edit')).to.equal(undefined);
        expect(findButton(withoutCard.dialog, 'Delete')).to.equal(undefined);
        withoutCard.dialog.dispose();
    });
});

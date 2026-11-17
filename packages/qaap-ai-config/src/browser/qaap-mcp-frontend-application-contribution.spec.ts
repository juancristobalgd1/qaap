// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The upstream MCP contribution pulls browser modules at load time; the DOM is removed again after imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { QaapMcpFrontendApplicationContribution } from './qaap-mcp-frontend-application-contribution';

disableImportJSDOM();

/**
 * A failing MCP autostart is logged once per session and never re-launched on the next agent start; the
 * failure does not escape, so the other servers still get their autostart attempt.
 */
describe('QaapMcpFrontendApplicationContribution failed autostarts', () => {

    const server = (name: string): MCPServerDescription => ({ name, command: 'npx', args: ['-y', name], autostart: true } as unknown as MCPServerDescription);

    it('logs a failing server once and does not retry it on later autostarts', async () => {
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (message: unknown): void => { warnings.push(String(message)); };
        try {
            // No frontend MCP service is injected here, so every autostart attempt fails inside the upstream call.
            const contribution = new QaapMcpFrontendApplicationContribution();
            await contribution['attemptSilentStartOrPromptForOAuth']('@linear/mcp-server', server('@linear/mcp-server'));
            await contribution['attemptSilentStartOrPromptForOAuth']('@linear/mcp-server', server('@linear/mcp-server'));
            await contribution['attemptSilentStartOrPromptForOAuth']('@linear/mcp-server', server('@linear/mcp-server'));
            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.contain('@linear/mcp-server');
        } finally {
            console.warn = originalWarn;
        }
    });

    it('still attempts another server after one has failed', async () => {
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (message: unknown): void => { warnings.push(String(message)); };
        try {
            const contribution = new QaapMcpFrontendApplicationContribution();
            await contribution['attemptSilentStartOrPromptForOAuth']('a', server('a'));
            await contribution['attemptSilentStartOrPromptForOAuth']('b', server('b'));
            expect(warnings).to.have.length(2);
        } finally {
            console.warn = originalWarn;
        }
    });
});

/** The legacy token-less GitHub entry never reaches the backend: it is neither registered nor autostarted. */
describe('QaapMcpFrontendApplicationContribution legacy GitHub entry', () => {

    type Servers = Parameters<QaapMcpFrontendApplicationContribution['convertToMap']>[0];
    const convert = (servers: Record<string, unknown>): Map<string, MCPServerDescription> =>
        new QaapMcpFrontendApplicationContribution()['convertToMap'](servers as unknown as Servers);

    it('drops the legacy npx entry and keeps the other servers', () => {
        const map = convert({
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], autostart: true, env: {} },
            slack: { command: 'npx', args: ['-y', 'slack'], autostart: true },
        });
        expect([...map.keys()]).to.deep.equal(['slack']);
    });

    it('drops the token-less remote entry', () => {
        expect(convert({ github: { serverUrl: 'https://api.githubcopilot.com/mcp/' } }).size).to.equal(0);
    });

    it('keeps a github entry the user customised', () => {
        const map = convert({ github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'x' } } });
        expect(map.has('github')).to.equal(true);
    });
});

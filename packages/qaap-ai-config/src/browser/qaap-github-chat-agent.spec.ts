// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { QAAP_GITHUB_MCP_READONLY_URL, QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGitHubChatAgent } from './qaap-github-chat-agent';

disableJSDOM();

describe('QaapGitHubChatAgent', () => {

    const githubServer: MCPServerDescription = { name: QAAP_GITHUB_MCP_SERVER_NAME, serverUrl: QAAP_GITHUB_MCP_READONLY_URL };

    interface Calls {
        sets: Array<{ name: string; value: Record<string, unknown> }>;
        added: MCPServerDescription[];
        started: string[];
        opened: string[];
    }

    function createAgent(options: { prefs: Record<string, unknown>; serverRegistered: boolean; started?: boolean }): { agent: QaapGitHubChatAgent; calls: Calls } {
        const calls: Calls = { sets: [], added: [], started: [], opened: [] };
        const preferenceService = {
            get: <T>(name: string, defaultValue?: T): T => (options.prefs[name] ?? defaultValue) as T,
            set: async (name: string, value: Record<string, unknown>): Promise<void> => {
                calls.sets.push({ name, value });
                options.prefs[name] = value;
            }
        };
        const mcpService = {
            hasServer: async (): Promise<boolean> => options.serverRegistered,
            isServerStarted: async (): Promise<boolean> => !!options.started,
            addOrUpdateServer: async (server: MCPServerDescription): Promise<void> => { calls.added.push(server); },
            startServer: async (name: string): Promise<void> => { calls.started.push(name); }
        };
        const agent = new QaapGitHubChatAgent();
        Object.assign(agent, {
            preferenceService,
            mcpService,
            logger: { error: (): void => undefined, debug: (): void => undefined },
            openAndFocusOnGitHubConfig: async (name: string): Promise<void> => { calls.opened.push(name); }
        });
        return { agent, calls };
    }

    it('starts the registered managed server and never writes a GitHub entry to the preferences', async () => {
        const { agent, calls } = createAgent({ prefs: {}, serverRegistered: false });
        await agent.ensureServerStarted(githubServer);

        expect(calls.sets).to.have.length(0);
        expect(calls.added).to.have.length(0);
        expect(calls.started).to.deep.equal(['qaap-github']);
    });

    it('keeps an existing github entry untouched when it starts the server', async () => {
        const existing = { serverUrl: 'https://api.githubcopilot.com/mcp/', customSetting: 'kept' };
        const { agent, calls } = createAgent({ prefs: { 'ai-features.mcp.mcpServers': { github: existing } }, serverRegistered: true });
        await agent.ensureServerStarted(githubServer);

        expect(calls.sets).to.have.length(0);
        expect(calls.started).to.deep.equal(['qaap-github']);
    });

    it('does not start the server again when it is already started', async () => {
        const { agent, calls } = createAgent({ prefs: {}, serverRegistered: true, started: true });
        await agent.ensureServerStarted(githubServer);

        expect(calls.sets).to.have.length(0);
        expect(calls.started).to.have.length(0);
    });

    it('points its system prompt at the managed server tools, not at a server named github', () => {
        const { agent } = createAgent({ prefs: {}, serverRegistered: true });
        const prompts = (agent as unknown as { prompts: Array<{ defaultVariant: { template: string } }> }).prompts;
        const template = prompts[0].defaultVariant.template;
        expect(template).to.contain('{{prompt:mcp_qaap-github_tools}}');
        expect(template).to.not.contain('{{prompt:mcp_github_tools}}');
    });

    it('offers configuration without writing a GitHub entry and keeps the other servers', async () => {
        const slack = { command: 'npx', args: ['-y', 'slack'], autostart: true };
        const { agent, calls } = createAgent({ prefs: { 'ai-features.mcp.mcpServers': { slack } }, serverRegistered: false });
        await agent['offerConfiguration']();

        expect(calls.sets).to.have.length(0);
        expect(calls.opened).to.deep.equal([]);
    });
});

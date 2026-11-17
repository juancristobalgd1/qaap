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
import { REQUIRED_GITHUB_MCP_SERVERS } from '@theia/ai-ide/lib/browser/github-prompt-template';
import { QaapGitHubChatAgent } from './qaap-github-chat-agent';

disableJSDOM();

describe('QaapGitHubChatAgent', () => {

    const githubServer: MCPServerDescription = REQUIRED_GITHUB_MCP_SERVERS[0];
    const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

    interface Calls {
        sets: Array<{ name: string; value: Record<string, unknown> }>;
        added: MCPServerDescription[];
        started: string[];
        opened: string[];
    }

    function createAgent(options: { prefs: Record<string, unknown>; serverRegistered: boolean }): { agent: QaapGitHubChatAgent; calls: Calls } {
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
            isServerStarted: async (): Promise<boolean> => false,
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

    it('starts the server without writing the token to the preferences', async () => {
        const { agent, calls } = createAgent({ prefs: {}, serverRegistered: false });
        await agent.ensureServerStarted(githubServer);

        expect(calls.sets).to.have.length(1);
        const persisted = calls.sets[0].value.github as Record<string, unknown>;
        expect(persisted).to.deep.equal({ serverUrl: GITHUB_MCP_URL });
        expect(persisted).to.not.have.property('serverAuthToken');
        expect(persisted).to.not.have.property('name');
        // Runtime registration still receives the full description, as before.
        expect(calls.added).to.deep.equal([githubServer]);
        expect(calls.started).to.deep.equal(['github']);
    });

    it('does not replace an existing github entry in the preferences', async () => {
        const existing = { serverUrl: GITHUB_MCP_URL, customSetting: 'kept' };
        const { agent, calls } = createAgent({ prefs: { 'ai-features.mcp.mcpServers': { github: existing } }, serverRegistered: false });
        await agent.ensureServerStarted(githubServer);

        expect(calls.sets).to.have.length(0);
        expect(calls.added).to.deep.equal([githubServer]);
    });

    it('does not touch the preferences when the server is already registered', async () => {
        const { agent, calls } = createAgent({ prefs: {}, serverRegistered: true });
        await agent.ensureServerStarted(githubServer);

        expect(calls.sets).to.have.length(0);
        expect(calls.added).to.have.length(0);
    });

    it('offers configuration without writing the token and keeps the other servers', async () => {
        const slack = { command: 'npx', args: ['-y', 'slack'], autostart: true };
        const { agent, calls } = createAgent({ prefs: { 'ai-features.mcp.mcpServers': { slack } }, serverRegistered: false });
        await agent['offerConfiguration']();

        expect(calls.sets).to.have.length(1);
        expect(calls.sets[0].value).to.deep.equal({ slack, github: { serverUrl: GITHUB_MCP_URL } });
        expect(JSON.stringify(calls.sets[0].value)).to.not.contain('serverAuthToken');
        expect(calls.opened).to.deep.equal(['github']);
    });

    it('offers configuration and keeps an existing github entry untouched', async () => {
        const existing = { serverUrl: GITHUB_MCP_URL, customSetting: 'kept' };
        const { agent, calls } = createAgent({ prefs: { 'ai-features.mcp.mcpServers': { github: existing } }, serverRegistered: false });
        await agent['offerConfiguration']();

        expect(calls.sets).to.have.length(0);
        expect(calls.opened).to.deep.equal(['github']);
    });
});

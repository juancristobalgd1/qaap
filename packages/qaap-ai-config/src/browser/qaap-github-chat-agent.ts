// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { MCP_SERVERS_PREF } from '@theia/ai-mcp/lib/common/mcp-preferences';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { PreferenceScope } from '@theia/core/lib/common/preferences';
import { GitHubChatAgent } from '@theia/ai-ide/lib/browser/github-chat-agent';
import { REQUIRED_GITHUB_MCP_SERVERS } from '@theia/ai-ide/lib/browser/github-prompt-template';

/**
 * GitHub chat agent that never writes `serverAuthToken` into the MCP preferences.
 *
 * The upstream agent persists its placeholder token marker to `ai-features.mcp.mcpServers` when it configures
 * the server. Here the persisted entry drops `name` (as upstream does) and `serverAuthToken`; the token is
 * entered by the user in settings. Runtime registration (`addOrUpdateServer`) is unchanged.
 *
 * An existing `github` preference entry is kept as it is, so a token the user already added is never replaced.
 */
@injectable()
export class QaapGitHubChatAgent extends GitHubChatAgent {

    override async ensureServerStarted(server: MCPServerDescription): Promise<void> {
        try {
            if (!(await this.mcpService.hasServer(server.name))) {
                await this.persistServerWithoutToken(server);
                await this.mcpService.addOrUpdateServer(server);
            }

            if (!(await this.mcpService.isServerStarted(server.name))) {
                await this.mcpService.startServer(server.name);
            }
        } catch (error) {
            this.logger.error(`Error starting GitHub MCP server ${server.name}: ${error}`);
            throw error;
        }
    }

    protected override async offerConfiguration(): Promise<void> {
        const githubServer = REQUIRED_GITHUB_MCP_SERVERS[0];
        await this.persistServerWithoutToken(githubServer);
        await this.openAndFocusOnGitHubConfig(githubServer.name);
    }

    /** Writes the server entry to the user preferences without its name and without any token. */
    protected async persistServerWithoutToken(server: MCPServerDescription): Promise<void> {
        const current = this.preferenceService.get<Record<string, unknown>>(MCP_SERVERS_PREF, {});
        if (Object.prototype.hasOwnProperty.call(current, server.name)) {
            return;
        }
        await this.preferenceService.set(MCP_SERVERS_PREF, { ...current, [server.name]: this.toPreferenceEntry(server) }, PreferenceScope.User);
    }

    protected toPreferenceEntry(server: MCPServerDescription): Record<string, unknown> {
        const entry: Record<string, unknown> = { ...server };
        delete entry['name'];
        delete entry['serverAuthToken'];
        return entry;
    }
}

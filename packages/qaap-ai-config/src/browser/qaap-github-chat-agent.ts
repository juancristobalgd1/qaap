// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { GitHubChatAgent } from '@theia/ai-ide/lib/browser/github-chat-agent';
import { githubTemplate } from '@theia/ai-ide/lib/browser/github-prompt-template';
import {
    QAAP_GITHUB_MCP_READONLY_URL,
    QAAP_GITHUB_MCP_SERVER_NAME
} from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';

/** The upstream prompt refers to the tools of a server named `github`; the managed server is `qaap-github`. */
const UPSTREAM_GITHUB_TOOLS_FRAGMENT = '{{prompt:mcp_github_tools}}';
const MANAGED_GITHUB_TOOLS_FRAGMENT = `{{prompt:mcp_${QAAP_GITHUB_MCP_SERVER_NAME}_tools}}`;

const managedGithubTemplate: typeof githubTemplate = {
    ...githubTemplate,
    template: githubTemplate.template.split(UPSTREAM_GITHUB_TOOLS_FRAGMENT).join(MANAGED_GITHUB_TOOLS_FRAGMENT)
};

/** The managed server is the only GitHub server this agent uses; it is never written to the preferences. */
const MANAGED_SERVER: MCPServerDescription = { name: QAAP_GITHUB_MCP_SERVER_NAME, serverUrl: QAAP_GITHUB_MCP_READONLY_URL };

/**
 * GitHub chat agent bound to the managed GitHub MCP server.
 *
 * The backend registers the managed server itself (read-only, OAuth-less, token from the credential
 * resolver), so this agent only starts it. Upstream would persist a `github` entry when none is
 * registered and would ask the user to paste a token; neither happens here.
 */
@injectable()
export class QaapGitHubChatAgent extends GitHubChatAgent {

    override prompts = [{ id: 'github-system', defaultVariant: managedGithubTemplate, variants: [] }];

    protected override async requiresConfiguration(): Promise<boolean> {
        return !(await this.mcpService.hasServer(QAAP_GITHUB_MCP_SERVER_NAME));
    }

    protected override async requiresStartingServer(): Promise<boolean> {
        return !(await this.mcpService.isServerStarted(QAAP_GITHUB_MCP_SERVER_NAME));
    }

    protected override async startServer(): Promise<void> {
        await this.ensureServerStarted(MANAGED_SERVER);
    }

    override async ensureServerStarted(server: MCPServerDescription): Promise<void> {
        try {
            if (!(await this.mcpService.isServerStarted(server.name))) {
                await this.mcpService.startServer(server.name);
            }
        } catch (error) {
            this.logger.error(`Error starting GitHub MCP server ${server.name}: ${error}`);
            throw error;
        }
    }

    protected override offerConfiguration(): Promise<void> {
        // Nothing to configure in settings: the managed server has no user-editable token.
        return Promise.resolve();
    }
}

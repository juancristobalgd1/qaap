// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { ToolRequest } from '@theia/ai-core';
import { MCPFrontendServiceImpl } from '@theia/ai-mcp/lib/browser/mcp-frontend-service';
import { QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';

/** The user's own GitHub server name; upstream prompts (`code-reviewer`, `explore`) use its `mcp_github_tools`. */
const USER_GITHUB_SERVER_NAME = 'github';

/**
 * Lets the upstream prompts that refer to `{{prompt:mcp_github_tools}}` (`code-reviewer`, `explore`) use the
 * managed `qaap-github` tools, without changing those upstream templates:
 *
 * - when the managed server's tools are registered and the user has NO `github` server, the fragment
 *   `mcp_github_tools` is also registered, listing the managed tools (an alias);
 * - when the user has a `github` server, the alias is not registered (or is dropped) and upstream registers the
 *   user's own fragment when that server starts, so the user's server wins;
 * - when the managed tools are unregistered, the alias goes with them.
 */
@injectable()
export class QaapMcpFrontendService extends MCPFrontendServiceImpl {

    /** Tool requests of the managed server's latest registration, kept to rebuild the alias. */
    protected managedTools: { toolRequests: ToolRequest[]; deferLoading: boolean } | undefined;
    protected githubAliasActive = false;

    override async registerTools(serverName: string): Promise<void> {
        await super.registerTools(serverName);
        if (serverName === QAAP_GITHUB_MCP_SERVER_NAME) {
            await this.syncGithubAlias();
        } else if (serverName === USER_GITHUB_SERVER_NAME) {
            // Upstream just wrote the user's own fragment under the same id.
            this.githubAliasActive = false;
        }
    }

    protected override createPromptTemplate(serverName: string, toolRequests: ToolRequest[], deferLoading: boolean = false): void {
        super.createPromptTemplate(serverName, toolRequests, deferLoading);
        if (serverName === QAAP_GITHUB_MCP_SERVER_NAME) {
            this.managedTools = { toolRequests, deferLoading };
        }
    }

    protected override unregisterTools(serverName: string): void {
        super.unregisterTools(serverName);
        if (serverName === QAAP_GITHUB_MCP_SERVER_NAME) {
            this.managedTools = undefined;
            if (this.githubAliasActive) {
                this.githubAliasActive = false;
                this.promptService.removePromptFragment(this.getPromptTemplateId(USER_GITHUB_SERVER_NAME));
            }
        } else if (serverName === USER_GITHUB_SERVER_NAME) {
            // Upstream removed `mcp_github_tools`; it was the user's, not the alias.
            this.githubAliasActive = false;
        }
    }

    /** Registers or drops the `mcp_github_tools` alias according to whether the user has a `github` server. */
    protected async syncGithubAlias(): Promise<void> {
        const userHasGithub = await this.hasServer(USER_GITHUB_SERVER_NAME);
        if (userHasGithub || !this.managedTools) {
            if (this.githubAliasActive) {
                this.githubAliasActive = false;
                this.promptService.removePromptFragment(this.getPromptTemplateId(USER_GITHUB_SERVER_NAME));
            }
            return;
        }
        // The template only lists tool ids (`mcp_qaap-github_<tool>`); the server name only picks the fragment id.
        super.createPromptTemplate(USER_GITHUB_SERVER_NAME, this.managedTools.toolRequests, this.managedTools.deferLoading);
        this.githubAliasActive = true;
    }
}

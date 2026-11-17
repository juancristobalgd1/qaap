// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { ErrorChatResponseContentImpl, MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { nls } from '@theia/core/lib/common/nls';
import { GitHubChatAgent } from '@theia/ai-ide/lib/browser/github-chat-agent';
import { githubTemplate } from '@theia/ai-ide/lib/browser/github-prompt-template';
import { QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGithubMcpOnDemandStarter, QaapGithubMcpStartOutcome } from './qaap-github-mcp-on-demand-starter';

/** The upstream prompt refers to the tools of a server named `github`; the managed server is `qaap-github`. */
const UPSTREAM_GITHUB_TOOLS_FRAGMENT = '{{prompt:mcp_github_tools}}';
const MANAGED_GITHUB_TOOLS_FRAGMENT = `{{prompt:mcp_${QAAP_GITHUB_MCP_SERVER_NAME}_tools}}`;

const managedGithubTemplate: typeof githubTemplate = {
    ...githubTemplate,
    template: githubTemplate.template.split(UPSTREAM_GITHUB_TOOLS_FRAGMENT).join(MANAGED_GITHUB_TOOLS_FRAGMENT)
};

/**
 * GitHub chat agent bound to the managed GitHub MCP server.
 *
 * The backend registers the managed server itself (read-only, OAuth-less, token from the credential
 * resolver), so this agent only starts it. Upstream would persist a `github` entry when none is
 * registered and would ask the user to paste a token; neither happens here.
 */
@injectable()
export class QaapGitHubChatAgent extends GitHubChatAgent {

    @inject(QaapGithubMcpOnDemandStarter)
    protected readonly starter: QaapGithubMcpOnDemandStarter;

    override prompts = [{ id: 'github-system', defaultVariant: managedGithubTemplate, variants: [] }];

    protected override async requiresConfiguration(): Promise<boolean> {
        return !(await this.mcpService.hasServer(QAAP_GITHUB_MCP_SERVER_NAME));
    }

    protected override async requiresStartingServer(): Promise<boolean> {
        return !(await this.mcpService.isServerStarted(QAAP_GITHUB_MCP_SERVER_NAME));
    }

    /** A GitHub turn starts the managed server silently; without a credential the turn ends with a clear error. */
    override async invoke(request: MutableChatRequestModel): Promise<void> {
        const failure = QaapGitHubChatAgent.failureMessage(await this.starter.ensureStarted());
        if (failure) {
            request.response.response.addContent(new ErrorChatResponseContentImpl(new Error(failure)));
            request.response.complete();
            return;
        }
        await super.invoke(request);
    }

    protected override async startServer(): Promise<void> {
        const outcome = await this.starter.ensureStarted();
        const failure = QaapGitHubChatAgent.failureMessage(outcome);
        if (failure) {
            throw new Error(failure);
        }
    }

    /** The text shown in the chat for a start outcome that stops the turn; `undefined` when the turn may continue. */
    static failureMessage(outcome: QaapGithubMcpStartOutcome): string | undefined {
        switch (outcome) {
            case 'started':
                return undefined;
            case 'needs-credential':
                return nls.localize('theia/qaap/githubMcp/noCredential', 'Connect GitHub to use GitHub tools');
            case 'auth-required':
                return nls.localize('theia/qaap/githubMcp/authRequired', 'GitHub rejected the token. Connect GitHub again to use GitHub tools.');
            case 'untrusted':
                return nls.localize('theia/qaap/githubMcp/untrusted', 'Trust this workspace to use GitHub tools.');
            default:
                return nls.localize('theia/qaap/githubMcp/startFailed', 'The GitHub MCP server could not connect to GitHub. Try again later.');
        }
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

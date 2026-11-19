// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { MCPOAuthConfig } from '@theia/ai-mcp/lib/common/mcp-oauth';
import { MCPOAuthClientProvider } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider';
import { MCPOAuthClientProviderFactory } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider-factory';
import {
    QAAP_GITHUB_MCP_OAUTH_CLIENT_ID,
    QAAP_GITHUB_MCP_READONLY_URL,
    QAAP_GITHUB_MCP_SERVER_NAME
} from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGithubMcpCredentialResolver } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpAuthProvider } from './qaap-github-mcp-auth-provider';

/**
 * Provider factory handed ONLY to the managed server object that `QaapGithubMcpServerManagerImpl` creates
 * itself. It is not bound in place of the upstream `MCPOAuthClientProviderFactory`: every other server keeps
 * the upstream factory (keystore-backed OAuth, tenant scoping) and can never reach this one, whatever its
 * name, URL or client id. As a second check it refuses any identity other than the managed read-only one.
 */
@injectable()
export class QaapGithubMcpOAuthClientProviderFactory extends MCPOAuthClientProviderFactory {

    @inject(QaapGithubMcpCredentialResolver)
    protected readonly credentialResolver: QaapGithubMcpCredentialResolver;

    override async create(
        serverName: string,
        serverUrl: string,
        config: MCPOAuthConfig,
        options: { interactive: boolean }
    ): Promise<MCPOAuthClientProvider> {
        if (serverName !== QAAP_GITHUB_MCP_SERVER_NAME || serverUrl !== QAAP_GITHUB_MCP_READONLY_URL || config.clientId !== QAAP_GITHUB_MCP_OAUTH_CLIENT_ID) {
            throw new Error('The managed GitHub provider is only available to the managed read-only GitHub MCP server.');
        }
        return new QaapGithubMcpAuthProvider({
            serverName,
            config,
            // No browser flow exists for the managed server, so no callback URL or state is needed.
            callbackUrl: '',
            stateValue: '',
            credentialScope: serverUrl,
            keyStore: this.keyStore,
            frontendDelegate: this.frontendDelegate,
            callbackService: this.callbackService,
            interactive: options.interactive
        }, this.credentialResolver);
    }
}

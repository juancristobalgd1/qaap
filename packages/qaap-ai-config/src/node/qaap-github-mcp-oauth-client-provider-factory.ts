// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import type { MCPOAuthConfig } from '@theia/ai-mcp/lib/common/mcp-oauth';
import { MCPOAuthClientProvider } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider';
import { MCPOAuthClientProviderFactory } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider-factory';
import { QaapGithubMcpCredentialResolver } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpAuthProvider } from './qaap-github-mcp-auth-provider';
import { QaapGithubMcpManagedServer } from './qaap-github-mcp-managed-server';

/**
 * Gives the managed GitHub server its own provider and delegates every other server to the upstream
 * factory, so other servers keep their keystore-backed OAuth and their tenant scoping unchanged.
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
        if (!QaapGithubMcpManagedServer.matches(serverName, serverUrl, config)) {
            return super.create(serverName, serverUrl, config, options);
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

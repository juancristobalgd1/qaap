// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { MCPOAuthClientProvider, MCPOAuthClientProviderOptions } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider';
import { MCPOAuthAuthorizationRequiredError, MCPOAuthAuthorizationServerError } from '@theia/ai-mcp/lib/node/mcp-oauth-errors';
import type { StoredOAuthValue } from '@theia/ai-mcp/lib/node/mcp-oauth-keystore';
import { QAAP_GITHUB_MCP_OAUTH_CLIENT_ID } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGithubMcpCredentialResolver } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpManagedServer } from './qaap-github-mcp-managed-server';

type ManagedTokens = NonNullable<Awaited<ReturnType<MCPOAuthClientProvider['tokens']>>>;
type ManagedClientInformation = NonNullable<Awaited<ReturnType<MCPOAuthClientProvider['clientInformation']>>>;

/**
 * OAuth provider of the managed GitHub MCP server. There is no OAuth flow: the bearer token comes from
 * {@link QaapGithubMcpCredentialResolver} on every request, and nothing is written to the keystore.
 *
 * Any 401 ends in an error, never in a wait: the SDK's `redirectToAuthorization` and
 * `waitForAuthorization` throw, so the server lands in `AuthenticationRequired` instead of hanging.
 * The token is kept only in this provider's memory and is never part of the server description.
 */
export class QaapGithubMcpAuthProvider extends MCPOAuthClientProvider {

    protected readonly memory = new Map<string, StoredOAuthValue>();
    protected lastToken: string | undefined;

    constructor(options: MCPOAuthClientProviderOptions, protected readonly resolver: QaapGithubMcpCredentialResolver) {
        super(options);
    }

    override async tokens(): Promise<ManagedTokens | undefined> {
        const credential = await this.resolver.resolve();
        this.lastToken = credential?.token;
        return credential ? { access_token: credential.token, token_type: 'bearer' } : undefined;
    }

    override async clientInformation(): Promise<ManagedClientInformation> {
        // A static client id: no dynamic client registration and no client secret.
        return { client_id: QAAP_GITHUB_MCP_OAUTH_CLIENT_ID };
    }

    override async redirectToAuthorization(): Promise<void> {
        await this.refuse();
    }

    override async waitForAuthorization(): Promise<string> {
        return this.refuse();
    }

    override async invalidateCredentials(): Promise<void> {
        this.memory.clear();
        this.resolver.invalidate();
    }

    /** Reports the rejected token and always throws: the server cannot authorize itself through a browser. */
    protected async refuse(): Promise<never> {
        const token = this.lastToken;
        this.lastToken = undefined;
        const verdict = token ? await this.resolver.reportRejected(token) : 'not-checked';
        if (verdict === 'token-valid') {
            throw new MCPOAuthAuthorizationServerError('access_denied', QaapGithubMcpManagedServer.policyRejectedMessage());
        }
        throw new MCPOAuthAuthorizationRequiredError();
    }

    /** Only the in-memory store is used, so the keystore and its tenant namespace are never touched. */
    protected override async read<T extends StoredOAuthValue>(key: string): Promise<T | undefined> {
        return this.memory.get(key) as T | undefined;
    }

    protected override write(key: string, value: StoredOAuthValue): Promise<void> {
        this.memory.set(key, value);
        return Promise.resolve();
    }

    protected override delete(key: string): Promise<boolean> {
        return Promise.resolve(this.memory.delete(key));
    }
}

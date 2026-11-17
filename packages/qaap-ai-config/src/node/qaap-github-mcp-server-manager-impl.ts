// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { MCPServerManagerImpl } from '@theia/ai-mcp/lib/node/mcp-server-manager-impl';
import { MCPServer } from '@theia/ai-mcp/lib/node/mcp-server';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { nls } from '@theia/core/lib/common/nls';
import { isQaapReservedGithubMcpEntry, QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGithubMcpCredentialResolver } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpManagedServer } from './qaap-github-mcp-managed-server';
import { QaapGithubMcpOAuthClientProviderFactory } from './qaap-github-mcp-oauth-client-provider-factory';

/**
 * Registers the managed GitHub MCP server in the connection's manager and enforces its rules:
 *
 * - the manager creates the managed server object itself, with the managed provider factory; that object is
 *   the managed server's identity. No description that arrives from outside (preferences in any scope, an
 *   extension, an RPC call) can become it, whatever its name, URL, headers or OAuth client id;
 * - the reserved name `qaap-github` and the managed OAuth marker client id are refused for every incoming
 *   description, so nothing replaces, shadows or updates the managed server (refused, not thrown, so one
 *   rejected entry never stops the other servers of the same preference change from being applied);
 * - it is registered on creation (unless the mode is `none`) and again after removal;
 * - it starts only with a credential and only with its exact read-only configuration;
 * - only tools GitHub marks `readOnlyHint` are listed or called (fail closed).
 *
 * Other servers are not affected by any of these rules.
 */
@injectable()
export class QaapGithubMcpServerManagerImpl extends MCPServerManagerImpl {

    @inject(QaapGithubMcpCredentialResolver)
    protected readonly credentialResolver: QaapGithubMcpCredentialResolver;

    @inject(QaapGithubMcpOAuthClientProviderFactory)
    protected readonly managedProviderFactory: QaapGithubMcpOAuthClientProviderFactory;

    /** The managed server object; the only server the managed provider factory is given to. */
    protected managedServer: MCPServer | undefined;

    @postConstruct()
    protected init(): void {
        this.registerManagedServer();
    }

    protected registerManagedServer(): void {
        if (this.credentialResolver.mode() === 'none') {
            return;
        }
        const name = QAAP_GITHUB_MCP_SERVER_NAME;
        const current = this.servers.get(name);
        if (current && current === this.managedServer) {
            return;
        }
        if (current) {
            // Cannot happen while the name is refused on every entry path; never keep an impostor under it.
            this.servers.delete(name);
            this.serverListeners.get(name)?.dispose();
            this.serverListeners.delete(name);
            current.stop().catch(() => { /* already stopped */ });
        }
        const server = this.createManagedServer();
        server.setWorkspaceRoots(this.roots);
        this.managedServer = server;
        this.servers.set(name, server);
        this.serverListeners.set(name, server.onDidUpdateStatus(() => this.notifyManagedChange()));
        this.notifyManagedChange();
    }

    protected createManagedServer(): MCPServer {
        return new MCPServer(QaapGithubMcpManagedServer.describe(), this.managedProviderFactory);
    }

    /** Whether `serverName` currently maps to the managed server object (identity, never content). */
    protected isManaged(serverName: string): boolean {
        const server = this.servers.get(serverName);
        return !!server && server === this.managedServer;
    }

    override async addOrUpdateServer(description: MCPServerDescription): Promise<void> {
        if (isQaapReservedGithubMcpEntry(description.name, description)) {
            console.warn(`Ignoring MCP server "${description.name}": the name "${QAAP_GITHUB_MCP_SERVER_NAME}" and its OAuth client id`
                + ' are reserved for the managed GitHub server.');
            return;
        }
        return super.addOrUpdateServer(description);
    }

    override async removeServer(name: string): Promise<void> {
        const wasManaged = this.isManaged(name);
        await super.removeServer(name);
        if (wasManaged) {
            this.managedServer = undefined;
            this.registerManagedServer();
        }
    }

    override async startServer(serverName: string, options: { interactive?: boolean } = {}): Promise<void> {
        if (this.isManaged(serverName)) {
            if (!QaapGithubMcpManagedServer.isExactConfiguration(this.managedServer?.getCachedDescription())) {
                throw new Error('The managed GitHub MCP server configuration was changed; it is not started.');
            }
            const status = await this.credentialResolver.describe();
            if (!status.available) {
                throw QaapGithubMcpManagedServer.noCredentialError();
            }
        } else if (serverName.trim().toLowerCase() === QAAP_GITHUB_MCP_SERVER_NAME) {
            throw new Error(`MCP server "${serverName}" is reserved.`);
        }
        return super.startServer(serverName, options);
    }

    override async hasStoredOAuthCredentials(serverName: string): Promise<boolean> {
        if (this.isManaged(serverName)) {
            return (await this.credentialResolver.describe()).available;
        }
        return super.hasStoredOAuthCredentials(serverName);
    }

    override async getTools(serverName: string): ReturnType<MCPServerManagerImpl['getTools']> {
        const result = await super.getTools(serverName);
        if (!this.isManaged(serverName)) {
            return result;
        }
        return { ...result, tools: result.tools.filter(tool => tool.annotations?.readOnlyHint === true) };
    }

    override async callTool(serverName: string, toolName: string, argString: string): ReturnType<MCPServerManagerImpl['callTool']> {
        if (this.isManaged(serverName)) {
            const { tools } = await super.getTools(serverName);
            if (!tools.some(tool => tool.name === toolName && tool.annotations?.readOnlyHint === true)) {
                throw new Error(nls.localize('theia/qaap/githubMcp/toolNotReadOnly', 'GitHub tool "{0}" is not available in read-only mode.', toolName));
            }
        }
        return super.callTool(serverName, toolName, argString);
    }

    /** Upstream `notifyClients` is private; same behaviour for the managed registration. */
    protected notifyManagedChange(): void {
        try {
            this.client?.didUpdateMCPServers();
        } catch (error) {
            console.error('Failed to notify MCP frontend client', error);
        }
    }
}

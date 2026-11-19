// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { MCPServerManagerImpl } from '@theia/ai-mcp/lib/node/mcp-server-manager-impl';
import { MCPServer } from '@theia/ai-mcp/lib/node/mcp-server';
import { isLocalMCPServerDescription, MCPServerDescription, MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
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
 * Separately, a local server that runs the deprecated `@modelcontextprotocol/server-github` package without
 * its only credential (`GITHUB_PERSONAL_ACCESS_TOKEN`, from the entry's `env` or the backend environment) is
 * refused whatever its name and whoever registers it: the frontend filter, a frontend still running an older
 * bundle, an extension (`lm-main`) or a direct RPC call. Older builds wrote such an entry and every start
 * spawned `npx server-github` without a token, briefly, before the settings migration removed it again.
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
        if (this.isTokenlessLegacyGithubServer(description)) {
            console.warn(`Ignoring MCP server "${description.name}": @modelcontextprotocol/server-github needs GITHUB_PERSONAL_ACCESS_TOKEN`
                + ' and is never started without it.');
            // An earlier description under this name (with the token) must not keep running in its place.
            if (this.servers.has(description.name)) {
                await super.removeServer(description.name);
            }
            return;
        }
        return super.addOrUpdateServer(description);
    }

    /** Whether `description` launches the deprecated GitHub server package without its credential. */
    protected isTokenlessLegacyGithubServer(description: MCPServerDescription): boolean {
        if (!isLocalMCPServerDescription(description)) {
            return false;
        }
        const commandBase = description.command.trim().split(/[\\/]/).pop() ?? '';
        const launchesLegacyPackage = /^mcp-server-github(\.cmd|\.exe)?$/i.test(commandBase)
            || (description.args ?? []).some(arg => typeof arg === 'string'
                && /(^|[\\/])@modelcontextprotocol[\\/]server-github(@[\w.-]+)?$/i.test(arg.trim()));
        if (!launchesLegacyPackage) {
            return false;
        }
        // The spawned server sees the backend environment overlaid with the entry's `env` (MCPServer.start).
        const key = 'GITHUB_PERSONAL_ACCESS_TOKEN';
        const env = description.env ?? {};
        const token = Object.prototype.hasOwnProperty.call(env, key) ? env[key] : process.env[key];
        return !token?.trim();
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
            // GitHub accepts the token but the endpoint refused it: no automatic retry for this token.
            if (status.rejectedByPolicy) {
                throw QaapGithubMcpManagedServer.policyRejectedError();
            }
            await super.startServer(serverName, options);
            await this.checkManagedRejection();
            return;
        } else if (serverName.trim().toLowerCase() === QAAP_GITHUB_MCP_SERVER_NAME) {
            throw new Error(`MCP server "${serverName}" is reserved.`);
        }
        const description = this.servers.get(serverName)?.getCachedDescription();
        if (description && this.isTokenlessLegacyGithubServer(description)) {
            throw new Error(`MCP server "${serverName}" runs @modelcontextprotocol/server-github without GITHUB_PERSONAL_ACCESS_TOKEN; it is not started.`);
        }
        return super.startServer(serverName, options);
    }

    /**
     * A 401 normally reaches the managed provider, which reports it. A 403 (or a 401 the SDK does not route
     * through the provider) ends in `Errored` after the SSE fallback instead; report it the same way, so a
     * policy refusal is recognised (GitHub `/user` still accepts the token) and is not retried.
     */
    protected async checkManagedRejection(): Promise<void> {
        const description = this.managedServer?.getCachedDescription();
        if (description?.status !== MCPServerStatus.Errored || !/\b(401|403)\b/.test(description.error ?? '')) {
            return;
        }
        const credential = await this.credentialResolver.resolve();
        if (credential) {
            await this.credentialResolver.reportRejected(credential.token);
        }
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

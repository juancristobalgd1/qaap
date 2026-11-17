// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { MCPServerManagerImpl } from '@theia/ai-mcp/lib/node/mcp-server-manager-impl';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { nls } from '@theia/core/lib/common/nls';
import {
    isQaapTokenlessGithubMcpEntry,
    QAAP_GITHUB_MCP_SERVER_NAME
} from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGithubMcpCredentialResolver } from '@theia/qaap-shared-core/lib/node/qaap-github-mcp-credential-resolver';
import { QaapGithubMcpManagedServer } from './qaap-github-mcp-managed-server';

/**
 * Registers the managed GitHub MCP server in the connection's manager and enforces its rules:
 *
 * - it is registered on creation (unless no owner or desktop credential can exist, mode `none`) and again after removal;
 * - a tokenless GitHub preference entry never replaces it (see {@link isQaapTokenlessGithubMcpEntry});
 * - it starts only with a credential, otherwise it throws the stable `qaap-github-mcp/no-credential` error;
 * - in read-only mode only tools GitHub marks `readOnlyHint` are listed or called (fail closed).
 *
 * Other servers are not affected by any of these rules.
 */
@injectable()
export class QaapGithubMcpServerManagerImpl extends MCPServerManagerImpl {

    @inject(QaapGithubMcpCredentialResolver)
    protected readonly credentialResolver: QaapGithubMcpCredentialResolver;

    @postConstruct()
    protected init(): void {
        // The map entry is created synchronously; the rest of the registration has no await before it.
        this.registerManagedServer().catch(error => console.error('Failed to register the managed GitHub MCP server', error));
    }

    protected async registerManagedServer(): Promise<void> {
        if (this.credentialResolver.mode() === 'none') {
            return;
        }
        await super.addOrUpdateServer(QaapGithubMcpManagedServer.describe(true));
    }

    override async addOrUpdateServer(description: MCPServerDescription): Promise<void> {
        if (description.name === QAAP_GITHUB_MCP_SERVER_NAME && isQaapTokenlessGithubMcpEntry(description)) {
            if (!this.servers.has(QAAP_GITHUB_MCP_SERVER_NAME)) {
                await this.registerManagedServer();
            }
            return;
        }
        return super.addOrUpdateServer(description);
    }

    override async removeServer(name: string): Promise<void> {
        await super.removeServer(name);
        if (name === QAAP_GITHUB_MCP_SERVER_NAME) {
            await this.registerManagedServer();
        }
    }

    override async startServer(serverName: string, options: { interactive?: boolean } = {}): Promise<void> {
        if (QaapGithubMcpManagedServer.isManaged(this.servers.get(serverName)?.getCachedDescription())) {
            const status = await this.credentialResolver.describe();
            if (!status.available) {
                throw QaapGithubMcpManagedServer.noCredentialError();
            }
        }
        return super.startServer(serverName, options);
    }

    override async hasStoredOAuthCredentials(serverName: string): Promise<boolean> {
        if (QaapGithubMcpManagedServer.isManaged(this.servers.get(serverName)?.getCachedDescription())) {
            return (await this.credentialResolver.describe()).available;
        }
        return super.hasStoredOAuthCredentials(serverName);
    }

    override async getTools(serverName: string): ReturnType<MCPServerManagerImpl['getTools']> {
        const result = await super.getTools(serverName);
        if (!this.isReadOnlyManaged(serverName)) {
            return result;
        }
        return { ...result, tools: result.tools.filter(tool => tool.annotations?.readOnlyHint === true) };
    }

    override async callTool(serverName: string, toolName: string, argString: string): ReturnType<MCPServerManagerImpl['callTool']> {
        if (this.isReadOnlyManaged(serverName)) {
            const { tools } = await super.getTools(serverName);
            if (!tools.some(tool => tool.name === toolName && tool.annotations?.readOnlyHint === true)) {
                throw new Error(nls.localize('theia/qaap/githubMcp/toolNotReadOnly', 'GitHub tool "{0}" is not available in read-only mode.', toolName));
            }
        }
        return super.callTool(serverName, toolName, argString);
    }

    protected isReadOnlyManaged(serverName: string): boolean {
        return QaapGithubMcpManagedServer.isReadOnly(this.servers.get(serverName)?.getCachedDescription());
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { McpFrontendApplicationContribution } from '@theia/ai-mcp/lib/browser/mcp-frontend-application-contribution';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import type { MCPServersPreference } from '@theia/ai-mcp/lib/common/mcp-server-preference-validator';
import { QaapGithubMcpDefaultMigration } from './qaap-github-mcp-default-migration';
import { QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';

/**
 * Autostart for MCP servers that fail to launch (for example an npm package that is not in the registry)
 * used to re-run on every agent start. This subclass remembers each failed autostart for the page session:
 * it logs the failure once and does not launch that server again until the page reloads. A failure never
 * escapes into the autostart loop, so the other servers still start. Manual starts are not affected.
 *
 * The token-less legacy GitHub entry (`ai-features.mcp.mcpServers.github`, see
 * {@link QaapGithubMcpDefaultMigration.isLegacyGithubEntry}) is dropped before it reaches the backend, so it is
 * never registered or autostarted, whatever the scope it comes from and whether or not the migration that
 * removes it from the settings has run yet.
 */
@injectable()
export class QaapMcpFrontendApplicationContribution extends McpFrontendApplicationContribution {

    protected readonly failedAutostartServers = new Set<string>();

    protected override convertToMap(servers: MCPServersPreference): Map<string, MCPServerDescription> {
        const legacy = servers?.github;
        if (legacy !== undefined && QaapGithubMcpDefaultMigration.isLegacyGithubEntry(legacy)) {
            const { github, ...rest } = servers;
            return super.convertToMap(rest);
        }
        return super.convertToMap(servers);
    }

    protected override async attemptSilentStartOrPromptForOAuth(name: string, serverDesc: MCPServerDescription): Promise<void> {
        // The managed GitHub server starts on demand with a GitHub turn and has no browser sign-in to offer.
        if (name === QAAP_GITHUB_MCP_SERVER_NAME) {
            return;
        }
        if (this.failedAutostartServers.has(name)) {
            return;
        }
        try {
            await super.attemptSilentStartOrPromptForOAuth(name, serverDesc);
        } catch (error) {
            this.failedAutostartServers.add(name);
            console.warn(`[qaap] MCP server "${name}" did not start; it will not be retried in this session.`, error);
        }
    }
}

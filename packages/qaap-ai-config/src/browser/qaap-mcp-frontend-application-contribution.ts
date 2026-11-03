// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { McpFrontendApplicationContribution } from '@theia/ai-mcp/lib/browser/mcp-frontend-application-contribution';
import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';

/**
 * Autostart for MCP servers that fail to launch (for example an npm package that is not in the registry)
 * used to re-run on every agent start. This subclass remembers each failed autostart for the page session:
 * it logs the failure once and does not launch that server again until the page reloads. A failure never
 * escapes into the autostart loop, so the other servers still start. Manual starts are not affected.
 */
@injectable()
export class QaapMcpFrontendApplicationContribution extends McpFrontendApplicationContribution {

    protected readonly failedAutostartServers = new Set<string>();

    protected override async attemptSilentStartOrPromptForOAuth(name: string, serverDesc: MCPServerDescription): Promise<void> {
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

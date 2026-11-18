// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { MCPServerManager } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { QaapGithubMcpServerManagerImpl } from './qaap-github-mcp-server-manager-impl';
import { QaapGithubMcpOAuthClientProviderFactory } from './qaap-github-mcp-oauth-client-provider-factory';
import { QAAP_GITHUB_MCP_STATUS_PATH, QaapGithubMcpStatusService } from '../common/qaap-github-mcp-status';
import { QaapGithubMcpStatusServiceImpl } from './qaap-github-mcp-status-service-impl';

/**
 * Connection-scoped rebinding of the upstream MCP manager, so the managed GitHub server exists in every
 * frontend connection. Upstream binds the manager per connection and this module is loaded after
 * `@theia/ai-mcp` (qaap-ai-config depends on it), the same order as the OpenAI rebind.
 *
 * The managed provider factory is bound to itself only, NOT in place of `MCPOAuthClientProviderFactory`:
 * the manager hands it to the managed server object alone.
 *
 * The status service answers the frontend with the credential status (never the token value).
 */
export const qaapGithubMcpConnectionModule = ConnectionContainerModule.create(({ bind, rebind, bindBackendService }) => {
    rebind(MCPServerManager).to(QaapGithubMcpServerManagerImpl).inSingletonScope();
    bind(QaapGithubMcpOAuthClientProviderFactory).toSelf().inSingletonScope();
    bind(QaapGithubMcpStatusServiceImpl).toSelf().inSingletonScope();
    bind(QaapGithubMcpStatusService).toService(QaapGithubMcpStatusServiceImpl);
    bindBackendService(QAAP_GITHUB_MCP_STATUS_PATH, QaapGithubMcpStatusService);
});

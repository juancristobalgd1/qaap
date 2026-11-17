// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { MCPServerManager } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { MCPOAuthClientProviderFactory } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider-factory';
import { QaapGithubMcpServerManagerImpl } from './qaap-github-mcp-server-manager-impl';
import { QaapGithubMcpOAuthClientProviderFactory } from './qaap-github-mcp-oauth-client-provider-factory';

/**
 * Connection-scoped rebinding of the upstream MCP manager and its OAuth provider factory, so the managed
 * GitHub server exists in every frontend connection. Upstream binds both per connection and this module is
 * loaded after `@theia/ai-mcp` (qaap-ai-config depends on it), the same order as the OpenAI rebind.
 */
export const qaapGithubMcpConnectionModule = ConnectionContainerModule.create(({ rebind }) => {
    rebind(MCPServerManager).to(QaapGithubMcpServerManagerImpl).inSingletonScope();
    rebind(MCPOAuthClientProviderFactory).to(QaapGithubMcpOAuthClientProviderFactory).inSingletonScope();
});

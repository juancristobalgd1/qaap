// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { MCPOAuthConfig } from '@theia/ai-mcp/lib/common/mcp-oauth';
import type { MCPServerDescription, RemoteMCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_GITHUB_MCP_OAUTH_CLIENT_ID,
    QAAP_GITHUB_MCP_READONLY_URL,
    QAAP_GITHUB_MCP_SERVER_NAME,
    QAAP_GITHUB_MCP_WRITE_URL
} from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';

/** Stable error code the frontend uses to show "Connect GitHub" instead of a generic failure. */
export const QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE = 'qaap-github-mcp/no-credential';

/**
 * The managed GitHub MCP server description. It carries only the public endpoint, the read-only headers
 * and the managed OAuth marker: never a token, a secret or an environment variable. Autostart is off:
 * the server starts on demand, when a GitHub turn or the Connect chip needs it.
 */
export namespace QaapGithubMcpManagedServer {

    export function describe(readOnly: boolean): MCPServerDescription {
        const headers: Record<string, string> = readOnly
            ? { 'X-MCP-Readonly': 'true', 'X-MCP-Lockdown': 'true' }
            : { 'X-MCP-Lockdown': 'true' };
        return {
            name: QAAP_GITHUB_MCP_SERVER_NAME,
            serverUrl: readOnly ? QAAP_GITHUB_MCP_READONLY_URL : QAAP_GITHUB_MCP_WRITE_URL,
            headers,
            oauth: { clientId: QAAP_GITHUB_MCP_OAUTH_CLIENT_ID },
            autostart: false
        };
    }

    /** Whether an OAuth config and server identity are the managed ones (the only ones given the managed provider). */
    export function matches(serverName: string, serverUrl: string, config: MCPOAuthConfig): boolean {
        return serverName === QAAP_GITHUB_MCP_SERVER_NAME
            && (serverUrl === QAAP_GITHUB_MCP_READONLY_URL || serverUrl === QAAP_GITHUB_MCP_WRITE_URL)
            && config.clientId === QAAP_GITHUB_MCP_OAUTH_CLIENT_ID;
    }

    export function isManaged(description: MCPServerDescription | undefined): boolean {
        return !!description && 'serverUrl' in description && matches(description.name, description.serverUrl, description.oauth ?? {});
    }

    export function isReadOnly(description: MCPServerDescription | undefined): boolean {
        return isManaged(description) && (description as RemoteMCPServerDescription).serverUrl === QAAP_GITHUB_MCP_READONLY_URL;
    }

    export function noCredentialError(): Error {
        return Object.assign(
            new Error(nls.localize('theia/qaap/githubMcp/noCredential', 'Connect GitHub to use GitHub tools')),
            { code: QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE }
        );
    }
}

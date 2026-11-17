// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_GITHUB_MCP_OAUTH_CLIENT_ID,
    QAAP_GITHUB_MCP_READONLY_URL,
    QAAP_GITHUB_MCP_SERVER_NAME
} from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';

/** Stable error code the frontend uses to show "Connect GitHub" instead of a generic failure. */
export const QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE = 'qaap-github-mcp/no-credential';

/**
 * The managed GitHub MCP server description. It carries only the public read-only endpoint, the read-only
 * and lockdown headers and the managed OAuth marker: never a token, a secret or an environment variable.
 * Autostart is off: the server starts on demand, when a GitHub turn needs it.
 *
 * Identity is never derived from this content: only the server object the manager registers itself gets
 * the managed token (see `QaapGithubMcpServerManagerImpl`).
 */
export namespace QaapGithubMcpManagedServer {

    export function describe(): MCPServerDescription {
        return {
            name: QAAP_GITHUB_MCP_SERVER_NAME,
            serverUrl: QAAP_GITHUB_MCP_READONLY_URL,
            headers: { 'X-MCP-Readonly': 'true', 'X-MCP-Lockdown': 'true' },
            oauth: { clientId: QAAP_GITHUB_MCP_OAUTH_CLIENT_ID },
            autostart: false
        };
    }

    /**
     * Whether a description is exactly the managed configuration (name, read-only URL, headers, marker,
     * autostart), ignoring runtime fields. A second check behind object identity, before any token is handed out.
     */
    export function isExactConfiguration(description: MCPServerDescription | undefined): boolean {
        if (!description) {
            return false;
        }
        const { status, error, tools, resolve, ...configuration } = description;
        return canonical(configuration) === canonical(describe());
    }

    export function noCredentialError(): Error {
        return Object.assign(
            new Error(nls.localize('theia/qaap/githubMcp/noCredential', 'Connect GitHub to use GitHub tools')),
            { code: QAAP_GITHUB_MCP_NO_CREDENTIAL_CODE }
        );
    }

    function canonical(value: unknown): string {
        return JSON.stringify(value, (_key, inner) => inner && typeof inner === 'object' && !Array.isArray(inner)
            ? Object.fromEntries(Object.keys(inner).sort().map(key => [key, (inner as Record<string, unknown>)[key]]))
            : inner);
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Server name of the managed GitHub MCP server. Not `github`: that name stays the user's own entry, so
 * a user `github` entry never meets the managed token rules. Tools are `mcp_qaap-github_<tool>`, prompt
 * fragment `mcp_qaap-github_tools`.
 *
 * The name is reserved: only the backend registers a server under it (see {@link isQaapReservedGithubMcpEntry}).
 */
export const QAAP_GITHUB_MCP_SERVER_NAME = 'qaap-github';
/**
 * Read-only endpoint: GitHub filters every write tool out of the server. The only endpoint the managed
 * server uses until an opt-in for write tools exists.
 */
export const QAAP_GITHUB_MCP_READONLY_URL = 'https://api.githubcopilot.com/mcp/readonly';
/** Public OAuth client id used only as the managed marker. It is not a secret and no OAuth flow uses it. */
export const QAAP_GITHUB_MCP_OAUTH_CLIENT_ID = 'qaap-managed-github';

/** Structural view of an MCP server entry, so this common module does not import `@theia/ai-mcp`. */
export interface QaapMcpServerEntryShape {
    readonly name?: string;
    readonly oauth?: unknown;
}

/**
 * Whether an entry that comes from outside the backend (preferences in any scope, an extension, an RPC call)
 * claims the managed server's identity: its reserved name (in any letter case) or its OAuth marker client id.
 * Such an entry is never registered, so nothing written to a settings file can stand in for the managed
 * server, receive its token or replace its read-only endpoint.
 */
export function isQaapReservedGithubMcpEntry(name: string | undefined, entry: QaapMcpServerEntryShape | object | undefined): boolean {
    if (typeof name === 'string' && name.trim().toLowerCase() === QAAP_GITHUB_MCP_SERVER_NAME) {
        return true;
    }
    const oauth = entry && 'oauth' in entry ? (entry as QaapMcpServerEntryShape).oauth : undefined;
    if (typeof oauth === 'object' && !!oauth) {
        const clientId = (oauth as { clientId?: unknown }).clientId;
        return typeof clientId === 'string' && clientId.trim().toLowerCase() === QAAP_GITHUB_MCP_OAUTH_CLIENT_ID;
    }
    return false;
}

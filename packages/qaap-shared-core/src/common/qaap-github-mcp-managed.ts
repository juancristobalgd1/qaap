// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Server name of the managed GitHub MCP server. Not `github`: that name stays the user's own entry, so
 * a user `github` entry never meets the managed token rules. Tools are `mcp_qaap-github_<tool>`, prompt
 * fragment `mcp_qaap-github_tools`.
 */
export const QAAP_GITHUB_MCP_SERVER_NAME = 'qaap-github';
/** Read-only endpoint: GitHub filters every write tool out of the server. The default. */
export const QAAP_GITHUB_MCP_READONLY_URL = 'https://api.githubcopilot.com/mcp/readonly';
/** Full endpoint, used only when the user opted into GitHub write tools. */
export const QAAP_GITHUB_MCP_WRITE_URL = 'https://api.githubcopilot.com/mcp/';
/** Public OAuth client id used only as the managed marker. It is not a secret and no OAuth flow uses it. */
export const QAAP_GITHUB_MCP_OAUTH_CLIENT_ID = 'qaap-managed-github';
/** The npm package the marketplace used to install for GitHub. */
export const QAAP_GITHUB_MCP_LEGACY_PACKAGE = '@modelcontextprotocol/server-github';

/** Structural view of an MCP server entry, so this common module does not import `@theia/ai-mcp`. */
export interface QaapMcpServerEntryShape {
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly serverUrl?: string;
    readonly serverAuthToken?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly oauth?: unknown;
}

/**
 * Whether `entry` is a GitHub entry that carries no credential and no customisation: the marketplace
 * default (`npx -y @modelcontextprotocol/server-github`) or a bare `https://api.githubcopilot.com/mcp/`
 * URL without token, OAuth or headers. Such an entry would shadow the managed server, so it is ignored
 * and removed. Anything with a token, OAuth, custom headers or a non-empty `env` is a deliberate
 * customisation and is kept.
 */
export function isQaapTokenlessGithubMcpEntry(entry: QaapMcpServerEntryShape): boolean {
    if (entry.serverAuthToken || entry.oauth || (entry.headers && Object.keys(entry.headers).length > 0)) {
        return false;
    }
    if (entry.serverUrl !== undefined) {
        return entry.serverUrl === QAAP_GITHUB_MCP_WRITE_URL || entry.serverUrl === QAAP_GITHUB_MCP_READONLY_URL;
    }
    if (entry.env && Object.keys(entry.env).length > 0) {
        return false;
    }
    const args = entry.args ?? [];
    const legacyArgs = args.length === 2 && args[0] === '-y' && args[1] === QAAP_GITHUB_MCP_LEGACY_PACKAGE;
    const bareArgs = args.length === 1 && args[0] === QAAP_GITHUB_MCP_LEGACY_PACKAGE;
    return entry.command === 'npx' && (legacyArgs || bareArgs);
}

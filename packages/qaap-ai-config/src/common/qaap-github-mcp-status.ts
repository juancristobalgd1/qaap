// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';

/** RPC path of {@link QaapGithubMcpStatusService}, bound per frontend connection. */
export const QAAP_GITHUB_MCP_STATUS_PATH = '/services/qaap-github-mcp-status';

export const QaapGithubMcpStatusService = Symbol('QaapGithubMcpStatusService');

/**
 * Credential status of the managed GitHub MCP server, as the frontend may see it. It NEVER carries the token
 * value: only whether a credential exists, where it comes from and the backend mode.
 */
export interface QaapGithubMcpStatus {
    readonly available: boolean;
    readonly source: 'owner-token-cache' | 'env' | 'gh-cli' | 'oauth-session' | undefined;
    readonly mode: 'tenant' | 'none' | 'desktop' | 'local';
    /** The endpoint refused the current token while GitHub accepts it (Copilot policy or OAuth app restriction). */
    readonly rejectedByPolicy: boolean;
}

export interface QaapGithubMcpStatusService {
    getStatus(): Promise<QaapGithubMcpStatus>;
}

export namespace QaapGithubMcpStatus {
    /** Copies only the allowed fields, so nothing else (and never a token) can cross the RPC boundary. */
    export function sanitize(status: QaapGithubMcpStatus): QaapGithubMcpStatus {
        return { available: !!status.available, source: status.source, mode: status.mode, rejectedByPolicy: !!status.rejectedByPolicy };
    }
}

/** User-facing texts of the managed GitHub MCP server, shared by the backend errors, the chat and the chip. */
export namespace QaapGithubMcpMessages {
    export function noCredential(desktop: boolean): string {
        return desktop
            ? nls.localize('theia/qaap/githubMcp/noCredentialDesktop', 'Connect GitHub to use GitHub tools, or run `gh auth login`')
            : nls.localize('theia/qaap/githubMcp/noCredential', 'Connect GitHub to use GitHub tools');
    }

    export function authRequired(desktop: boolean): string {
        return desktop
            ? nls.localize('theia/qaap/githubMcp/authRequiredDesktop', 'GitHub rejected the token. Connect GitHub again, or run `gh auth login`, to use GitHub tools.')
            : nls.localize('theia/qaap/githubMcp/authRequired', 'GitHub rejected the token. Connect GitHub again to use GitHub tools.');
    }

    export function untrusted(): string {
        return nls.localize('theia/qaap/githubMcp/untrusted', 'Trust this workspace to use GitHub tools.');
    }

    /** Stable: signing in again does not help, so no Connect action goes with it. */
    export function policyRejected(): string {
        return nls.localize('theia/qaap/githubMcp/rejectedByPolicy', 'GitHub MCP rejected this token (Copilot policy or OAuth app restriction)');
    }

    export function startFailed(): string {
        return nls.localize('theia/qaap/githubMcp/startFailed', 'The GitHub MCP server could not connect to GitHub. Try again later.');
    }
}

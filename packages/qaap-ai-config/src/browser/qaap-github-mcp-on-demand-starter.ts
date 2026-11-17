// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { MCPFrontendService, MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { WorkspaceTrustService } from '@theia/workspace/lib/browser/workspace-trust-service';
import { QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';

/**
 * - `started`: the managed server runs (or was just started).
 * - `needs-credential`: no GitHub credential exists; the server was not started.
 * - `auth-required`: the server started but GitHub refused the token.
 * - `untrusted`: the workspace is not trusted; the server was not started (as upstream blocks MCP autostart).
 * - `error`: the server could not be started or landed in an error state.
 */
export type QaapGithubMcpStartOutcome = 'started' | 'needs-credential' | 'auth-required' | 'untrusted' | 'error';

/**
 * Starts the managed GitHub MCP server on demand, when a GitHub turn needs it. Concurrent callers share
 * one in-flight start, so two turns start the server once. The server is never started without a
 * credential: the credential check comes first and `startServer` is not called when it fails.
 */
@injectable()
export class QaapGithubMcpOnDemandStarter {

    @inject(MCPFrontendService)
    protected readonly mcpService: MCPFrontendService;

    @inject(WorkspaceTrustService)
    protected readonly workspaceTrustService: WorkspaceTrustService;

    protected pending: Promise<QaapGithubMcpStartOutcome> | undefined;
    protected lastOutcome: QaapGithubMcpStartOutcome | undefined;

    protected readonly onDidChangeEmitter = new Emitter<QaapGithubMcpStartOutcome>();
    /** Fires after every completed start attempt, so a status indicator can follow the outcome. */
    readonly onDidChange = this.onDidChangeEmitter.event;

    /** The outcome of the latest completed attempt, or `undefined` before the first one. */
    getLastOutcome(): QaapGithubMcpStartOutcome | undefined {
        return this.lastOutcome;
    }

    ensureStarted(): Promise<QaapGithubMcpStartOutcome> {
        if (!this.pending) {
            const attempt = this.start().finally(() => {
                if (this.pending === attempt) {
                    this.pending = undefined;
                }
            });
            this.pending = attempt;
        }
        return this.pending;
    }

    protected async start(): Promise<QaapGithubMcpStartOutcome> {
        let outcome: QaapGithubMcpStartOutcome;
        try {
            outcome = await this.attempt();
        } catch (error) {
            console.warn('[qaap] The managed GitHub MCP server could not be started.', error instanceof Error ? error.message : String(error));
            outcome = 'error';
        }
        this.lastOutcome = outcome;
        this.onDidChangeEmitter.fire(outcome);
        return outcome;
    }

    protected async attempt(): Promise<QaapGithubMcpStartOutcome> {
        const name = QAAP_GITHUB_MCP_SERVER_NAME;
        // Repository content (issues, PRs) reaches the agent through these tools: same gate as upstream autostart.
        if (!(await this.workspaceTrustService.getWorkspaceTrust())) {
            return 'untrusted';
        }
        if (await this.mcpService.isServerStarted(name)) {
            return 'started';
        }
        if (!(await this.mcpService.hasStoredOAuthCredentials(name))) {
            return 'needs-credential';
        }
        await this.mcpService.startServer(name);
        const description = await this.mcpService.getServerDescription(name);
        switch (description?.status) {
            case MCPServerStatus.AuthenticationRequired:
                return 'auth-required';
            case MCPServerStatus.Connected:
            case MCPServerStatus.Running:
                return 'started';
            default:
                // Errored (for example a 403 that fell back to SSE), not registered, or still not connected.
                console.warn('[qaap] The managed GitHub MCP server did not connect.', description?.status, description?.error);
                return 'error';
        }
    }
}

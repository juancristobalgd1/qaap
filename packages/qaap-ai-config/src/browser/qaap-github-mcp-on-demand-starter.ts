// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { MCPFrontendService, MCPServerStatus } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { WorkspaceTrustService } from '@theia/workspace/lib/browser/workspace-trust-service';
import { QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import { QaapGithubMcpStatus, QaapGithubMcpStatusService } from '../common/qaap-github-mcp-status';

/**
 * - `started`: the managed server runs (or was just started).
 * - `needs-credential`: no GitHub credential exists; the server was not started.
 * - `auth-required`: the server started but GitHub refused the token.
 * - `policy-rejected`: the endpoint refuses a token GitHub accepts (Copilot policy, OAuth app restriction);
 *   the server is not started again for this token.
 * - `untrusted`: the workspace is not trusted; the server was not started (as upstream blocks MCP autostart).
 * - `error`: the server could not be started or landed in an error state.
 */
export type QaapGithubMcpStartOutcome = 'started' | 'needs-credential' | 'auth-required' | 'policy-rejected' | 'untrusted' | 'error';

/**
 * Starts the managed GitHub MCP server on demand, when a GitHub turn needs it. Concurrent callers share
 * one in-flight start, so two turns start the server once. The server is never started without a
 * credential, nor for a token the endpoint refused by policy: the backend status comes first.
 */
@injectable()
export class QaapGithubMcpOnDemandStarter {

    @inject(MCPFrontendService)
    protected readonly mcpService: MCPFrontendService;

    @inject(WorkspaceTrustService)
    protected readonly workspaceTrustService: WorkspaceTrustService;

    @inject(QaapGithubMcpStatusService)
    protected readonly statusService: QaapGithubMcpStatusService;

    protected pending: Promise<QaapGithubMcpStartOutcome> | undefined;
    protected lastOutcome: QaapGithubMcpStartOutcome | undefined;
    protected lastStatus: QaapGithubMcpStatus | undefined;

    protected readonly onDidChangeEmitter = new Emitter<QaapGithubMcpStartOutcome | undefined>();
    /** Fires after every completed start attempt (and `undefined` on {@link reset}), so a status indicator can follow. */
    readonly onDidChange = this.onDidChangeEmitter.event;

    /** The outcome of the latest completed attempt, or `undefined` before the first one. */
    getLastOutcome(): QaapGithubMcpStartOutcome | undefined {
        return this.lastOutcome;
    }

    /** The credential status (never the token) seen by the latest attempt, or `undefined` before the first one. */
    getLastStatus(): QaapGithubMcpStatus | undefined {
        return this.lastStatus;
    }

    /** Forgets the latest outcome (for example after the user trusted the workspace) and notifies listeners. */
    reset(): void {
        this.lastOutcome = undefined;
        this.onDidChangeEmitter.fire(undefined);
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
            outcome = await this.classifyFailure('error');
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
        const status = await this.readStatus();
        if (!status?.available) {
            return 'needs-credential';
        }
        if (status.rejectedByPolicy) {
            return 'policy-rejected';
        }
        await this.mcpService.startServer(name);
        const description = await this.mcpService.getServerDescription(name);
        switch (description?.status) {
            case MCPServerStatus.Connected:
            case MCPServerStatus.Running:
                return 'started';
            case MCPServerStatus.AuthenticationRequired:
                return this.classifyFailure('auth-required');
            default:
                // Errored (for example a 403 that fell back to SSE), not registered, or still not connected.
                console.warn('[qaap] The managed GitHub MCP server did not connect.', description?.status, description?.error);
                return this.classifyFailure('error');
        }
    }

    /** A failed start is a policy refusal when the backend recorded one for the current token. */
    protected async classifyFailure(fallback: 'auth-required' | 'error'): Promise<QaapGithubMcpStartOutcome> {
        const status = await this.readStatus();
        return status?.rejectedByPolicy ? 'policy-rejected' : fallback;
    }

    protected async readStatus(): Promise<QaapGithubMcpStatus | undefined> {
        try {
            this.lastStatus = await this.statusService.getStatus();
        } catch (error) {
            console.warn('[qaap] Could not read the GitHub MCP credential status.', error instanceof Error ? error.message : String(error));
            this.lastStatus = undefined;
        }
        return this.lastStatus;
    }
}

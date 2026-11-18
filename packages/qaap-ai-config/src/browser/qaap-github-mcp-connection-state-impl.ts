// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { MCPFrontendNotificationService, MCPFrontendService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { WorkspaceTrustService } from '@theia/workspace/lib/browser/workspace-trust-service';
import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { QAAP_GITHUB_MCP_SERVER_NAME } from '@theia/qaap-shared-core/lib/common/qaap-github-mcp-managed';
import {
    QaapGithubMcpConnectionKind,
    QaapGithubMcpConnectionSnapshot,
    QaapGithubMcpConnectionState
} from '@theia/qaap-shared-core/lib/browser/qaap-github-mcp-connection-state';
import { QaapGithubMcpOnDemandStarter, QaapGithubMcpStartOutcome } from './qaap-github-mcp-on-demand-starter';

/**
 * Connection state of the managed GitHub MCP server for the composer chip, from the latest on-demand start
 * outcome and the MCP server updates (a server that now runs clears the chip). Nothing here starts the
 * server: the state follows GitHub turns, it never triggers one.
 */
@injectable()
export class QaapGithubMcpConnectionStateImpl implements QaapGithubMcpConnectionState {

    @inject(QaapGithubMcpOnDemandStarter)
    protected readonly starter: QaapGithubMcpOnDemandStarter;

    @inject(MCPFrontendNotificationService)
    protected readonly notifications: MCPFrontendNotificationService;

    @inject(MCPFrontendService)
    protected readonly mcpService: MCPFrontendService;

    @inject(WorkspaceTrustService)
    protected readonly workspaceTrustService: WorkspaceTrustService;

    protected current: QaapGithubMcpConnectionSnapshot = { kind: 'unknown', desktop: false };
    protected readonly toDispose = new DisposableCollection();
    protected readonly onDidChangeEmitter = new Emitter<QaapGithubMcpConnectionSnapshot>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    get snapshot(): QaapGithubMcpConnectionSnapshot {
        return this.current;
    }

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.onDidChangeEmitter);
        this.toDispose.push(this.starter.onDidChange(outcome => this.applyOutcome(outcome)));
        this.toDispose.push(this.notifications.onDidUpdateMCPServers(() => this.refreshFromServers()));
        this.applyOutcome(this.starter.getLastOutcome());
    }

    async connect(): Promise<void> {
        switch (this.current.kind) {
            case 'needs-credential':
            case 'auth-required':
                this.openGithubSignIn();
                return;
            case 'untrusted':
                if (await this.workspaceTrustService.requestWorkspaceTrust()) {
                    // Trusted now: drop the chip; the next GitHub turn starts the server.
                    this.starter.reset();
                }
                return;
            default:
                return;
        }
    }

    protected openGithubSignIn(): void {
        startGithubOAuth();
    }

    protected applyOutcome(outcome: QaapGithubMcpStartOutcome | undefined): void {
        this.update(QaapGithubMcpConnectionStateImpl.kindOf(outcome), this.starter.getLastStatus()?.mode === 'desktop');
    }

    /** A server update that shows the managed server running clears a pending chip. */
    protected async refreshFromServers(): Promise<void> {
        if (this.current.kind === 'connected' || this.current.kind === 'unknown') {
            return;
        }
        try {
            if (await this.mcpService.isServerStarted(QAAP_GITHUB_MCP_SERVER_NAME)) {
                this.update('connected', this.current.desktop);
            }
        } catch {
            // The MCP backend is not reachable right now; keep the current state.
        }
    }

    protected update(kind: QaapGithubMcpConnectionKind, desktop: boolean): void {
        if (this.current.kind === kind && this.current.desktop === desktop) {
            return;
        }
        this.current = { kind, desktop };
        this.onDidChangeEmitter.fire(this.current);
    }

    static kindOf(outcome: QaapGithubMcpStartOutcome | undefined): QaapGithubMcpConnectionKind {
        switch (outcome) {
            case undefined:
                return 'unknown';
            case 'started':
                return 'connected';
            default:
                return outcome;
        }
    }
}

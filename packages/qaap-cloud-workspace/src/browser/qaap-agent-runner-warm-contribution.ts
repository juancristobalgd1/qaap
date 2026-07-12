// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { warmAgentRunner } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';

/**
 * Pre-warms the VPS agent runner when a workspace opens so the first chat message skips
 * cold-start project-info reads and QAIQ CLI startup.
 */
@injectable()
export class QaapAgentRunnerWarmContribution implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    onStart(): void {
        void this.workspace.ready.then(() => this.warmCurrentWorkspace());
        this.workspace.onWorkspaceLocationChanged(() => {
            void this.warmCurrentWorkspace();
        });
    }

    protected async warmCurrentWorkspace(): Promise<void> {
        await this.workspace.ready;
        if (!this.workspace.opened) {
            return;
        }
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            return;
        }
        const cwd = FileUri.fsPath(root);
        // The hosted IDE opens the multi-repo CONTAINER (`/workspace`) as its workspace root.
        // That is "no project selected" — warming it is pointless and each attempt lands in the
        // backend security log as ownership_denied (agent_task cwd=/workspace).
        if (!cwd || isQaapWorkspaceContainerPath(cwd)) {
            return;
        }
        await warmAgentRunner(cwd);
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { QaapProjectBootstrapService } from '@theia/qaap-mobile-shell/lib/browser/qaap-project-bootstrap-service';
import { ensureQaapCloudWorkspace } from './qaap-cloud-workspace-client';
import { QaapMobileEnvPanel } from './qaap-mobile-env-panel';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';

export const QAAP_CLOUD_OPEN_ENV_COMMAND_ID = 'qaap.cloud.openEnv';

export namespace QaapCloudCommands {
    export const OPEN_ENV: Command = {
        id: QAAP_CLOUD_OPEN_ENV_COMMAND_ID,
        category: 'Qaap',
        label: nls.localize('qaap/cloud/openEnv', 'Deploy environment variables'),
    };
}

@injectable()
export class QaapCloudBootstrapUiContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    protected envPanel: QaapMobileEnvPanel | undefined;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(QaapCloudCommands.OPEN_ENV, {
            execute: () => this.openEnvPanel(),
        });
    }

    onStart(): void {
        void this.ensureCloudWorkspace();
    }

    protected async ensureCloudWorkspace(): Promise<void> {
        const resource = this.workspace.workspace?.resource;
        if (!resource) {
            return;
        }
        const uri = resource.toString();
        // The hosted IDE opens the multi-repo CONTAINER (`/workspace`) as its workspace — that is
        // not an ownable repository, so ensuring it just lands in the backend security log as
        // ownership_denied (workspace_path ws:file:///workspace) on every reload.
        if (isQaapWorkspaceContainerPath(resource.path.toString())) {
            return;
        }
        await ensureQaapCloudWorkspace({ repoKey: `ws:${uri}`, workspaceUri: uri });
    }

    /** Called from bootstrap banner actions (injected by patching is not needed — expose for shell). */
    openEnvPanel(): void {
        if (!this.envPanel) {
            this.envPanel = new QaapMobileEnvPanel(this.workspace, document.body);
        }
        void this.envPanel.show();
    }
}

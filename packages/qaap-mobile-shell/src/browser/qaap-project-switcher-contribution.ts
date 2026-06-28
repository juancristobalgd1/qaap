// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { nls } from '@theia/core/lib/common/nls';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { QaapProjectSwitcherService } from './qaap-project-switcher-service';

export const QAAP_PROJECT_SWITCHER_COMMAND: Command = {
    id: 'qaap.projectSwitcher.open',
    label: nls.localize('qaap/projectSwitcher/commandLabel', 'Switch Project...')
};

const SCM_BRANCH_STATUS_BAR_ID = 'scm.status.0';

@injectable()
export class QaapProjectSwitcherContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(StatusBar)
    protected readonly statusBar: StatusBar;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(QaapProjectSwitcherService)
    protected readonly projectSwitcher: QaapProjectSwitcherService;

    onStart(): void {
        this.updateStatusBar();
        this.workspaceService.onWorkspaceChanged(() => this.updateStatusBar());
        this.workspaceService.onWorkspaceLocationChanged(() => this.updateStatusBar());
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(QAAP_PROJECT_SWITCHER_COMMAND, {
            execute: () => this.projectSwitcher.showProjectPicker()
        });
    }

    protected updateStatusBar(): void {
        const name = this.projectSwitcher.getCurrentProjectName();
        if (!name) {
            this.statusBar.removeElement(QAAP_PROJECT_SWITCHER_COMMAND.id);
            return;
        }
        this.statusBar.setElement(QAAP_PROJECT_SWITCHER_COMMAND.id, {
            text: `$(repo) ${name}`,
            tooltip: nls.localize('qaap/projectSwitcher/statusTooltip', 'Switch project'),
            command: QAAP_PROJECT_SWITCHER_COMMAND.id,
            alignment: StatusBarAlignment.LEFT,
            priority: 101,
            affinity: { id: SCM_BRANCH_STATUS_BAR_ID, alignment: StatusBarAlignment.LEFT, compact: true },
            className: 'qaap-status-project-switcher'
        });
    }
}

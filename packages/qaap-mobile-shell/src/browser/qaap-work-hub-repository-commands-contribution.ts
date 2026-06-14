// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, nls } from '@theia/core/lib/common';
import { QAAP_WORK_HUB_ADD_REPOSITORY_COMMAND } from '../common/qaap-work-hub-commands';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import { MobileProjectsService } from './mobile-projects-service';

@injectable()
export class QaapWorkHubRepositoryCommandsContribution implements CommandContribution {

    @inject(MobileProjectsService)
    protected readonly projectsService: MobileProjectsService;

    protected openRepoDialog: MobileOpenRepositoryDialog | undefined;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({
            id: QAAP_WORK_HUB_ADD_REPOSITORY_COMMAND,
            label: nls.localize('qaap/workHub/addRepository', 'Add repository'),
        }, {
            execute: () => this.showAddRepositoryDialog(),
        });
    }

    protected async showAddRepositoryDialog(): Promise<void> {
        if (!this.openRepoDialog) {
            this.openRepoDialog = new MobileOpenRepositoryDialog(this.projectsService);
            document.body.append(this.openRepoDialog.node);
        }
        await this.openRepoDialog.show();
    }
}

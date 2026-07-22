// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapJobLoopsWidget } from './qaap-job-loops-widget';

export const QAAP_OPEN_JOB_LOOPS: Command = {
    id: 'qaap.jobLoops.open',
    label: nls.localize('qaap/jobLoops/open', 'Job Loops'),
};

export const QAAP_CREATE_JOB_LOOP: Command = {
    id: 'qaap.jobLoops.create',
    label: nls.localize('qaap/jobLoops/createCommand', 'Create Job Loop'),
};

export const QAAP_MANAGE_JOB_LOOP_AUTOMATION: Command = {
    id: 'qaap.jobLoops.manageAutomation',
    label: nls.localize('qaap/jobLoops/manageAutomationCommand', 'Manage Job Loop Automation'),
};

@injectable()
export class QaapJobLoopsContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(QAAP_OPEN_JOB_LOOPS, { execute: () => this.open() });
        commands.registerCommand(QAAP_CREATE_JOB_LOOP, { execute: () => this.open('create') });
        commands.registerCommand(QAAP_MANAGE_JOB_LOOP_AUTOMATION, { execute: () => this.open('automation') });
    }

    protected async open(mode: 'runs' | 'create' | 'automation' = 'runs'): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(QaapJobLoopsWidget.ID) as QaapJobLoopsWidget;
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        if (mode === 'create') {
            await widget.openCreate();
        } else if (mode === 'automation') {
            await widget.openAutomation();
        }
    }
}

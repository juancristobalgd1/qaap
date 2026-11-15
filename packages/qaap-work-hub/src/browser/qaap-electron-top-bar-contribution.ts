// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { environment } from '@theia/core/lib/common';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplication } from '@theia/core/lib/browser';
import { WorkbenchTopBarFactory } from '@theia/core/lib/browser/menu/workbench-top-bar-factory';

/** Structural view of the Electron preload API; core types it globally, which this package does not compile against. */
interface ElectronTitleBarWindow {
    electronTheiaCore: { getTitleBarStyleAtStartup(): Promise<string> };
}

/** Class on the leading Qaap top-bar widget mounted in the native Electron title bar. */
export const QAAP_ELECTRON_TOP_BAR_CLASS = 'qaap-electron-top-bar';

/**
 * Electron with the native title bar (the default on macOS): core hides `#theia-top-panel` because
 * the OS draws the menu, so the Qaap top bar (surface switch, project nav, right controls) never
 * mounted. This shows the same Qaap widgets in the top panel, without the HTML menu bar, because the
 * native menu already provides it. The custom title bar (Windows/Linux) already appends them through
 * the core menu contribution, so this only acts when the style is `native`.
 */
@injectable()
export class QaapElectronTopBarContribution implements FrontendApplicationContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(WorkbenchTopBarFactory)
    protected readonly topBarFactory: WorkbenchTopBarFactory;

    protected mounted = false;

    onStart(_app: FrontendApplication): void {
        if (!environment.electron.is()) {
            return;
        }
        // Core's menu contribution hides the top panel synchronously in `onStart`; this callback runs
        // after it, so the Qaap top bar is shown last.
        (window as unknown as ElectronTitleBarWindow).electronTheiaCore.getTitleBarStyleAtStartup().then(style => {
            if (style === 'native') {
                this.mountNativeTopBar();
            }
        });
    }

    protected mountNativeTopBar(): void {
        if (this.mounted) {
            return;
        }
        this.mounted = true;
        const leading = this.topBarFactory.createLeadingTopBarWidget(this.commandRegistry, this.shell);
        leading.addClass(QAAP_ELECTRON_TOP_BAR_CLASS);
        this.shell.addWidget(leading, { area: 'top' });
        for (const widget of this.topBarFactory.createTrailingTopBarWidgets(this.commandRegistry, this.shell)) {
            this.shell.addWidget(widget, { area: 'top' });
        }
        this.shell.topPanel.show();
    }
}

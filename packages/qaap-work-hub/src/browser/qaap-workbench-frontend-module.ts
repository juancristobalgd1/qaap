// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/qaap-workbench-account-menu.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { WorkbenchTopBarFactory } from '@theia/core/lib/browser/menu/workbench-top-bar-factory';
import { QaapAuthCommandContribution } from './qaap-auth-command-contribution';
import { QaapWorkbenchTopBarFactory } from './qaap-workbench-top-bar-factory';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { QaapElectronTopBarContribution } from './qaap-electron-top-bar-contribution';

/**
 * Swaps {@link WorkbenchTopBarFactory} for the Qaap nav controls (same mount path as before). The browser
 * menu module binds the upstream factory, but the Electron menu module does not, so there is nothing to
 * rebind in the desktop app: bind the Qaap factory there instead of failing the frontend start.
 */
export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    bind(QaapAuthCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(QaapAuthCommandContribution);
    if (isBound(WorkbenchTopBarFactory)) {
        rebind(WorkbenchTopBarFactory).to(QaapWorkbenchTopBarFactory).inSingletonScope();
    } else {
        bind(WorkbenchTopBarFactory).to(QaapWorkbenchTopBarFactory).inSingletonScope();
    }
    // Electron native title bar: core hides the top panel, so the Qaap top bar is mounted here.
    bind(QaapElectronTopBarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapElectronTopBarContribution);
});

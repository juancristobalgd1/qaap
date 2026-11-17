// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { QaapWorkHubElectronMainMenuFactory } from './qaap-work-hub-electron-main-menu-factory';
import { QaapWorkHubNativeMenuContribution } from './qaap-work-hub-native-menu-contribution';

/**
 * Desktop (Electron renderer) bindings of the Qaap product: the native menu bar follows the active surface.
 * The Work Hub keeps a trimmed menu, the classic IDE the full upstream one. Not loaded by the web or mobile bundles.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainMenuFactory).to(QaapWorkHubElectronMainMenuFactory).inSingletonScope();
    bind(QaapWorkHubNativeMenuContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapWorkHubNativeMenuContribution);
});

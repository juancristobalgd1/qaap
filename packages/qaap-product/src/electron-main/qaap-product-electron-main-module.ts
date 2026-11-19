// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { app } from 'electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { QaapElectronMainApplication } from './qaap-electron-main-application';
import { QaapDesktopUpdater } from './qaap-desktop-updater';
import { applyQaapPackagedRuntimeEnvironment } from './qaap-packaged-runtime-environment';

// An installed build has no dev launcher to set the desktop runtime and the bundled plugins. This runs when the
// module loads, before the backend process is forked from this one, so the backend inherits the variables.
applyQaapPackagedRuntimeEnvironment({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, env: process.env });

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(QaapElectronMainApplication).inSingletonScope();
    bind(QaapDesktopUpdater).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(QaapDesktopUpdater);
});

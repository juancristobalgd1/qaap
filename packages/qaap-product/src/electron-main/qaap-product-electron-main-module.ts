// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { app } from 'electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import {
    QAAP_NATIVE_BROWSER_SERVICE_PATH,
    type QaapNativeBrowserClient,
} from '@theia/qaap-adapters/lib/common/qaap-native-browser-protocol';
import { QaapElectronMainApplication } from './qaap-electron-main-application';
import { QaapDesktopUpdater } from './qaap-desktop-updater';
import { QaapNativeBrowserMainService } from './qaap-native-browser-main-service';
import { applyQaapPackagedRuntimeEnvironment } from './qaap-packaged-runtime-environment';

// An installed build has no dev launcher to set the desktop runtime and the bundled plugins. This runs when the
// module loads, before the backend process is forked from this one, so the backend inherits the variables.
applyQaapPackagedRuntimeEnvironment({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, env: process.env });

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(QaapElectronMainApplication).inSingletonScope();
    bind(QaapDesktopUpdater).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(QaapDesktopUpdater);
    bind(QaapNativeBrowserMainService).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(QaapNativeBrowserMainService);
    bind(ElectronConnectionHandler).toDynamicValue(context =>
        new RpcConnectionHandler<QaapNativeBrowserClient>(QAAP_NATIVE_BROWSER_SERVICE_PATH, client => {
            const service = context.container.get(QaapNativeBrowserMainService);
            service.setClient(client);
            return service;
        })
    ).inSingletonScope();
});

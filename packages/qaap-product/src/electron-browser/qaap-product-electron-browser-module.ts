// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import {
    QAAP_NATIVE_BROWSER_SERVICE_PATH,
    QaapNativeBrowserService,
} from '@theia/qaap-adapters/lib/common/qaap-native-browser-protocol';
import { QaapWorkHubElectronMainMenuFactory } from './qaap-work-hub-electron-main-menu-factory';
import { QaapWorkHubNativeMenuContribution } from './qaap-work-hub-native-menu-contribution';
import {
    QaapNativeBrowserClientDispatcher,
    QaapNativeBrowserFrontendContribution,
} from './qaap-native-browser-frontend-contribution';

/**
 * Desktop (Electron renderer) bindings of the Qaap product: the native menu bar follows the active surface,
 * and embedded Browser tabs are backed by Electron native `WebContentsView` instances. Not loaded by web or mobile bundles.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainMenuFactory).to(QaapWorkHubElectronMainMenuFactory).inSingletonScope();
    bind(QaapWorkHubNativeMenuContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapWorkHubNativeMenuContribution);
    bind(QaapNativeBrowserClientDispatcher).toSelf().inSingletonScope();
    bind(QaapNativeBrowserService).toDynamicValue(context => {
        const dispatcher = context.container.get(QaapNativeBrowserClientDispatcher);
        return ElectronIpcConnectionProvider.createProxy<QaapNativeBrowserService>(
            context.container,
            QAAP_NATIVE_BROWSER_SERVICE_PATH,
            dispatcher,
        );
    }).inSingletonScope();
    bind(QaapNativeBrowserFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapNativeBrowserFrontendContribution);
});

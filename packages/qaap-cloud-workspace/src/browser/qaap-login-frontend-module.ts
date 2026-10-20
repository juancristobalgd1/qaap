// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/qaap-login.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { WebSocketConnectionSource } from '@theia/core/lib/browser/messaging/ws-connection-source';
import { QaapLoginContribution } from './qaap-login-contribution';
import { QaapWebSocketConnectionSource } from './qaap-websocket-connection-source';
import { QaapSplashUnblockContribution } from './qaap-splash-unblock-contribution';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // Stop the endless reconnect loop once a refused handshake turns out to be an expired session.
    bind(QaapWebSocketConnectionSource).toSelf().inSingletonScope();
    rebind(WebSocketConnectionSource).toService(QaapWebSocketConnectionSource);
    bind(QaapLoginContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapLoginContribution);
    bind(QaapSplashUnblockContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapSplashUnblockContribution);
});

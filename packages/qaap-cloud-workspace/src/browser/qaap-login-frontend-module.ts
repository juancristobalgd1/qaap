// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/qaap-login.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { QaapLoginContribution } from './qaap-login-contribution';
import { bindQaapSessionExpiryWatcher } from './qaap-session-expiry-watcher';
import { QaapSplashUnblockContribution } from './qaap-splash-unblock-contribution';

export default new ContainerModule((bind, _unbind, _isBound, _rebind, _unbindAsync, onActivation) => {
    // Stop the endless reconnect loop once a refused handshake turns out to be an expired session.
    // Decorates the bound source instead of rebinding it (a rebind opens a second socket in Electron).
    bindQaapSessionExpiryWatcher(bind, onActivation);
    bind(QaapLoginContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapLoginContribution);
    bind(QaapSplashUnblockContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapSplashUnblockContribution);
});

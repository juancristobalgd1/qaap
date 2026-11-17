// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronTokenValidator } from '@theia/core/lib/electron-node/token/electron-token-validator';
import { QaapToolGateElectronTokenValidator } from './qaap-tool-gate-electron-token-validator';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bind(QaapToolGateElectronTokenValidator).toSelf().inSingletonScope();
    rebind(ElectronTokenValidator).toService(QaapToolGateElectronTokenValidator);
});

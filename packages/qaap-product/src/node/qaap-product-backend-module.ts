// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution, BackendApplicationServer } from '@theia/core/lib/node';
import { LocalizationContribution } from '@theia/core/lib/node/i18n/localization-contribution';
import { QaapBackendStartupLogFilterContribution } from './qaap-backend-startup-log-filter';
import { QaapLocalizationContribution } from './qaap-localization-contribution';
import { QaapFrontendStaticServer } from './qaap-immutable-chunk-cache-contribution';
import { SocketWriteBuffer } from '@theia/core/lib/common/messaging/socket-write-buffer';
import { QaapSocketWriteBuffer } from './qaap-socket-write-buffer';

export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    bind(QaapLocalizationContribution).toSelf().inSingletonScope();
    bind(LocalizationContribution).toService(QaapLocalizationContribution);
    bind(QaapBackendStartupLogFilterContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapBackendStartupLogFilterContribution);
    // Owns frontend static serving (the generated server.js default yields when this is bound):
    // adds immutable caching for hashed esbuild chunks.
    bind(QaapFrontendStaticServer).toSelf().inSingletonScope();
    bind(BackendApplicationServer).toService(QaapFrontendStaticServer);

    if (isBound(SocketWriteBuffer)) {
        rebind(SocketWriteBuffer).to(QaapSocketWriteBuffer);
    } else {
        bind(SocketWriteBuffer).to(QaapSocketWriteBuffer);
    }
});

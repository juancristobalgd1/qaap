// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { LocalizationContribution } from '@theia/core/lib/node/i18n/localization-contribution';
import { QaapBackendStartupLogFilterContribution } from './qaap-backend-startup-log-filter';
import { QaapLocalizationContribution } from './qaap-localization-contribution';

export default new ContainerModule(bind => {
    bind(QaapLocalizationContribution).toSelf().inSingletonScope();
    bind(LocalizationContribution).toService(QaapLocalizationContribution);
    bind(QaapBackendStartupLogFilterContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(QaapBackendStartupLogFilterContribution);
});

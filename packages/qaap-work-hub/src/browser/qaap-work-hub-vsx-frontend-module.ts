// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { QaapVsxExtensionsMobileContribution } from '@theia/qaap-shared-core/lib/browser/qaap-vsx-extensions-mobile-contribution';

/**
 * Extensions marketplace (vsx-registry) behaviour. Desktop-only: the phone entry (bundle.mobile.js)
 * drops this module together with vsx-registry and plugin-ext.
 */
export default new ContainerModule(bind => {
    bind(QaapVsxExtensionsMobileContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapVsxExtensionsMobileContribution);
});

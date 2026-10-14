// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { TextReplacementContribution } from '@theia/core/lib/browser/preload/text-replacement-contribution';
import { Preloader } from '@theia/core/lib/browser/preload/preloader';
import { QaapMobileBootBudget } from '@theia/qaap-shared-core/lib/browser/qaap-mobile-boot-budget';
import { QaapPreloader } from '@theia/qaap-shared-core/lib/browser/qaap-preloader';
import { QaapTextReplacementContribution } from './qaap-text-replacement-contribution';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapTextReplacementContribution).toSelf().inSingletonScope();
    bind(TextReplacementContribution).toService(QaapTextReplacementContribution);

    // A phone booting into the Work Hub does not wait for the backend during preload (or, in the
    // mobile entry, during the contributions' startup hooks): see QaapMobileBootBudget.
    bind(QaapMobileBootBudget).toSelf().inSingletonScope();
    rebind(Preloader).to(QaapPreloader).inSingletonScope();
});

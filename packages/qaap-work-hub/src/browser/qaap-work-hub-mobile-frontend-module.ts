// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { QaapHeadlessTerminalService } from '@theia/qaap-shared-core/lib/browser/qaap-headless-terminal-service';
import { QaapFrontendApplication } from '@theia/qaap-shared-core/lib/browser/qaap-frontend-application';
import { QaapMobileBootBudget } from '@theia/qaap-shared-core/lib/browser/qaap-mobile-boot-budget';

/**
 * Mobile-only bindings: loaded only by the `bundle-mobile` entry (`qaapMobile.mobileOnly` of
 * `@theia/qaap-product`), never by desktop. They replace IDE services that mobile does not load.
 */
export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    // Startup hooks that wait on a waking backend no longer keep the Work Hub off screen.
    if (!isBound(QaapMobileBootBudget)) {
        // Normally bound by the qaap-product preload module.
        bind(QaapMobileBootBudget).toSelf().inSingletonScope();
    }
    rebind(FrontendApplication).to(QaapFrontendApplication).inSingletonScope();
    // The project bootstrap runs install/dev servers on the terminal backend without xterm.
    bind(QaapHeadlessTerminalService).toSelf().inSingletonScope();
});

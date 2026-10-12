// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { QaapHeadlessTerminalService } from '@theia/qaap-shared-core/lib/browser/qaap-headless-terminal-service';

/**
 * Mobile-only bindings: loaded only by the `bundle-mobile` entry (`qaapMobile.mobileOnly` of
 * `@theia/qaap-product`), never by desktop. They replace IDE services that mobile does not load.
 */
export default new ContainerModule(bind => {
    // The project bootstrap runs install/dev servers on the terminal backend without xterm.
    bind(QaapHeadlessTerminalService).toSelf().inSingletonScope();
});

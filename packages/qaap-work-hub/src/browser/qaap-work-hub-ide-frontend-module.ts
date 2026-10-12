// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { TerminalWatcher } from '@theia/terminal/lib/common/terminal-watcher';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { XtermLinkFactory } from '@theia/terminal/lib/browser/terminal-link-provider';
import { DebugFrontendContribution } from '@theia/memory-inspector/lib/browser/memory-inspector-frontend-contribution';
import { QaapIdeDesktopTerminalLayout, QaapIdeTerminalService, QaapIdeTerminalWatcher } from '@theia/qaap-shared-core/lib/browser/qaap-ide-bridge';
import { QaapTerminalFrontendContribution } from '@theia/qaap-shared-core/lib/browser/qaap-terminal-frontend-contribution';
import { createQaapXtermLinkFactory } from '@theia/qaap-shared-core/lib/browser/qaap-xterm-link-adapter';
import { QaapMemoryInspectorMobileContribution } from '@theia/qaap-shared-core/lib/browser/qaap-memory-inspector-mobile-contribution';
import { QaapVsxExtensionsMobileContribution } from '@theia/qaap-shared-core/lib/browser/qaap-vsx-extensions-mobile-contribution';
import { QaapDesktopTerminalLayoutContribution } from './qaap-desktop-terminal-layout-contribution';

/**
 * IDE-only half of the Work Hub composition root. Desktop loads it right after
 * `qaap-work-hub-frontend-module`; the `bundle-mobile` entry excludes it, so mobile never loads the
 * terminal, debug/memory inspector or VSX packages.
 *
 * The `QaapIde*` bridge symbols are aliases of the upstream services: mobile-safe classes inject them
 * with `@optional()` and get the very same instances on desktop.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapIdeTerminalService).toService(TerminalService);
    bind(QaapIdeTerminalWatcher).toService(TerminalWatcher);

    bind(QaapDesktopTerminalLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapDesktopTerminalLayoutContribution);
    bind(QaapIdeDesktopTerminalLayout).toService(QaapDesktopTerminalLayoutContribution);
    bind(QaapTerminalFrontendContribution).toSelf().inSingletonScope();
    rebind(TerminalFrontendContribution).toService(QaapTerminalFrontendContribution);
    // Terminal link taps must open reliably on touch devices (Qaap is mobile-first);
    // subclass XtermLinkAdapter via a replacement factory. Seam for packages/terminal.
    rebind(XtermLinkFactory).toFactory(createQaapXtermLinkFactory);

    bind(QaapMemoryInspectorMobileContribution).toSelf().inSingletonScope();
    rebind(DebugFrontendContribution).toService(QaapMemoryInspectorMobileContribution);
    bind(ShellLayoutTransformer).toService(QaapMemoryInspectorMobileContribution);

    bind(QaapVsxExtensionsMobileContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapVsxExtensionsMobileContribution);
});

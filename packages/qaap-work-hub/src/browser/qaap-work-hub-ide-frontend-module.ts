// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { DebugFrontendContribution } from '@theia/memory-inspector/lib/browser/memory-inspector-frontend-contribution';
import { QaapIdeDesktopTerminalLayout } from '@theia/qaap-shared-core/lib/browser/qaap-ide-bridge';
import { QaapMemoryInspectorMobileContribution } from '@theia/qaap-shared-core/lib/browser/qaap-memory-inspector-mobile-contribution';
import { QaapVsxExtensionsMobileContribution } from '@theia/qaap-shared-core/lib/browser/qaap-vsx-extensions-mobile-contribution';
import { QaapDesktopTerminalLayoutContribution } from './qaap-desktop-terminal-layout-contribution';

/**
 * IDE-only half of the Work Hub composition root. Desktop loads it right after
 * `qaap-work-hub-frontend-module`; the `bundle-mobile` entry excludes it, so mobile never loads the
 * desktop bottom-panel terminal layout, the debug/memory inspector or the VSX packages. The terminal
 * services the Work Hub terminal surface uses are bound by the mobile-safe module.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapDesktopTerminalLayoutContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapDesktopTerminalLayoutContribution);
    bind(QaapIdeDesktopTerminalLayout).toService(QaapDesktopTerminalLayoutContribution);

    bind(QaapMemoryInspectorMobileContribution).toSelf().inSingletonScope();
    rebind(DebugFrontendContribution).toService(QaapMemoryInspectorMobileContribution);
    bind(ShellLayoutTransformer).toService(QaapMemoryInspectorMobileContribution);

    bind(QaapVsxExtensionsMobileContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapVsxExtensionsMobileContribution);
});

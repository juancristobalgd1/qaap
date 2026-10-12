// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { TerminalThemeService } from '@theia/terminal/lib/browser/terminal-theme-service';
import { TERMINAL_WIDGET_FACTORY_ID } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { QaapTerminalThemeService } from './qaap-terminal-theme-service';
import { QaapLazyStylesheets } from './qaap-lazy-stylesheets';
import { QaapWidgetStylesheetContribution } from './qaap-lazy-widget-stylesheets';

/**
 * IDE-only half of the product theme (desktop loads it right after
 * `qaap-product-theme-frontend-module`; the `bundle-mobile` entry excludes it): the terminal theme
 * and the lazy stylesheets of the IDE-only widgets (VSX extensions, terminal, getting started).
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapTerminalThemeService).toSelf().inSingletonScope();
    rebind(TerminalThemeService).toService(QaapTerminalThemeService);

    bind<QaapWidgetStylesheetContribution>(QaapWidgetStylesheetContribution).toConstantValue({
        // VSXExtensionsViewContainer.ID, VSXExtensionsWidget.ID (@theia/vsx-registry is not a dependency).
        factoryIds: ['vsx-extensions-view-container', 'vsx-extensions'],
        loadStylesheets: () => QaapLazyStylesheets.loadModules(
            import('../../src/browser/style/qaap-vsx-registry.css?qaap-lazy'),
        ),
    });
    bind<QaapWidgetStylesheetContribution>(QaapWidgetStylesheetContribution).toConstantValue({
        // IDE terminals and the desktop Work Hub transcript terminal host both come from this factory.
        factoryIds: [TERMINAL_WIDGET_FACTORY_ID],
        loadStylesheets: () => QaapLazyStylesheets.loadModules(
            import('../../src/browser/style/qaap-terminal-mobile.css?qaap-lazy'),
        ),
    });
    bind<QaapWidgetStylesheetContribution>(QaapWidgetStylesheetContribution).toConstantValue({
        // GettingStartedWidget.ID, rebound to QaapGettingStartedWidget by @theia/qaap-product.
        factoryIds: ['getting.started.widget'],
        loadStylesheets: () => QaapLazyStylesheets.loadModules(
            import('../../src/browser/style/qaap-getting-started.css?qaap-lazy'),
        ),
    });
});

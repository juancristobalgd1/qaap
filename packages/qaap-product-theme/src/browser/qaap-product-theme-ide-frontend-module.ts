// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { QaapLazyStylesheets } from './qaap-lazy-stylesheets';
import { QaapWidgetStylesheetContribution } from './qaap-lazy-widget-stylesheets';

/**
 * IDE-only half of the product theme (desktop loads it right after
 * `qaap-product-theme-frontend-module`; the `bundle-mobile` entry excludes it): the lazy stylesheets
 * of the IDE-only widgets (VSX extensions, getting started).
 */
export default new ContainerModule(bind => {
    bind<QaapWidgetStylesheetContribution>(QaapWidgetStylesheetContribution).toConstantValue({
        // VSXExtensionsViewContainer.ID, VSXExtensionsWidget.ID (@theia/vsx-registry is not a dependency).
        factoryIds: ['vsx-extensions-view-container', 'vsx-extensions'],
        loadStylesheets: () => QaapLazyStylesheets.loadModules(
            import('../../src/browser/style/qaap-vsx-registry.css?qaap-lazy'),
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

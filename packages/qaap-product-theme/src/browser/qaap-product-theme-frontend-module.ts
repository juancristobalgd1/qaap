// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/workbench-cursor-typography.css';
import '../../src/browser/style/qaap-tokens.css';
import '../../src/browser/style/qaap-conservador-dna.css';
import '../../src/browser/style/qaap-workbench-top-bar.css';
import '../../src/browser/style/qaap-ai-chat-mobile.css';
import '../../src/browser/style/qaap-agent-input-codex.css';
import '../../src/browser/style/qaap-chat-scroll-edges.css';
import '../../src/browser/style/qaap-chat-scroll-to-bottom.css';
import '../../src/browser/style/qaap-menus-narrow-viewport.css';
import '../../src/browser/style/qaap-sidepanel.css';
import '../../src/browser/style/qaap-sidepanel-narrow-viewport.css';
import '../../src/browser/style/qaap-dialog-narrow-viewport.css';
import '../../src/browser/style/qaap-tabbar-narrow-viewport.css';
import '../../src/browser/style/qaap-mini-browser-toolbar-mobile.css';
import '../../src/browser/style/qaap-monaco-quick-input-narrow.css';
import '../../src/browser/style/qaap-select-component-narrow.css';
import '../../src/browser/style/qaap-select-component-overlay.css';
import '../../src/browser/style/qaap-chat-input-product.css';
import '../../src/browser/style/qaap-status-bar.css';
import '../../src/browser/style/qaap-workbench-chrome.css';
import '../../src/browser/style/qaap-file-dialog.css';
import '../../src/browser/style/qaap-notifications.css';

// Widget-specific sheets (VSX extensions, terminal, getting started) are not listed above:
// they are `?qaap-lazy` stylesheets attached before their widget is first created
// (QaapLazyWidgetStylesheets), so they no longer weigh on bundle.css / first paint.

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindRootContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { TerminalThemeService } from '@theia/terminal/lib/browser/terminal-theme-service';
import { TERMINAL_WIDGET_FACTORY_ID } from '@theia/terminal/lib/browser/terminal-widget-impl';
import { QaapWorkbenchColorContribution } from './qaap-workbench-color-contribution';
import { QaapThemeContribution } from './qaap-theme-contribution';
import { QaapTerminalThemeService } from './qaap-terminal-theme-service';
import { QaapChatScrollFadeContribution } from './qaap-chat-scroll-fade-contribution';
import { QaapLazyStylesheets } from './qaap-lazy-stylesheets';
import { QaapLazyWidgetStylesheets, QaapWidgetStylesheetContribution } from './qaap-lazy-widget-stylesheets';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(QaapWorkbenchColorContribution).toSelf().inSingletonScope();
    bind(ColorContribution).toService(QaapWorkbenchColorContribution);

    bind(QaapThemeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapThemeContribution);

    bind(QaapChatScrollFadeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapChatScrollFadeContribution);

    bind(QaapTerminalThemeService).toSelf().inSingletonScope();
    rebind(TerminalThemeService).toService(QaapTerminalThemeService);

    bindRootContributionProvider(bind, QaapWidgetStylesheetContribution);
    bind(QaapLazyWidgetStylesheets).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(QaapLazyWidgetStylesheets);
    bind<QaapWidgetStylesheetContribution>(QaapWidgetStylesheetContribution).toConstantValue({
        // VSXExtensionsViewContainer.ID, VSXExtensionsWidget.ID (@theia/vsx-registry is not a dependency).
        factoryIds: ['vsx-extensions-view-container', 'vsx-extensions'],
        loadStylesheets: () => QaapLazyStylesheets.loadModules(
            import('../../src/browser/style/qaap-vsx-registry.css?qaap-lazy'),
        ),
    });
    bind<QaapWidgetStylesheetContribution>(QaapWidgetStylesheetContribution).toConstantValue({
        // IDE terminals and the Work Hub transcript terminal host both come from this factory.
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

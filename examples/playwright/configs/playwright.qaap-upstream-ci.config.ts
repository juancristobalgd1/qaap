// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
// *****************************************************************************

import { PlaywrightTestConfig } from '@playwright/test';
import ciConfig from './playwright.ci.config';

/**
 * Qaap: upstream Theia Playwright suite as run by `.github/workflows/playwright.yml`.
 *
 * The suite runs against the Qaap product on the classic IDE surface
 * (`QAAP_PLAYWRIGHT_SURFACE=ide`, see `theia-app-loader.ts`). Qaap deliberately replaces
 * parts of the upstream workbench chrome that some upstream page objects depend on;
 * those specs are excluded below with the reason. Everything else runs unchanged.
 *
 * TODO(qaap): adapt the upstream page objects (menu via `#theia:workbench-menu-button`,
 * Qaap side-panel activity tabs) so the excluded specs can run again.
 */
const qaapUpstreamCiConfig: PlaywrightTestConfig = {
    ...ciConfig,
    testIgnore: [
        // The IDE hides the horizontal `#theia:menubar` (replaced by the top-bar "Open menu"
        // button); these specs, or their setup, drive the upstream menubar page object.
        '**/theia-main-menu.test.js',
        '**/theia-preference-view.test.js',
        '**/theia-terminal-view.test.js',
        '**/theia-text-editor.test.js',
        '**/theia-toolbar.test.js',
        '**/theia-sample-app.test.js',
        '**/theia-workspace.test.js',
        // Qaap's side panel renders its own activity tab strip; the upstream explorer page
        // object waits for the upstream `#shell-tab-explorer-view-container` tab.
        '**/theia-explorer-view.test.js',
        '**/theia-notebook-editor.test.js',
        // The upstream Welcome / getting-started page is not opened by the Qaap IDE.
        '**/theia-getting-started.test.js',
    ],
    grepInvert: [
        // Covered by `qaap-mobile-playwright.yml`, which provides their fixtures, mock agent,
        // env and longer timeouts. Without that setup each one burns up to 5 min x 3 attempts.
        /@qaap-mobile/,
        // Qaap opens the Explorer by default, so "Toggle Explorer" closes it.
        /should trigger 'Toggle Explorer View' command after typing/,
        // "Close All Tabs in Main Area" is only enabled with closable main-area tabs; upstream
        // relies on the Welcome page being open at startup, which Qaap does not open.
        /retrieve and check visible items/,
    ],
};

export default qaapUpstreamCiConfig;

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
 * (`QAAP_PLAYWRIGHT_SURFACE=ide`, see `theia-app-loader.ts`). Qaap deliberately replaces parts of
 * the upstream workbench chrome; instead of editing the upstream specs / page objects, the gaps are
 * bridged here and in Qaap-only adapters:
 *
 * - `#theia:menubar` is hidden in favour of the top-bar "Open menu" button: the loader swaps in
 *   `QaapMenuBar` (`src/qaap-menu-bar.ts`) on the IDE surface.
 * - Qaap defaults `workbench.startupEditor` to `none`: `qaap-upstream-ci-theia-start.js` seeds the
 *   upstream `welcomePage` default in the fresh user config dir.
 *
 * Only the tests below that are genuinely incompatible with a deliberate Qaap behaviour stay excluded.
 */
const qaapUpstreamCiConfig: PlaywrightTestConfig = {
    ...ciConfig,
    webServer: {
        // Playwright runs webServer commands from this config's directory.
        command: 'node ./qaap-upstream-ci-theia-start.js',
        port: 3000,
        reuseExistingServer: true
    },
    grepInvert: [
        // Covered by `qaap-mobile-playwright.yml`, which provides their fixtures, mock agent,
        // env and longer timeouts. Without that setup each one burns up to 5 min x 3 attempts.
        /@qaap-mobile/,
        // Qaap expands the Explorer on startup (`QaapFileNavigatorContribution`), so "Toggle Explorer"
        // collapses it instead of revealing it.
        /should trigger 'Toggle Explorer View' command after typing/,
        // Qaap expands the Explorer on startup, so the spec's unscoped `getByText('sample.txt')` matches
        // both the Explorer tree and the file dialog (Playwright strict-mode violation).
        /open sample\.txt via file menu/,
    ],
};

export default qaapUpstreamCiConfig;

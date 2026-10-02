// *****************************************************************************
// Copyright (C) 2021 logi.cals GmbH, EclipseSource and others.
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
import * as os from 'os';
import * as path from 'path';

const configuredPort = Number.parseInt(process.env.QAAP_PLAYWRIGHT_PORT ?? '', 10);
const playwrightPort = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const externalBaseURL = process.env.QAAP_PLAYWRIGHT_BASE_URL?.trim();
const browserDirectory = path.resolve(__dirname, '../../browser');
const isolatedTheiaConfig = path.join(os.tmpdir(), `qaap-playwright-${process.pid}-${playwrightPort}`);
const isolatedPreviewRegistry = path.join(isolatedTheiaConfig, 'dev-previews.json');

const config: PlaywrightTestConfig = {
    testDir: '../lib/tests',
    testMatch: ['**/*.js'],
    workers: 1,
    fullyParallel: false,
    // Timeout for each test in milliseconds.
    timeout: 60 * 1000,
    use: {
        baseURL: externalBaseURL || `http://localhost:${playwrightPort}`,
        browserName: 'chromium',
        permissions: ['clipboard-read'],
        screenshot: 'only-on-failure'
    },
    preserveOutput: 'failures-only',
    reporter: [
        ['list'],
        ['allure-playwright']
    ],
    // Run isolated browser tests on an optional port without terminating another local Theia app.
    webServer: externalBaseURL ? undefined : {
        command: `npm run start -- --port ${playwrightPort}`,
        cwd: browserDirectory,
        env: {
            ...process.env,
            QAAP_SKIP_AUTH: process.env.QAAP_SKIP_AUTH ?? '1',
            QAAP_CLOUD_MODE: process.env.QAAP_CLOUD_MODE ?? 'local',
            FRONTEND_CONNECTION_TIMEOUT: process.env.FRONTEND_CONNECTION_TIMEOUT ?? '2700000',
            QAAP_PREVIEW_REGISTRY_PATH: process.env.QAAP_PREVIEW_REGISTRY_PATH ?? isolatedPreviewRegistry,
            HOME: isolatedTheiaConfig,
            USERPROFILE: isolatedTheiaConfig,
            THEIA_CONFIG_DIR: isolatedTheiaConfig,
        },
        port: playwrightPort,
        reuseExistingServer: true,
    },
};

export default config;

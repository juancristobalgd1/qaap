// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { PlaywrightTestConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/** One browser E2E used by the required CI guard; the dedicated directory needs no grep filter. */
const requiredMobileConfig: PlaywrightTestConfig = {
    ...baseConfig,
    testDir: '../lib/tests/qaap-required-mobile',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    use: {
        ...baseConfig.use,
        viewport: { width: 375, height: 812 },
        permissions: [...new Set([...(baseConfig.use?.permissions ?? []), 'clipboard-write'])],
    },
    retries: process.env.CI ? 1 : 0,
};

export default requiredMobileConfig;

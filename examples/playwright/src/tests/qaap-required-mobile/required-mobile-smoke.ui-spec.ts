// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test } from '@playwright/test';
import { TheiaAppLoader } from '../../theia-app-loader';

test.describe('@qaap-mobile required shell smoke', () => {
    test('mobile viewport opens the Work Hub with a usable composer', async ({ playwright, browser }) => {
        const app = await TheiaAppLoader.load({ playwright, browser });
        try {
            const skipTutorial = app.page.locator('button').filter({ hasText: /^skip$/i }).first();
            if (await skipTutorial.count()) {
                await skipTutorial.click();
            }

            await expect(app.page.locator('#theia-app-shell')).toHaveClass(/theia-mod-mobile-one-column/);
            const workHub = app.page.locator('.theia-mobile-projects:visible');
            await expect(workHub).toHaveClass(/theia-mod-agents-hub/);
            await expect(workHub.locator('.theia-mobile-projects-sticky-composer-input').first()).toBeVisible();
            await expect(app.page.locator('#theia-mobile-bottom-bar')).toBeHidden();
        } finally {
            await app.page.close();
        }
    });
});

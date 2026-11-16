// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test, type Page } from '@playwright/test';
import * as path from 'path';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';

const DESKTOP_WORK_HUB_VIEWPORT = { width: 1200, height: 953 };
const SAMPLE_FILES = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'sample-files1');

/** The inline transcript scroller: the element that actually scrolls the messages. */
const INLINE_TRANSCRIPT_SCROLLER = '.theia-mobile-agents-hub-inline-transcript .theia-mobile-agent-transcript-real-chat>.theia-mobile-agent-transcript';

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

test.describe('@qaap-mobile transcript scroller column edge', () => {

    test.use({ viewport: DESKTOP_WORK_HUB_VIEWPORT });

    test('scroller meets the column edge and the reading column stays centred', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        const page = app.page;
        await dismissMobileTutorial(page);
        await expect(page.locator('.theia-mobile-projects-sticky-composer-input').first()).toBeVisible({ timeout: 60_000 });

        const scroller = page.locator(INLINE_TRANSCRIPT_SCROLLER).first();
        const scrollerCount = await page.locator(INLINE_TRANSCRIPT_SCROLLER).count();
        test.skip(scrollerCount === 0, 'No inline transcript is open in the landing state; open a thread to exercise the column edge.');

        const scrollerBox = await scroller.boundingBox();
        const columnBox = await scroller.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " theia-mobile-projects-scroll ")][1]').boundingBox();
        expect(scrollerBox).not.toBeNull();
        expect(columnBox).not.toBeNull();
        // The scrollbar sits on the scroller's right border edge: it must meet the column's right edge (±2px).
        expect(Math.abs((scrollerBox!.x + scrollerBox!.width) - (columnBox!.x + columnBox!.width))).toBeLessThanOrEqual(2);

        // Reading column: a direct message row is capped and centred inside the scroller.
        const row = scroller.locator(':scope > *').first();
        if (await row.count()) {
            const rowBox = await row.boundingBox();
            expect(rowBox).not.toBeNull();
            const rowCentre = rowBox!.x + rowBox!.width / 2;
            const scrollerCentre = scrollerBox!.x + scrollerBox!.width / 2;
            expect(rowBox!.width).toBeLessThanOrEqual(760);
            if (rowBox!.width < scrollerBox!.width - 4) {
                expect(Math.abs(rowCentre - scrollerCentre)).toBeLessThanOrEqual(2);
            }
        }

        await page.close();
    });
});

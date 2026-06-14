// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test, type Page } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';
import * as path from 'path';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const SAMPLE_FILES = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'sample-files1');
const QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY = 'qaapWorkHubPerfProbe';

interface WorkHubPerfProbeMetrics {
    hubScrollReplaceChildren: number;
    sidebarListReplaceChildren: number;
    chatHostConnected: boolean;
    inlineExecutionConnected: boolean;
}

interface WorkHubPerfProbeApi {
    burstConversationTicks(count: number): void;
    setTranscriptOverlayOpenForProbe(open: boolean): void;
    openSessionsSidebarForProbe(): void;
    resetMetrics(): WorkHubPerfProbeMetrics;
    getMetrics(): WorkHubPerfProbeMetrics;
}

declare global {
    interface Window {
        __qaapWorkHubPerfProbe?: WorkHubPerfProbeApi;
    }
}

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

async function waitForWorkHubPerfProbe(page: Page): Promise<void> {
    await expect.poll(async () => page.evaluate(
        key => typeof window.__qaapWorkHubPerfProbe !== 'undefined'
            && window.sessionStorage.getItem(key) === '1',
        QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY,
    ), { timeout: 60_000 }).toBe(true);
}

async function flushAnimationFrames(page: Page, frames = 2): Promise<void> {
    await page.evaluate(async (count: number) => {
        for (let i = 0; i < count; i++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    }, frames);
}

async function burstConversationTicks(page: Page, count: number): Promise<void> {
    await page.evaluate((tickCount: number) => {
        window.__qaapWorkHubPerfProbe?.burstConversationTicks(tickCount);
    }, count);
}

async function enableWorkHubPerfProbe(page: Page): Promise<void> {
    await page.evaluate((key: string) => {
        window.sessionStorage.setItem(key, '1');
    }, QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
}

test.describe('@qaap-mobile Work Hub streaming perf', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('coalesces bursty live hub list rebuilds on the tasks hub', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);

        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.resetMetrics());
        await burstConversationTicks(app.page, 50);
        await flushAnimationFrames(app.page, 2);

        const metrics = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getMetrics());
        expect(metrics?.hubScrollReplaceChildren ?? 99).toBeLessThanOrEqual(2);

        await app.page.close();
    });

    test('skips hub list rebuild while transcript overlay is open during live ticks', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.setTranscriptOverlayOpenForProbe(true);
            window.__qaapWorkHubPerfProbe?.resetMetrics();
        });
        await burstConversationTicks(app.page, 50);
        await flushAnimationFrames(app.page, 2);

        const metrics = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getMetrics());
        expect(metrics?.hubScrollReplaceChildren ?? 99).toBeLessThanOrEqual(2);
        expect(metrics?.chatHostConnected).toBe(true);

        await app.page.close();
    });

    test('coalesces sessions sidebar refresh during unchanged live ticks', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.openSessionsSidebarForProbe();
        });
        await expect(app.page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible')).toBeVisible({ timeout: 15_000 });
        await flushAnimationFrames(app.page, 2);

        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.resetMetrics());
        await burstConversationTicks(app.page, 50);
        await flushAnimationFrames(app.page, 2);

        const metrics = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getMetrics());
        expect(metrics?.sidebarListReplaceChildren ?? 99).toBeLessThanOrEqual(1);

        await app.page.close();
    });
});

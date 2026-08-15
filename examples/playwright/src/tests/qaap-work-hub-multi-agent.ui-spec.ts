// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test, type Page } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../qaap-work-hub-perf-probe-support';
import * as path from 'path';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const SAMPLE_FILES = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'sample-files1');

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

async function enableWorkHubPerfProbe(page: Page): Promise<void> {
    await page.evaluate((key: string) => {
        window.sessionStorage.setItem(key, '1');
    }, QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
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

test.describe('@qaap-mobile Work Hub multi-agent', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('patches expanded mission control rows across three streaming agents', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);

        await expect.poll(async () => app.page.evaluate(
            () => window.__qaapWorkHubPerfProbe?.hasWorkspaceForProbe() === true,
        ), { timeout: 60_000 }).toBe(true);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.navigateToHomeHubForProbe();
            window.__qaapWorkHubPerfProbe?.seedMultiAgentProbeConversations();
        });
        await flushAnimationFrames(app.page, 3);

        await expect.poll(async () => app.page.evaluate(
            () => window.__qaapWorkHubPerfProbe?.getProbeDiagnostics()?.mcRowCount ?? 0,
        ), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);

        await expect(app.page.locator('.theia-mobile-mission-control-host .theia-mobile-mission-control-row')).toHaveCount(3);

        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.resetMetrics());
        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.tickProbeStreamingConversations());
        await flushAnimationFrames(app.page, 3);

        const metrics = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getMetrics());
        expect(metrics?.hubScrollReplaceChildren ?? 99).toBeLessThanOrEqual(1);
        await expect.poll(async () => app.page.locator('.theia-mobile-mission-control-progress').first().textContent(), {
            timeout: 15_000,
        }).toContain('3/5');

        await app.page.close();
    });

    test('patches team rows for multiple streaming agents on the tasks inbox', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);

        await expect.poll(async () => app.page.evaluate(
            () => window.__qaapWorkHubPerfProbe?.hasWorkspaceForProbe() === true,
        ), { timeout: 60_000 }).toBe(true);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.showTasksInboxWithTeamForProbe();
            window.__qaapWorkHubPerfProbe?.seedMultiAgentProbeConversations();
        });
        await flushAnimationFrames(app.page, 3);

        await expect.poll(async () => app.page.evaluate(
            () => window.__qaapWorkHubPerfProbe?.getProbeDiagnostics()?.teamRowCount ?? 0,
        ), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);

        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.resetMetrics());
        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.tickProbeStreamingConversations());
        await flushAnimationFrames(app.page, 3);

        const metrics = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getMetrics());
        expect(metrics?.hubScrollReplaceChildren ?? 99).toBeLessThanOrEqual(1);
        await expect.poll(async () => app.page.locator('.theia-mobile-hub-team-since').first().textContent(), {
            timeout: 15_000,
        }).toContain('3/5');

        await app.page.close();
    });
});

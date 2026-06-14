// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test, type Page } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';
import { QAAP_PROBE_CONVERSATION_IDS } from '../qaap-work-hub-perf-probe-support';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../qaap-work-hub-perf-probe-support';
import * as path from 'path';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const SAMPLE_FILES = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'sample-files1');

const SIDEBAR_TO_CHAT_BUDGET_MS = 800;
const STREAMING_MEDIAN_FPS_MIN = 30;
const THREE_AGENT_HEAP_BUDGET_MB = 900;

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

async function enableWorkHubPerfProbe(page: Page): Promise<void> {
    await page.evaluate((key: string) => {
        window.sessionStorage.setItem(key, '1');
        window.localStorage.setItem('qaap.streamMetrics', '1');
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

async function prepareMultiAgentProbe(page: Page): Promise<void> {
    await expect.poll(async () => page.evaluate(
        () => window.__qaapWorkHubPerfProbe?.hasWorkspaceForProbe() === true,
    ), { timeout: 60_000 }).toBe(true);
    await page.evaluate(() => {
        window.__qaapWorkHubPerfProbe?.navigateToHomeHubForProbe();
        window.__qaapWorkHubPerfProbe?.seedMultiAgentProbeConversations();
    });
    await page.evaluate(async () => {
        for (let index = 0; index < 3; index++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    });
}

test.describe('@qaap-mobile Work Hub navigation perf', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('opens a sidebar conversation into inline chat within budget', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);
        await prepareMultiAgentProbe(app.page);

        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.openSessionsSidebarForProbe());
        await expect(app.page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible')).toBeVisible({ timeout: 15_000 });

        const navigation = await app.page.evaluate(async (conversationId: string) =>
            window.__qaapWorkHubPerfProbe?.measureOpenConversation(conversationId),
        QAAP_PROBE_CONVERSATION_IDS.agentA);

        expect(navigation?.historyVisible).toBe(true);
        expect(navigation?.inlineExecutionConnected).toBe(true);
        expect(navigation?.hubScrollReplaceChildren ?? 99).toBeLessThanOrEqual(1);
        expect(navigation?.durationMs ?? 99_999).toBeLessThanOrEqual(SIDEBAR_TO_CHAT_BUDGET_MS);

        await app.page.close();
    });

    test('samples streaming fps and memory with three probe agents', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);
        await prepareMultiAgentProbe(app.page);

        await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.openSessionsSidebarForProbe());
        await app.page.evaluate(async (conversationId: string) =>
            window.__qaapWorkHubPerfProbe?.measureOpenConversation(conversationId),
        QAAP_PROBE_CONVERSATION_IDS.agentA);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.tickProbeStreamingConversations();
        });

        const memoryBefore = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getMemorySnapshot());

        const streamingSample = await app.page.evaluate(async (conversationId: string) =>
            window.__qaapWorkHubPerfProbe?.sampleStreamingPerf({
                durationMs: 1500,
                burstCount: 10,
                conversationId,
            }),
        QAAP_PROBE_CONVERSATION_IDS.agentA);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.tickProbeStreamingConversations();
        });

        const runtime = await app.page.evaluate(() => window.__qaapWorkHubPerfProbe?.getRuntimeSnapshot());

        expect(streamingSample?.fps.medianFps ?? 0).toBeGreaterThanOrEqual(STREAMING_MEDIAN_FPS_MIN);
        expect(streamingSample?.fps.frameCount ?? 0).toBeGreaterThan(0);

        const heapMb = runtime?.memory?.jsHeapUsedMb
            ?? memoryBefore?.jsHeapUsedMb
            ?? 0;
        if (heapMb > 0) {
            expect(heapMb).toBeLessThanOrEqual(THREE_AGENT_HEAP_BUDGET_MB);
        }

        await app.page.close();
    });
});

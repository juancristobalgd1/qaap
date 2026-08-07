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

interface TranscriptPerfSample {
    readonly durationMs: number;
    readonly frameCount: number;
    readonly droppedFrameCount: number;
    readonly maxFrameGapMs: number;
    readonly longTaskCount: number;
    readonly longTaskDurationMs: number;
    readonly longTaskEntries: readonly { readonly startTime: number; readonly duration: number }[];
    readonly maxTickCallMs: number;
    readonly p95TickCallMs: number;
    readonly slowTickCount: number;
    readonly renderedRowCount: number;
    readonly virtualized: boolean;
    readonly initialTranscriptRenderMetrics?: Record<string, number | boolean>;
    readonly transcriptRenderMetrics: Record<string, number | boolean>;
    readonly usedJsHeapSize?: number;
}

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

async function flushAnimationFrames(page: Page, frames = 3): Promise<void> {
    await page.evaluate(async (count: number) => {
        for (let i = 0; i < count; i++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    }, frames);
}

async function measureTranscriptStreaming(page: Page, ticks: number, intervalMs: number): Promise<TranscriptPerfSample> {
    return page.evaluate(async ({ ticks: tickCount, interval }: { ticks: number; interval: number }) => {
        const api = window.__qaapWorkHubPerfProbe;
        api?.resetMetrics();

        const frameGaps: number[] = [];
        let lastFrameAt = performance.now();
        let frameHandle = 0;
        let running = true;
        const sampleFrame = (now: number): void => {
            if (!running) {
                return;
            }
            frameGaps.push(now - lastFrameAt);
            lastFrameAt = now;
            frameHandle = requestAnimationFrame(sampleFrame);
        };

        let longTaskCount = 0;
        let longTaskDurationMs = 0;
        const longTaskEntries: { startTime: number; duration: number }[] = [];
        const longTaskObserver = typeof PerformanceObserver !== 'undefined'
            && PerformanceObserver.supportedEntryTypes.includes('longtask')
            ? new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    longTaskCount++;
                    longTaskDurationMs += entry.duration;
                    longTaskEntries.push({ startTime: entry.startTime, duration: entry.duration });
                }
            })
            : undefined;
        longTaskObserver?.observe({ type: 'longtask', buffered: false });
        frameHandle = requestAnimationFrame(sampleFrame);

        const startedAt = performance.now();
        const tickDurations: number[] = [];
        for (let tick = 0; tick < tickCount; tick++) {
            const tickStartedAt = performance.now();
            api?.tickLongTranscriptForProbe({ charsPerTick: 180 });
            tickDurations.push(performance.now() - tickStartedAt);
            await new Promise<void>(resolve => window.setTimeout(resolve, interval));
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const durationMs = performance.now() - startedAt;

        running = false;
        cancelAnimationFrame(frameHandle);
        longTaskObserver?.disconnect();

        const metrics = api?.getMetrics();
        const memory = (performance as Performance & {
            memory?: { readonly usedJSHeapSize?: number };
        }).memory;
        const sortedTickDurations = [...tickDurations].sort((left, right) => left - right);
        const p95TickIndex = Math.min(sortedTickDurations.length - 1, Math.floor(sortedTickDurations.length * 0.95));
        return {
            durationMs,
            frameCount: frameGaps.length,
            droppedFrameCount: frameGaps.filter(gap => gap > 50).length,
            maxFrameGapMs: frameGaps.length > 0 ? Math.max(...frameGaps) : 0,
            longTaskCount,
            longTaskDurationMs,
            longTaskEntries,
            maxTickCallMs: tickDurations.length > 0 ? Math.max(...tickDurations) : 0,
            p95TickCallMs: sortedTickDurations.length > 0 ? sortedTickDurations[p95TickIndex] : 0,
            slowTickCount: tickDurations.filter(duration => duration > 16.7).length,
            renderedRowCount: document.querySelectorAll('[data-transcript-message-id]').length,
            virtualized: document.querySelector('.theia-mobile-agent-transcript.theia-mod-virtual-scroll') !== null,
            transcriptRenderMetrics: metrics?.transcriptRenderMetrics ?? {},
            usedJsHeapSize: memory?.usedJSHeapSize,
        };
    }, { ticks, interval: intervalMs });
}

test.describe('@qaap-mobile Transcript long-streaming performance', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('measures a virtualized long transcript under intense streaming', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await enableWorkHubPerfProbe(app.page);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expect(app.page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
        await waitForWorkHubPerfProbe(app.page);

        await app.page.evaluate(() => {
            window.__qaapWorkHubPerfProbe?.renderLongTranscriptForProbe({
                messageCount: 160,
                charsPerMessage: 1000,
            });
        });
        await expect(app.page.locator('[data-qaap-perf-probe="1"] > .theia-mobile-agent-transcript')).toHaveCount(1, { timeout: 15_000 });
        await flushAnimationFrames(app.page, 5);

        const initialTranscriptRenderMetrics = await app.page.evaluate(() =>
            window.__qaapWorkHubPerfProbe?.getMetrics().transcriptRenderMetrics ?? {},
        );
        const sample = await measureTranscriptStreaming(app.page, 160, 8);
        const report = { ...sample, initialTranscriptRenderMetrics };
        console.log(`[qaap-perf] transcript long-streaming ${JSON.stringify(report)}`);
        await test.info().attach('qaap-transcript-long-streaming-perf.json', {
            body: JSON.stringify(report, undefined, 2),
            contentType: 'application/json',
        });

        expect(sample.virtualized).toBe(true);
        expect(sample.renderedRowCount).toBeGreaterThan(0);
        expect(sample.transcriptRenderMetrics.render_patch_last_agent ?? 0).toBeGreaterThan(0);
        expect(initialTranscriptRenderMetrics.render_full ?? 0).toBeGreaterThan(0);

        await app.page.close();
    });
});

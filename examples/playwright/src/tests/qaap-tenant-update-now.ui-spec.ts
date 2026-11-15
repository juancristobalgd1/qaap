// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type PlaywrightWorkerArgs, type TestInfo } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';

/** The sidebar chip of a pending Qaap build: `button` with aria-label "Update Qaap now" and text "Update now". */
const CHIP_NAME = 'Update Qaap now';
/**
 * The chip's name changes while it updates ("Updating Qaap"), so state checks use the class; the accessible
 * name is only used to find it before the click.
 */
const CHIP_SELECTOR = '.theia-mobile-work-hub-sessions-sidebar-update';
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1200, height: 953 };
/** The only fixed wait of this spec: the simulated latency of the apply request. */
const APPLY_DELAY_MS = 1_000;
const RECONFIRM_TURNS_TEXT = 'This will stop 2 running agent turn(s). Update anyway?';
/**
 * Screenshots kept outside `test-results/` (Playwright empties that folder at start and the CI archives it
 * only on failure). `qaap-mobile-playwright.yml` uploads this folder on every run.
 */
const SCREENSHOT_DIR = path.resolve(__dirname, '../../update-now-screenshots');

interface UpdateScenario {
    /** `updatePending` in the runtime status the real control plane answers (the test overrides it). */
    readonly pending: boolean;
    readonly runningTasks: number;
}

/**
 * Overrides the runtime status with the scenario, merged into the real answer, and simulates the apply:
 * after `POST /qaap/api/tenant-update` the status reports nothing pending, as the recreated backend would.
 */
async function stubBackendUpdate(page: Page, scenario: UpdateScenario): Promise<{ posts: () => number }> {
    const state = { applied: false, posts: 0 };
    await page.route('**/qaap/api/cloud/runtime/status', async route => {
        const real = await route.fetch();
        const body = await real.json().catch(() => ({})) as Record<string, unknown>;
        const pending = scenario.pending && !state.applied;
        const realUpdate = typeof body.update === 'object' && body.update !== null ? body.update : {};
        const update = pending
            ? {
                ...realUpdate,
                backendBuild: 'old5678',
                controlPlaneBuild: 'abc1234',
                updatePending: true,
                runningTasks: scenario.runningTasks,
                ...(scenario.runningTasks > 0 ? { reason: 'agent-turns-running' } : {}),
            }
            : { ...realUpdate, updatePending: false, runningTasks: 0 };
        await route.fulfill({ status: 200, contentType: 'application/json', json: { ...body, update } });
    });
    await page.route('**/qaap/api/tenant-update', async route => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        state.posts += 1;
        await new Promise<void>(resolve => setTimeout(resolve, APPLY_DELAY_MS));
        state.applied = true;
        await route.fulfill({ status: 200, contentType: 'application/json', json: { applied: true } });
    });
    return { posts: () => state.posts };
}

/** A fresh context with its own viewport (the loader's page does not inherit `test.use` options), routes set before the first load. */
async function openWorkHub(
    args: PlaywrightWorkerArgs,
    options: { prefix?: string; viewport: { width: number; height: number }; touch: boolean },
    scenario: UpdateScenario,
): Promise<{ page: Page; context: BrowserContext; posts: () => number }> {
    const context = await args.browser.newContext({
        viewport: options.viewport,
        ...(options.touch ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    const stub = await stubBackendUpdate(page, scenario);
    // TheiaAppLoader opens the page it is given; the adapter only supplies that page.
    await TheiaAppLoader.load({ playwright: args.playwright, browser: { newPage: async () => page } as unknown as Browser });
    return { page, context, posts: stub.posts };
}

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

async function waitForWorkHubReady(page: Page): Promise<void> {
    await expect(page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-input').first())
        .toBeVisible({ timeout: 60_000 });
}

/** Opens the sessions sidebar the way the Work Hub user does (same control as qaap-mobile.test.ts). */
async function openSessionsSidebar(page: Page): Promise<void> {
    const sidebar = page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible').first();
    if (await sidebar.isVisible().catch(() => false)) {
        return;
    }
    await page.locator('button[aria-label="Open session history"]:visible').first().click();
    await expect(page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible')).toBeVisible();
}

interface ChipMetrics {
    readonly width: number;
    readonly height: number;
    readonly inViewport: boolean;
    /** `elementFromPoint` at the chip's centre is the chip itself or one of its descendants. */
    readonly hitsChip: boolean;
    readonly hitTag: string | null;
    readonly coarsePointer: boolean;
    readonly disabled: boolean;
}

async function measureChip(chip: Locator): Promise<ChipMetrics> {
    return chip.evaluate((element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
            hitsChip: top !== null && (top === element || element.contains(top)),
            hitTag: top ? top.tagName.toLowerCase() : null,
            coarsePointer: window.matchMedia('(pointer: coarse)').matches,
            disabled: (element as HTMLButtonElement).disabled,
        };
    });
}

function screenshotPath(prefix: string, name: string): string {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    return path.join(SCREENSHOT_DIR, `${prefix}-${name}.png`);
}

/** Saves a PNG into the CI folder and attaches it to the Playwright report. */
async function capture(testInfo: TestInfo, page: Page, prefix: string, name: string, target?: Locator): Promise<void> {
    const file = screenshotPath(prefix, name);
    if (target) {
        await target.screenshot({ path: file });
    } else {
        await page.screenshot({ path: file });
    }
    await testInfo.attach(`${prefix}-${name}`, { path: file, contentType: 'image/png' });
}

/** Full flow for one viewport: rest state, keyboard, confirmation (when turns run), "Updating…", reload. */
async function runUpdateFlow(
    args: PlaywrightWorkerArgs,
    testInfo: TestInfo,
    options: { prefix: string; viewport: { width: number; height: number }; touch: boolean },
    scenario: UpdateScenario,
): Promise<void> {
    const { page, context, posts } = await openWorkHub(args, options, scenario);
    try {
        await dismissMobileTutorial(page);
        await waitForWorkHubReady(page);
        await openSessionsSidebar(page);

        await expect(page.getByRole('button', { name: CHIP_NAME })).toBeVisible({ timeout: 30_000 });
        const chip = page.locator(CHIP_SELECTOR);
        await expect(chip).toBeVisible({ timeout: 30_000 });
        await expect(chip).toHaveText('Update now');
        await expect(chip).toBeEnabled();

        const metrics = await measureChip(chip);
        testInfo.annotations.push({ type: 'update-now-chip', description: JSON.stringify({ viewport: options.viewport, ...metrics }) });
        // Kept in the CI step log (the report is only archived on failure).
        console.log(`[update-now-chip] ${options.prefix} ${JSON.stringify({ viewport: options.viewport, ...metrics })}`);
        expect(metrics.inViewport, 'chip inside the viewport').toBe(true);
        expect(metrics.hitsChip, `the element at the chip centre is the chip (got <${metrics.hitTag}>)`).toBe(true);
        if (options.touch) {
            expect(metrics.coarsePointer, 'touch emulation reports a coarse pointer').toBe(true);
            expect(metrics.height, 'touch target height').toBeGreaterThanOrEqual(44);
            expect(metrics.width, 'touch target width').toBeGreaterThanOrEqual(44);
        }

        const footer = page.locator('.theia-mobile-work-hub-sessions-sidebar-foot');
        await capture(testInfo, page, options.prefix, 'rest-viewport');
        await capture(testInfo, page, options.prefix, 'rest-footer', footer);

        // Keyboard: focus the chip and activate it with Enter.
        await chip.focus();
        await expect(chip).toBeFocused();
        await page.keyboard.press('Enter');

        if (scenario.runningTasks > 0) {
            await expect(page.getByText(RECONFIRM_TURNS_TEXT)).toBeVisible();
            await capture(testInfo, page, options.prefix, 'confirm-dialog');
            await page.getByRole('button', { name: 'Update anyway' }).click();
        } else {
            await expect(page.getByText(RECONFIRM_TURNS_TEXT)).toHaveCount(0);
        }

        // The reload is the end of the flow: wait for the next document load, set up before the request.
        const reloaded = page.waitForEvent('load', { timeout: 60_000 });
        await expect(chip).toHaveText('Updating…');
        await expect(chip).toBeDisabled();
        await capture(testInfo, page, options.prefix, 'updating-footer', footer);
        await reloaded;
        expect(posts(), 'one apply request').toBe(1);
    } finally {
        await context.close();
    }
}

test.describe('@qaap-mobile Work Hub update chip (mobile)', () => {

    test('a pending build shows "Update now", confirms over two running turns, then reloads', async ({ playwright, browser }, testInfo) => {
        await runUpdateFlow({ playwright, browser }, testInfo, { prefix: 'mobile-2-turns', viewport: MOBILE_VIEWPORT, touch: true }, { pending: true, runningTasks: 2 });
    });

    test('with no running turns the update starts at once, without a confirmation', async ({ playwright, browser }, testInfo) => {
        const { page, context, posts } = await openWorkHub(
            { playwright, browser },
            { prefix: 'mobile-0-turns', viewport: MOBILE_VIEWPORT, touch: true },
            { pending: true, runningTasks: 0 },
        );
        try {
            await dismissMobileTutorial(page);
            await waitForWorkHubReady(page);
            await openSessionsSidebar(page);
            await expect(page.getByRole('button', { name: CHIP_NAME })).toBeVisible({ timeout: 30_000 });
            const chip = page.locator(CHIP_SELECTOR);
            await expect(chip).toBeVisible({ timeout: 30_000 });
            const reloaded = page.waitForEvent('load', { timeout: 60_000 });
            await chip.click();
            await expect(chip).toHaveText('Updating…');
            await expect(page.getByText(RECONFIRM_TURNS_TEXT)).toHaveCount(0);
            await capture(testInfo, page, 'mobile-0-turns', 'updating-footer', page.locator('.theia-mobile-work-hub-sessions-sidebar-foot'));
            await reloaded;
            expect(posts()).toBe(1);
        } finally {
            await context.close();
        }
    });

    test('with nothing pending there is no "Update now" button', async ({ playwright, browser }, testInfo) => {
        const { page, context } = await openWorkHub(
            { playwright, browser },
            { prefix: 'mobile-none', viewport: MOBILE_VIEWPORT, touch: true },
            { pending: false, runningTasks: 0 },
        );
        try {
            await dismissMobileTutorial(page);
            await waitForWorkHubReady(page);
            await openSessionsSidebar(page);
            await expect(page.locator('.theia-mobile-work-hub-sessions-sidebar-foot .theia-workbench-account-btn')).toBeVisible();
            await expect(page.getByRole('button', { name: CHIP_NAME })).toHaveCount(0);
            await capture(testInfo, page, 'mobile-none', 'footer-without-chip', page.locator('.theia-mobile-work-hub-sessions-sidebar-foot'));
        } finally {
            await context.close();
        }
    });
});

test.describe('@qaap-mobile Work Hub update chip (desktop)', () => {

    test('the same flow works at desktop width, with a pointer', async ({ playwright, browser }, testInfo) => {
        await runUpdateFlow({ playwright, browser }, testInfo, { prefix: 'desktop-2-turns', viewport: DESKTOP_VIEWPORT, touch: false }, { pending: true, runningTasks: 2 });
    });
});

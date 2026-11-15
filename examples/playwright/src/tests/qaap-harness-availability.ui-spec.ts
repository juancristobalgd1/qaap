// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type PlaywrightWorkerArgs, type TestInfo } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';

/**
 * One availability rule for every harness (qaap-harness-model-availability): Free models work without the harness
 * session, Pro models need it. These specs drive the sticky composer's agent picker with the real response shapes of
 * `GET /qaap/api/agent-tasks` and `GET /qaap/api/agent-tasks/agent-models?agent=` and check what the user sees.
 */

const OPENCODE_ID = 'opencode';
const OPENCODE_LABEL = 'OpenCode';
const LIST_ROUTE = /\/qaap\/api\/agent-tasks(\?.*)?$/;
const MODELS_ROUTE = /\/qaap\/api\/agent-tasks\/agent-models(\?.*)?$/;
const FREE_LABEL = 'Beam Free';
const PRO_LABEL = 'MiniMax-M3';
const CHECKING_TITLE = 'Checking sign-in…';
const BLOCKED_MESSAGE = `Sign in to ${OPENCODE_LABEL} to use ${PRO_LABEL}.`;
const SCREENSHOT_DIR = path.resolve(__dirname, '../../harness-availability-screenshots');

type Session = 'signed-in' | 'signed-out' | 'checking';

/** The session the stubbed backend reports for OpenCode; mutable so one test can change it mid-flow. */
interface HarnessState {
    session: Session;
}

interface Viewport {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly touch: boolean;
}

const VIEWPORTS: readonly Viewport[] = [
    { name: 'mobile', width: 375, height: 812, touch: true },
    { name: 'desktop', width: 1200, height: 953, touch: false },
];

/** The OpenCode descriptor for a session, shaped like `QaapAgentDescriptor` (see `resolveAgentAccess` and the harness availability rule). */
function opencodeDescriptor(session: Session): Record<string, unknown> {
    switch (session) {
        case 'signed-in':
            return { id: OPENCODE_ID, label: OPENCODE_LABEL, available: true, connectionState: 'connected', accessState: 'session', session };
        case 'checking':
            return { id: OPENCODE_ID, label: OPENCODE_LABEL, available: false, connectionState: 'unknown', session };
        default:
            return { id: OPENCODE_ID, label: OPENCODE_LABEL, available: true, connectionState: 'disconnected', accessState: 'none', session };
    }
}

/** The OpenCode catalog for a session, shaped like `QaapQaiqModelOption`: a Free model and a Pro model. */
function opencodeModels(session: Session): Record<string, unknown>[] {
    const free = { provider: 'openai', vendor: OPENCODE_ID, modelId: 'opencode/beam-free', label: FREE_LABEL, tier: 'free' };
    const pro = session === 'signed-in'
        ? { provider: 'openai', vendor: OPENCODE_ID, modelId: 'opencode/minimax-m3', label: PRO_LABEL, tier: 'pro', available: true }
        : {
            provider: 'openai',
            vendor: OPENCODE_ID,
            modelId: 'opencode/minimax-m3',
            label: PRO_LABEL,
            tier: 'pro',
            available: false,
            unavailableReason: session === 'checking' ? 'checking' : 'not-connected',
        };
    return [free, pro];
}

/**
 * Serves the agent list and the OpenCode catalog from `state`; every other request keeps the real backend answer.
 * The list keeps the real agents and replaces only OpenCode, so the rest of the picker is the real one.
 */
async function stubHarnessRoutes(page: Page, state: HarnessState): Promise<void> {
    await page.route(LIST_ROUTE, async route => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const real = await route.fetch();
        const body = await real.json().catch(() => ({})) as Record<string, unknown>;
        const others = (Array.isArray(body.agents) ? body.agents : [])
            .filter(agent => (agent as { id?: string }).id !== OPENCODE_ID);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            json: { ...body, agents: [...others, opencodeDescriptor(state.session)], defaultAgent: OPENCODE_ID },
        });
    });
    await page.route(MODELS_ROUTE, async route => {
        const agent = new URL(route.request().url()).searchParams.get('agent');
        if (agent?.trim().toLowerCase() !== OPENCODE_ID) {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            json: { agent: OPENCODE_ID, models: opencodeModels(state.session) },
        });
    });
}

/** A fresh context with its own viewport, routes set before the first load (same shape as qaap-tenant-update-now). */
async function openWorkHub(args: PlaywrightWorkerArgs, viewport: Viewport, state: HarnessState): Promise<{ page: Page; context: BrowserContext }> {
    const context = await args.browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        ...(viewport.touch ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    await stubHarnessRoutes(page, state);
    await TheiaAppLoader.load({ playwright: args.playwright, browser: { newPage: async () => page } as unknown as Browser });
    return { page, context };
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

/** Opens the sticky composer's agent picker from the agent pill. */
async function openAgentPicker(page: Page): Promise<void> {
    await page.locator('.theia-mobile-projects-sticky-composer-agent:visible').first().click();
}

/** Drills from the agent list into OpenCode's model list (the chevron of its row). */
async function openOpenCodeModels(page: Page): Promise<void> {
    await page.locator(`button.theia-qaap-agent-sheet-split-chevron[aria-label="Choose model for ${OPENCODE_LABEL}"]`).first().click();
}

/** The model row with this visible label in the open drill-down (desktop popover and mobile sheet share it). */
function modelRow(page: Page, label: string): Locator {
    return page.locator('.theia-qaap-picker-sheet-option').filter({ hasText: label }).first();
}

function screenshotPath(prefix: string, name: string): string {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    return path.join(SCREENSHOT_DIR, `${prefix}-${name}.png`);
}

/** Saves a PNG into the CI folder and attaches it to the report by content. */
async function capture(testInfo: TestInfo, page: Page, prefix: string, name: string): Promise<void> {
    const file = screenshotPath(prefix, name);
    await page.screenshot({ path: file });
    await testInfo.attach(`${prefix}-${name}`, { body: fs.readFileSync(file), contentType: 'image/png' });
}

test.describe('@qaap-mobile harness availability in the agent picker', () => {

    for (const viewport of VIEWPORTS) {

        test(`${viewport.name}: a signed-out harness keeps its Free model selectable and locks the Pro one with a sign-in reason`, async ({ playwright, browser }, testInfo) => {
            const state: HarnessState = { session: 'signed-out' };
            const { page, context } = await openWorkHub({ playwright, browser }, viewport, state);
            try {
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);
                await openAgentPicker(page);
                await openOpenCodeModels(page);

                const free = modelRow(page, FREE_LABEL);
                await expect(free).toBeVisible({ timeout: 30_000 });
                await expect(free).not.toHaveClass(/theia-mod-disabled/);
                await expect(free).toContainText('Free');

                const pro = modelRow(page, PRO_LABEL);
                await expect(pro).toHaveClass(/theia-mod-disabled/);
                await expect(pro).toContainText('Pro');
                await expect(pro).toHaveAttribute('title', /Sign in to OpenCode/);
                await capture(testInfo, page, viewport.name, 'signed-out-models');
            } finally {
                await context.close();
            }
        });

        test(`${viewport.name}: a signed-in harness makes every model selectable`, async ({ playwright, browser }, testInfo) => {
            const state: HarnessState = { session: 'signed-in' };
            const { page, context } = await openWorkHub({ playwright, browser }, viewport, state);
            try {
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);
                await openAgentPicker(page);
                await openOpenCodeModels(page);

                await expect(modelRow(page, FREE_LABEL)).toBeVisible({ timeout: 30_000 });
                await expect(modelRow(page, PRO_LABEL)).not.toHaveClass(/theia-mod-disabled/);
                await expect(page.locator('.theia-qaap-picker-sheet-option.theia-mod-disabled')).toHaveCount(0);
                await capture(testInfo, page, viewport.name, 'signed-in-models');
            } finally {
                await context.close();
            }
        });

        test(`${viewport.name}: a harness whose sign-in is still checking says so and keeps its Pro models locked`, async ({ playwright, browser }, testInfo) => {
            const state: HarnessState = { session: 'checking' };
            const { page, context } = await openWorkHub({ playwright, browser }, viewport, state);
            try {
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);
                await openAgentPicker(page);
                await expect(page.getByText(CHECKING_TITLE).first()).toBeVisible({ timeout: 30_000 });
                await capture(testInfo, page, viewport.name, 'checking-agents');

                await openOpenCodeModels(page);
                const pro = modelRow(page, PRO_LABEL);
                await expect(pro).toHaveClass(/theia-mod-disabled/);
                await expect(pro).toHaveAttribute('title', CHECKING_TITLE);
                await expect(page.locator('.theia-qaap-picker-sheet-option.theia-mod-disabled [title="Sign in to OpenCode to use this model"]')).toHaveCount(0);
                await capture(testInfo, page, viewport.name, 'checking-models');
            } finally {
                await context.close();
            }
        });

        test(`${viewport.name}: a send with a Pro model whose sign-in is gone is held with the sign-in message`, async ({ playwright, browser }, testInfo) => {
            const state: HarnessState = { session: 'signed-in' };
            const { page, context } = await openWorkHub({ playwright, browser }, viewport, state);
            try {
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);
                // Pick the Pro model while signed in, so it becomes the stored choice for this project.
                await openAgentPicker(page);
                await openOpenCodeModels(page);
                await modelRow(page, PRO_LABEL).click();

                // The sign-in ends: the stored choice stays, and the catalog now locks it.
                state.session = 'signed-out';
                await page.reload();
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);

                const composer = page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-input').first();
                await composer.fill('Hello');
                await page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-send').first().click();

                const message = page.locator('.theia-mobile-snackbar-message').filter({ hasText: BLOCKED_MESSAGE }).first();
                await expect(message).toBeVisible({ timeout: 30_000 });
                await capture(testInfo, page, viewport.name, 'send-blocked');
            } finally {
                await context.close();
            }
        });
    }
});

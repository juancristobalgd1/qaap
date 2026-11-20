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
// The task list (`GET /agent-tasks`) and the Work Hub catalog the sticky composer loads (`GET /agent-tasks/all`): both
// carry `agents` + `defaultAgent`, so both must report the stubbed OpenCode or a reload falls back to the real agents.
const LIST_ROUTE = /\/qaap\/api\/agent-tasks(?:\/all)?(\?.*)?$/;
const MODELS_ROUTE = /\/qaap\/api\/agent-tasks\/agent-models(\?.*)?$/;
const FREE_LABEL = 'Beam Free';
const PRO_LABEL = 'MiniMax-M3';
const CHECKING_TITLE = 'Checking sign-in…';
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

/** Opens the sticky composer's agent picker from the agent pill ("Agent: <harness>"). */
async function openAgentPicker(page: Page): Promise<void> {
    await page.locator('.theia-mobile-projects-sticky-composer-agent:visible').first().click({ timeout: 30_000 });
    await expect(modelPicker(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * The unified model picker: the only dialog with the model-picker class (the sessions sidebar is a dialog too,
 * so a bare role lookup matches two elements).
 */
function modelPicker(page: Page): Locator {
    return page.locator('[role="dialog"].theia-mod-model-picker');
}

/** The harness sign-in dialog, opened by picking (or sending with) a model whose only blocker is the session. */
function loginDialog(page: Page): Locator {
    return page.locator('.theia-mobile-agent-login-dialog');
}

/** Selects OpenCode on the picker's harness rail, so its model rows are listed. */
async function selectOpenCodeRail(page: Page): Promise<void> {
    await modelPicker(page).getByRole('button', { name: OPENCODE_LABEL, exact: true }).click({ timeout: 30_000 });
}

/** The model row with this label in the open picker (the unified model picker on desktop and mobile). */
function modelRow(page: Page, label: string): Locator {
    return page.locator('.qaap-model-picker-row').filter({ hasText: label }).first();
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

        test(`${viewport.name}: a signed-out harness keeps its Free model selectable and opens the sign-in from its Pro one`, async ({ playwright, browser }, testInfo) => {
            const state: HarnessState = { session: 'signed-out' };
            const { page, context } = await openWorkHub({ playwright, browser }, viewport, state);
            try {
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);
                await openAgentPicker(page);
                await selectOpenCodeRail(page);

                const free = modelRow(page, FREE_LABEL);
                await expect(free).toBeVisible({ timeout: 30_000 });
                await expect(free).toBeEnabled();
                await expect(free).toContainText('Free');

                // Looks like any other row (no Sign in text or button); picking it opens the harness sign-in dialog.
                const pro = modelRow(page, PRO_LABEL);
                await expect(pro).toBeVisible();
                await expect(pro).toBeEnabled();
                await expect(pro).toContainText('Pro');
                await expect(pro).not.toContainText(/sign in/i);
                await capture(testInfo, page, viewport.name, 'signed-out-models');
                await pro.click();
                await expect(loginDialog(page)).toBeVisible({ timeout: 30_000 });
                await expect(loginDialog(page)).toContainText(OPENCODE_LABEL);
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
                await selectOpenCodeRail(page);

                await expect(modelRow(page, FREE_LABEL)).toBeVisible({ timeout: 30_000 });
                const pro = modelRow(page, PRO_LABEL);
                await expect(pro).toBeEnabled();
                await expect(pro).not.toContainText(`Sign in to ${OPENCODE_LABEL}`);
                await expect(page.locator('.qaap-model-picker-row:disabled')).toHaveCount(0);
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
                await selectOpenCodeRail(page);
                const pro = modelRow(page, PRO_LABEL);
                await expect(pro).toBeVisible({ timeout: 30_000 });
                await expect(pro).toBeDisabled();
                await expect(pro).toHaveAttribute('title', CHECKING_TITLE);
                await expect(pro).not.toContainText(`Sign in to ${OPENCODE_LABEL}`);
                await capture(testInfo, page, viewport.name, 'checking-models');
            } finally {
                await context.close();
            }
        });

        test(`${viewport.name}: a send with a Pro model whose sign-in is gone is held and opens the sign-in`, async ({ playwright, browser }, testInfo) => {
            const state: HarnessState = { session: 'signed-in' };
            const { page, context } = await openWorkHub({ playwright, browser }, viewport, state);
            try {
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);
                // Pick the Pro model while signed in, so it becomes the stored choice for this project.
                await openAgentPicker(page);
                await selectOpenCodeRail(page);
                await modelRow(page, PRO_LABEL).click({ timeout: 30_000 });

                // The sign-in ends: the stored choice stays, and the catalog now locks it.
                state.session = 'signed-out';
                await page.reload();
                await dismissMobileTutorial(page);
                await waitForWorkHubReady(page);

                // Type and submit with the keyboard, the way the user does: the send control is only enabled once the
                // composer holds text, and the Enter path does not depend on that state.
                const composer = page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-input').first();
                await composer.click({ timeout: 30_000 });
                await page.keyboard.type('Hello');
                await page.keyboard.press('Enter');

                // Held, and the sign-in dialog opens straight away (the same for every harness).
                await expect(loginDialog(page)).toBeVisible({ timeout: 30_000 });
                await expect(loginDialog(page)).toContainText(OPENCODE_LABEL);
                await capture(testInfo, page, viewport.name, 'send-blocked');
            } finally {
                await context.close();
            }
        });
    }
});

/** A Pro-only harness the stub reports signed out, with two of its real catalog model ids. */
interface SignedOutHarness {
    readonly id: string;
    readonly label: string;
    readonly models: readonly { readonly modelId: string; readonly label: string }[];
}

/**
 * The two harnesses users hit with a stale session: Cursor ("Authentication required. Please run 'agent login'
 * first") and Codex ("401 Unauthorized: Missing bearer"). Their catalogs have no Free model.
 */
const SIGNED_OUT_HARNESSES: readonly SignedOutHarness[] = [
    { id: 'cursor', label: 'Cursor Agent', models: [{ modelId: 'auto', label: 'Auto' }, { modelId: 'gpt-mini-latest', label: 'gpt-mini-latest' }] },
    { id: 'codex', label: 'Codex', models: [{ modelId: 'gpt-6-luna', label: 'GPT-6 Luna' }, { modelId: 'gpt-6-sol', label: 'GPT-6 Sol' }] },
];

/** Serves `harness` signed out (descriptor and locked Pro catalog, the backend's real shapes); the rest stays real. */
async function stubSignedOutHarness(page: Page, harness: SignedOutHarness): Promise<void> {
    await page.route(LIST_ROUTE, async route => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const real = await route.fetch();
        const body = await real.json().catch(() => ({})) as Record<string, unknown>;
        const others = (Array.isArray(body.agents) ? body.agents : [])
            .filter(agent => (agent as { id?: string }).id !== harness.id);
        const descriptor = { id: harness.id, label: harness.label, available: false, connectionState: 'disconnected', accessState: 'none', session: 'signed-out' };
        await route.fulfill({ status: 200, contentType: 'application/json', json: { ...body, agents: [...others, descriptor], defaultAgent: harness.id } });
    });
    await page.route(MODELS_ROUTE, async route => {
        const agent = new URL(route.request().url()).searchParams.get('agent');
        if (agent?.trim().toLowerCase() !== harness.id) {
            await route.continue();
            return;
        }
        const models = harness.models.map(model => ({
            provider: 'openai', vendor: harness.id, modelId: model.modelId, label: model.label, tier: 'pro', available: false, unavailableReason: 'not-connected',
        }));
        await route.fulfill({ status: 200, contentType: 'application/json', json: { agent: harness.id, models } });
    });
}

test.describe('@qaap-mobile signed-out Pro harnesses in the agent picker', () => {

    for (const viewport of VIEWPORTS) {
        for (const harness of SIGNED_OUT_HARNESSES) {

            test(`${viewport.name}: ${harness.label} without a session lists its Pro models and opens the sign-in from them`, async ({ playwright, browser }, testInfo) => {
                const context = await browser.newContext({
                    viewport: { width: viewport.width, height: viewport.height },
                    ...(viewport.touch ? { isMobile: true, hasTouch: true } : {}),
                });
                const page = await context.newPage();
                try {
                    await stubSignedOutHarness(page, harness);
                    await TheiaAppLoader.load({ playwright, browser: { newPage: async () => page } as unknown as Browser });
                    await dismissMobileTutorial(page);
                    await waitForWorkHubReady(page);
                    await openAgentPicker(page);
                    await modelPicker(page).getByRole('button', { name: harness.label, exact: true }).click({ timeout: 30_000 });

                    for (const model of harness.models) {
                        const row = modelRow(page, model.label);
                        await expect(row).toBeVisible({ timeout: 30_000 });
                        await expect(row).toBeEnabled();
                        await expect(row).toContainText('Pro');
                        await expect(row).not.toContainText(/sign in/i);
                    }
                    // No separate Sign in button: picking a model is the way in.
                    await expect(modelPicker(page).locator('.qaap-model-picker-connect-action')).toHaveCount(0);
                    await capture(testInfo, page, viewport.name, `${harness.id}-signed-out`);
                    await modelRow(page, harness.models[0].label).click();
                    await expect(loginDialog(page)).toBeVisible({ timeout: 30_000 });
                    await expect(loginDialog(page)).toContainText(harness.label);
                } finally {
                    await context.close();
                }
            });
        }
    }
});

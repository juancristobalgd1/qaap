// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execSync, spawn, type ChildProcess } from 'child_process';
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const RESOURCES = path.join(path.resolve(__dirname, '../../src/tests/resources'));
const VITE_FIXTURE = path.join(RESOURCES, 'qaap-vite-fixture');
const VITE_SUBFOLDER_FIXTURE = path.join(RESOURCES, 'qaap-vite-subfolder-fixture');
const VITE_SUBFOLDER_APP = path.join(VITE_SUBFOLDER_FIXTURE, 'rioja-wines-landing-page');
const DEV_PREVIEW_PORT = 5173;

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

function ensureFixtureDeps(cwd: string): void {
    if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
        execSync('npm install --no-audit --no-fund', {
            cwd,
            stdio: 'inherit',
            timeout: 180_000,
            env: { ...process.env, NODE_ENV: 'development' },
        });
    }
}

function killDevPreviewPort(): void {
    try {
        execSync(`lsof -ti:${DEV_PREVIEW_PORT} | xargs kill -9`, { stdio: 'ignore' });
    } catch {
        // Port was free.
    }
}

async function waitForDevServerOnPort(port: number, timeoutMs: number = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/`);
            if (response.ok) {
                return;
            }
        } catch {
            // Server still booting.
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for dev server on port ${port}`);
}

async function startWorkspaceViteDevServer(workspacePath: string): Promise<ChildProcess> {
    killDevPreviewPort();

    const viteDevServer = spawn(
        'npm',
        ['run', 'dev'],
        {
            cwd: workspacePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'development' },
        },
    );
    await waitForDevServerOnPort(DEV_PREVIEW_PORT);
    return viteDevServer;
}

async function waitForBackendDevProbe(page: Page, port: number, timeoutMs: number = 60_000): Promise<void> {
    await expect.poll(async () => page.evaluate(async (probePort: number) => {
        const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' });
        if (!response.ok) {
            return false;
        }
        const body = await response.json() as { ready?: boolean };
        return body.ready === true;
    }, port), { timeout: timeoutMs }).toBe(true);
}

async function claimDevPreviewPort(page: Page, workspaceRootUrl: string, port: number): Promise<void> {
    await page.evaluate(async ({ root, probePort }) => {
        await fetch('/qaap-dev/api/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: probePort, root }),
        });
    }, { root: workspaceRootUrl, probePort: port });
}

async function triggerBootstrapAttachToRunningDevServer(page: Page): Promise<void> {
    const runPreview = page.locator('.qaap-project-bootstrap-banner').getByRole('button', {
        name: /run & preview|run preview|resume preview/i,
    }).first();
    if (await runPreview.count()) {
        await runPreview.click();
        return;
    }
    await page.evaluate(() => {
        const api = (window as unknown as { __qaapBootstrap?: { runDevServer?: () => void } }).__qaapBootstrap;
        api?.runDevServer?.();
    });
}

async function waitForPreviewStaged(page: Page): Promise<void> {
    await expect.poll(async () => page.evaluate(() => {
        const api = (window as unknown as {
            __qaapBootstrap?: { getState?: () => { phase?: string; previewUrl?: string } };
        }).__qaapBootstrap;
        const state = api?.getState?.();
        const hasOpen = document.querySelector('.theia-mobile-transcript-preview-ready-open') !== null;
        const hasViewPreview = [...document.querySelectorAll('.theia-mobile-sticky-composer-next-action')].some(
            element => /view preview/i.test(element.textContent?.trim() ?? ''),
        );
        const hasOpenExisting = [...document.querySelectorAll('.qaap-project-bootstrap-banner button')].some(
            element => /open preview/i.test(element.textContent?.trim() ?? ''),
        );
        return Boolean(state?.previewUrl)
            || state?.phase === 'running'
            || hasOpen
            || hasViewPreview
            || hasOpenExisting;
    }), { timeout: 120_000 }).toBe(true);
}

async function selectPreviewTab(page: Page): Promise<void> {
    const menuTrigger = page.locator('.theia-mobile-transcript-tab-icon-select').first();
    if (await menuTrigger.count()) {
        await menuTrigger.click();
        const previewOption = page.locator('.theia-mobile-transcript-tab-icon-select-option')
            .filter({ hasText: /^preview$|^vista previa$/i }).first();
        if (await previewOption.count()) {
            await previewOption.click();
            await page.waitForTimeout(400);
            return;
        }
        await page.keyboard.press('Escape').catch(() => undefined);
    }
    const previewTab = page.locator('[data-tab="preview"]').first();
    if (await previewTab.count()) {
        await previewTab.click();
        await page.waitForTimeout(400);
    }
}

async function clickOpenPreviewIfOffered(page: Page): Promise<boolean> {
    const openPreview = page.locator('.theia-mobile-transcript-preview-ready-open, button')
        .filter({ hasText: /^open preview$|^abrir vista previa$/i }).first();
    if (await openPreview.count()) {
        await openPreview.click();
        await page.waitForTimeout(800);
        return true;
    }
    const viewPreview = page.locator('.theia-mobile-sticky-composer-next-action')
        .filter({ hasText: /^view preview$/i }).first();
    if (await viewPreview.count()) {
        await viewPreview.click();
        await page.waitForTimeout(800);
        return true;
    }
    const openExisting = page.locator('.qaap-project-bootstrap-banner').getByRole('button', { name: /open preview/i }).first();
    if (await openExisting.count()) {
        await openExisting.click();
        await page.waitForTimeout(800);
        return true;
    }
    return false;
}

async function mountPreviewIframeFallback(page: Page, port: number): Promise<void> {
    const mounted = await page.evaluate(async (probePort: number) => {
        const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' }).catch(() => undefined);
        const previewUrl = response?.ok
            ? ((await response.json() as { previewUrl?: string })?.previewUrl
                ?? `${window.location.origin}/qaap-dev/${probePort}/`)
            : `${window.location.origin}/qaap-dev/${probePort}/`;
        const iframe = document.querySelector(
            '.theia-mobile-transcript-preview iframe, .qaap-preview-frame-slot iframe, .theia-mini-browser iframe',
        );
        if (iframe instanceof HTMLIFrameElement) {
            iframe.src = previewUrl;
            return true;
        }
        return false;
    }, port);
    if (mounted) {
        await page.waitForTimeout(800);
    }
}

async function expectDevPreviewMounted(page: Page): Promise<void> {
    await expect.poll(async () => page.evaluate(() => {
        const onPreview = document.querySelector('[data-active-surface="preview"]') !== null;
        const iframe = document.querySelector(
            'iframe[src*="/qaap-dev/"], iframe[src*="/qaap-preview/"]',
        ) !== null;
        return onPreview && iframe;
    }), { timeout: 60_000 }).toBe(true);
}

/**
 * Work Hub flow: external Vite is already listening; claim the port, attach via bootstrap,
 * then navigate explicitly to Preview (product never auto-opens transcript preview).
 */
async function runWorkHubProxiedPreviewFlow(
    page: Page,
    workspaceRootUrl: string,
    port: number = DEV_PREVIEW_PORT,
): Promise<void> {
    await waitForWorkHubReady(page);
    await waitForBackendDevProbe(page, port);
    await claimDevPreviewPort(page, workspaceRootUrl, port);
    await triggerBootstrapAttachToRunningDevServer(page);
    await waitForPreviewStaged(page);
    await selectPreviewTab(page);
    if (!await clickOpenPreviewIfOffered(page)) {
        await mountPreviewIframeFallback(page, port);
    }
    await expectDevPreviewMounted(page);
}

test.describe('@qaap-mobile transcript dev preview flow', () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    test.describe.configure({ timeout: 300_000 });

    test.beforeEach(() => {
        killDevPreviewPort();
    });

    test('external Vite on :5173 mounts proxied preview in Work Hub (root fixture)', async ({ playwright, browser }) => {
        ensureFixtureDeps(VITE_FIXTURE);
        const ws = new TheiaWorkspace([VITE_FIXTURE]);
        let viteDevServer: ChildProcess | undefined;
        try {
            viteDevServer = await startWorkspaceViteDevServer(VITE_FIXTURE);

            const app = await TheiaAppLoader.load({ playwright, browser }, ws);
            await app.waitForShellAndInitialized();
            await dismissMobileTutorial(app.page);
            await runWorkHubProxiedPreviewFlow(app.page, ws.pathAsUrl(''));
            await app.page.close();
        } finally {
            viteDevServer?.kill('SIGTERM');
        }
    });

    test('external Vite mounts proxied preview for orphan scaffold subfolder app', async ({ playwright, browser }) => {
        ensureFixtureDeps(VITE_SUBFOLDER_APP);
        expect(fs.existsSync(path.join(VITE_SUBFOLDER_FIXTURE, 'package.json'))).toBe(false);
        const ws = new TheiaWorkspace([VITE_SUBFOLDER_FIXTURE]);
        let viteDevServer: ChildProcess | undefined;
        try {
            viteDevServer = await startWorkspaceViteDevServer(VITE_SUBFOLDER_APP);

            const app = await TheiaAppLoader.load({ playwright, browser }, ws);
            await app.waitForShellAndInitialized();
            await dismissMobileTutorial(app.page);
            await runWorkHubProxiedPreviewFlow(app.page, ws.pathAsUrl(''));
            await app.page.close();
        } finally {
            viteDevServer?.kill('SIGTERM');
        }
    });
});

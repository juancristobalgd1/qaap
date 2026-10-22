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
/** Ports the preview allocator walks from :5173 before this spec's servers would land elsewhere. */
const DEV_PREVIEW_PORT_RANGE = 8;

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

/**
 * Frees :5173 and the alternate ports the product's port recovery moves to. Dev servers the
 * bootstrap spawned in earlier tests outlive their page (backend terminals), so leaving them up
 * shifts every later managed run to another port.
 */
function killDevPreviewPort(): void {
    try {
        execSync(`lsof -ti tcp:${DEV_PREVIEW_PORT}-${DEV_PREVIEW_PORT + 7} -sTCP:LISTEN | xargs -r kill -9`, { stdio: 'ignore' });
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

function stopWorkspaceViteDevServer(viteDevServer: ChildProcess | undefined): void {
    if (!viteDevServer?.pid) {
        return;
    }
    if (process.platform === 'win32') {
        // With shell: true the direct child is cmd.exe; kill the whole tree so Vite frees its port.
        try {
            execSync(`taskkill /pid ${viteDevServer.pid} /T /F`, { stdio: 'ignore' });
        } catch {
            // Already exited.
        }
        return;
    }
    viteDevServer.kill('SIGTERM');
}

async function startWorkspaceViteDevServer(workspacePath: string): Promise<ChildProcess> {
    killDevPreviewPort();

    const viteDevServer = spawn(
        'npm',
        ['run', 'dev'],
        {
            cwd: workspacePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            // npm is npm.cmd on Windows, which Node only launches through a shell.
            shell: process.platform === 'win32',
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

/**
 * `runDevServer()` is a no-op until the bootstrap has a descriptor, so wait for detection before
 * triggering it. `scaffoldRelativePath` pins the detected layout: an orphan scaffold must take the
 * Vite subfolder path, not the static-site fallback for its `index.html`.
 */
async function waitForBootstrapDetected(page: Page, scaffoldRelativePath?: string): Promise<void> {
    await expect.poll(async () => page.evaluate(() => {
        const api = (window as unknown as {
            __qaapBootstrap?: { getState?: () => { descriptor?: string; scaffoldRelativePath?: string } };
        }).__qaapBootstrap;
        const state = api?.getState?.();
        return state?.descriptor ? { scaffoldRelativePath: state.scaffoldRelativePath } : undefined;
    }), { timeout: 60_000 }).toEqual({ scaffoldRelativePath });
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
        const staged = Boolean(state?.previewUrl)
            || state?.phase === 'running'
            || hasOpen
            || hasViewPreview
            || hasOpenExisting;
        // On failure the poll reports the observed bootstrap state instead of a bare `false`.
        return staged ? 'staged' : JSON.stringify({ state, hasOpen, hasViewPreview, hasOpenExisting });
    }), { timeout: 120_000 }).toBe('staged');
}

/**
 * The preview must be the external Vite the test started, not a second copy the bootstrap spawned.
 * Without this the flow also passes when the bootstrap parks its own server on the next free port
 * (:5174, or :5176 when earlier runs left :5174/:5175 behind), which then races the staging
 * check and was the source of the CI flake.
 */
async function expectAttachedToExternalServer(page: Page, port: number): Promise<void> {
    await expect.poll(async () => page.evaluate((expectedPort: number) => {
        const state = (window as unknown as {
            __qaapBootstrap?: { getState?: () => { lastPort?: number; devOutputTail?: string } };
        }).__qaapBootstrap?.getState?.();
        const spawnedOwnServer = /--port\s+\d+/.test(state?.devOutputTail ?? '');
        // On failure the poll reports where the preview landed and what the bootstrap launched.
        return state?.lastPort === expectedPort && !spawnedOwnServer
            ? 'attached'
            : JSON.stringify({ lastPort: state?.lastPort, spawnedOwnServer, devOutputTail: (state?.devOutputTail ?? '').slice(-400) });
    }, port), { timeout: 30_000 }).toBe('attached');
}

/**
 * The backend registry outlives the page and the Vite process. A preview identity left on :5173
 * keeps that port reserved for the next test or retry, which then cannot attach to its own
 * external server. Release what this flow registered before the page goes away.
 */
async function releasePreviewIdentities(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const ids = new Set<string>();
        for (const frame of document.querySelectorAll('iframe[src*="/qaap-preview/"]')) {
            const match = /\/qaap-preview\/([^/?#]+)\//.exec(frame.getAttribute('src') ?? '');
            if (match) {
                ids.add(match[1]);
            }
        }
        const state = (window as unknown as { __qaapBootstrap?: { getState?: () => { previewUrl?: string } } })
            .__qaapBootstrap?.getState?.();
        const fromState = /\/qaap-preview\/([^/?#]+)\//.exec(state?.previewUrl ?? '');
        if (fromState) {
            ids.add(fromState[1]);
        }
        await Promise.all([...ids].map(previewId => fetch('/qaap-dev/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ previewId }),
        }).catch(() => undefined)));
    }).catch(() => undefined);
}

/**
 * Releases every preview identity registered on the dev-preview port range, whichever project or
 * spec registered it. Release also stops the server behind it, so call it before this spec starts
 * its own external Vite (or after it stopped it).
 */
async function releaseRegisteredPreviewPorts(baseURL: string | undefined): Promise<void> {
    if (!baseURL) {
        return;
    }
    for (let port = DEV_PREVIEW_PORT; port < DEV_PREVIEW_PORT + DEV_PREVIEW_PORT_RANGE; port++) {
        try {
            const probe = await fetch(new URL(`/qaap-dev/api/probe/${port}`, baseURL), { cache: 'no-store' });
            const previewId = probe.ok ? (await probe.json() as { previewId?: string }).previewId : undefined;
            if (previewId) {
                await fetch(new URL('/qaap-dev/api/release', baseURL), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ previewId }),
                });
            }
        } catch {
            // Backend not reachable yet: nothing registered to release.
        }
    }
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
        // On the one-column Work Hub the Preview surface opens in the execution-surface drawer
        // (`data-surface="preview"`) while the inline conversation deliberately stays on
        // `data-active-surface="messages"`; wider layouts switch the inline surface itself.
        const previewSurfaces = document.querySelectorAll(
            '[data-active-surface="preview"], .theia-mobile-execution-surface-sidebar[data-surface="preview"]',
        );
        const mounted = [...previewSurfaces].some(surface => surface.querySelector(
            'iframe[src*="/qaap-dev/"], iframe[src*="/qaap-preview/"]',
        ) !== null);
        if (mounted) {
            return 'mounted';
        }
        // On failure the poll reports what the page shows instead of a bare `false`.
        return JSON.stringify({
            activeSurfaces: [...document.querySelectorAll('[data-active-surface]')].map(element =>
                `${element.className}=${element.getAttribute('data-active-surface')}`),
            drawerSurfaces: [...document.querySelectorAll('.theia-mobile-execution-surface-sidebar')].map(element =>
                element.getAttribute('data-surface')),
            iframes: [...document.querySelectorAll('iframe')].map(element => element.getAttribute('src')),
        });
    }), { timeout: 60_000 }).toBe('mounted');
}

/**
 * Work Hub flow: external Vite is already listening; claim the port, attach via bootstrap,
 * then navigate explicitly to Preview (product never auto-opens transcript preview).
 */
async function runWorkHubProxiedPreviewFlow(
    page: Page,
    workspaceRootUrl: string,
    scaffoldRelativePath?: string,
    port: number = DEV_PREVIEW_PORT,
): Promise<void> {
    try {
        await waitForWorkHubReady(page);
        await waitForBackendDevProbe(page, port);
        await claimDevPreviewPort(page, workspaceRootUrl, port);
        await waitForBootstrapDetected(page, scaffoldRelativePath);
        await triggerBootstrapAttachToRunningDevServer(page);
        await waitForPreviewStaged(page);
        await expectAttachedToExternalServer(page, port);
        await selectPreviewTab(page);
        if (!await clickOpenPreviewIfOffered(page)) {
            await mountPreviewIframeFallback(page, port);
        }
        await expectDevPreviewMounted(page);
    } finally {
        await releasePreviewIdentities(page);
    }
}

test.describe('@qaap-mobile transcript dev preview flow', () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    test.describe.configure({ timeout: 300_000 });

    // Earlier specs leave Qaap-managed previews registered on the Vite ports (the run-app turn's
    // autopilot preview on :5173, the occupied-port recovery on :5174), and an attempt of this
    // flow can leave its own. Killing the listener is not enough: the backend keeps the identity
    // until it is released, and refuses to bind :5173 to this workspace while another project's
    // identity holds it — so the bootstrap parked a second server on :5175/:5176.
    test.beforeEach(async ({ baseURL }) => {
        await releaseRegisteredPreviewPorts(baseURL);
        killDevPreviewPort();
    });

    test.afterEach(async ({ baseURL }) => {
        await releaseRegisteredPreviewPorts(baseURL);
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
            stopWorkspaceViteDevServer(viteDevServer);
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
            await runWorkHubProxiedPreviewFlow(app.page, ws.pathAsUrl(''), path.basename(VITE_SUBFOLDER_APP));
            await app.page.close();
        } finally {
            stopWorkspaceViteDevServer(viteDevServer);
        }
    });
});

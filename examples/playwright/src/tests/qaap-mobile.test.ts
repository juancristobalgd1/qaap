// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execSync, spawn, type ChildProcess } from 'child_process';
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaApp } from '../theia-app';
import { TheiaExplorerView } from '../theia-explorer-view';
import { TheiaWorkspace } from '../theia-workspace';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_WORK_HUB_VIEWPORT = { width: 1200, height: 953 };
/** Wider than the 767px one-column breakpoint: the classic IDE is only reachable here. */
const DESKTOP_IDE_VIEWPORT = { width: 1280, height: 900 };
const KPI_PREVIEW_MS = 120_000;
/** The shell's main area; the Memory Inspector widget reuses the same id inside its own dock panel. */
const MAIN_CONTENT_PANEL = '#theia-bottom-split-panel > #theia-main-content-panel';

/** Compiled tests live under lib/tests; fixtures stay in src/tests/resources. */
const RESOURCES = path.resolve(__dirname, '../../src/tests/resources');
const SAMPLE_FILES = path.join(RESOURCES, 'sample-files1');
const VITE_FIXTURE = path.join(RESOURCES, 'qaap-vite-fixture');
const NEXT_FIXTURE = path.join(RESOURCES, 'qaap-next-fixture');
const LEGACY_BOOTSTRAP_FIXTURE = path.join(RESOURCES, 'qaap-bootstrap-fixture');

const PREVIEW_FRAME_SELECTOR = [
    `${MAIN_CONTENT_PANEL} .theia-mini-browser iframe`,
    '.theia-mini-browser iframe[src*="qaap-dev"]',
    '.theia-mini-browser iframe[src*="127.0.0.1"]',
    '.theia-mini-browser iframe[src*="localhost"]',
    '.qaap-preview-frame-slot iframe[src*="qaap-dev"]',
    '.qaap-preview-frame-slot iframe[src*="127.0.0.1"]',
    '.qaap-preview-frame-slot iframe[src*="localhost"]',
    '.theia-mobile-transcript-preview iframe[src*="qaap-dev"]',
    '.theia-mobile-transcript-preview iframe[src*="127.0.0.1"]',
    '.theia-mobile-transcript-preview iframe[src*="localhost"]',
    'iframe[src*="qaap-dev/5173"]',
    'iframe[src*="127.0.0.1:5173"]',
    'iframe[src*="localhost:5173"]',
].join(', ');

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

async function expectAgentsHubLanding(page: Page): Promise<void> {
    const hub = page.locator('.theia-mobile-projects');
    await expect(hub).toBeVisible();
    await expect(hub).toHaveClass(/theia-mod-agents-hub/);
    await expect(page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible();
    await expect(page.locator('#theia-mobile-bottom-bar')).toBeHidden();
}

async function expectWorkHubQuickActions(page: Page): Promise<void> {
    const actions = page.locator('.theia-mobile-agent-transcript-empty-action');
    await expect(actions.filter({ hasText: /Fix a bug/i })).toBeVisible();
    await expect(actions.filter({ hasText: /Explore code/i })).toBeVisible();
    await expect(actions.filter({ hasText: /Run app/i })).toBeVisible();
}

async function openDesktopIdeViaAccountMenu(page: Page): Promise<boolean> {
    const opened = await page.evaluate(() => {
        const accountBtn = [...document.querySelectorAll('.theia-workbench-account-btn')].find(
            element => element instanceof HTMLElement && element.offsetParent !== null,
        );
        if (!(accountBtn instanceof HTMLElement)) {
            return false;
        }
        accountBtn.click();
        return true;
    });
    if (!opened) {
        return false;
    }
    await page.waitForSelector('.theia-qaap-account-menu', { timeout: 10_000 });
    return page.evaluate(() => {
        const item = [...document.querySelectorAll('.theia-qaap-account-menu-item')].find(
            element => /open ide/i.test(element.textContent?.trim() ?? ''),
        );
        if (!(item instanceof HTMLElement)) {
            return false;
        }
        item.click();
        return true;
    });
}

async function openDesktopIdeViaCommandPalette(app: TheiaApp): Promise<boolean> {
    await app.page.keyboard.press('Escape');
    await app.quickCommandPalette.open();
    const input = app.page.locator(
        '#quick-input-container .monaco-inputbox .input, #quick-input-container .quick-input-and-message input'
    );
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('>');
    await input.pressSequentially('Open IDE', { delay: 40 });

    const clicked = await app.page.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].find(
            element => /open ide/i.test(element.textContent?.trim() ?? ''),
        );
        if (!(row instanceof HTMLElement)) {
            return false;
        }
        row.click();
        return true;
    });
    if (!clicked) {
        await app.page.keyboard.press('Enter');
    }
    await app.page.waitForSelector('.quick-input-widget', { state: 'hidden', timeout: 15_000 })
        .catch(() => app.page.keyboard.press('Escape'));
    return isDesktopIdeSurface(app.page);
}

/**
 * Classic desktop IDE: the shell left the one-column layout and no Work Hub composer is visible.
 * The Work Hub chat view stays mounted (hidden) while the IDE is shown, so only visible composer
 * inputs count.
 */
async function isDesktopIdeSurface(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const shell = document.getElementById('theia-app-shell');
        return !!shell
            && !shell.classList.contains('theia-mod-mobile-one-column')
            && !document.body.classList.contains('theia-mobile-mod-landing')
            && ![...document.querySelectorAll<HTMLElement>('.theia-mobile-projects-sticky-composer-input')]
                .some(input => input.offsetParent !== null);
    });
}

async function waitForDesktopIdeSurface(page: Page, timeout: number): Promise<boolean> {
    return expect.poll(() => isDesktopIdeSurface(page), { timeout }).toBe(true).then(() => true, () => false);
}

/**
 * A page booted at the phone viewport runs the phone entry (bundle.mobile.js), which reloads once into
 * the desktop entry when the window is widened (qaap-login-gate.js). Keys pressed during that reload
 * are lost, so wait until the current document runs the desktop entry before driving the IDE.
 */
async function waitForDesktopEntry(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => {
        const sources = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map(script => script.src);
        return sources.some(source => /\/bundle\.js(\?|$)/.test(source))
            && !sources.some(source => /\/bundle\.mobile\.js(\?|$)/.test(source));
    }).catch(() => false), { timeout: 60_000 }).toBe(true);
}

/**
 * Escape hatch: Work Hub → classic IDE. The classic IDE is desktop-only (one-column mobile mode
 * always shows Work Hub, see .cursor/rules/work-hub-reload-default.mdc), so switch to a desktop
 * viewport before choosing "Open IDE".
 */
async function openDesktopIde(app: TheiaApp): Promise<void> {
    await app.page.setViewportSize(DESKTOP_IDE_VIEWPORT);
    await waitForDesktopEntry(app.page);
    await dismissMobileTutorial(app.page);
    await waitForWorkHubReady(app.page);

    for (let attempt = 0; attempt < 3; attempt++) {
        if (await isDesktopIdeSurface(app.page)) {
            break;
        }
        if (await openDesktopIdeViaAccountMenu(app.page) && await waitForDesktopIdeSurface(app.page, 5_000)) {
            break;
        }
        if (await openDesktopIdeViaCommandPalette(app) && await waitForDesktopIdeSurface(app.page, 5_000)) {
            break;
        }
        await app.page.waitForTimeout(800);
    }

    await expectClassicIdeSurface(app.page);
}

async function expectClassicIdeSurface(page: Page): Promise<void> {
    await expect.poll(() => isDesktopIdeSurface(page), { timeout: 30_000 }).toBe(true);
    await expect(page.locator(MAIN_CONTENT_PANEL)).toBeVisible();
}

async function expectOpenIdeNotOffered(app: TheiaApp): Promise<void> {
    await app.quickCommandPalette.open();
    const input = app.page.locator(
        '#quick-input-container .monaco-inputbox .input, #quick-input-container .quick-input-and-message input'
    );
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('>');
    await input.pressSequentially('Open IDE', { delay: 40 });
    await app.page.waitForTimeout(500);
    await expect(app.page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /open ide/i })).toHaveCount(0);
    await app.quickCommandPalette.hide();
}

async function openWorkHubSessionsSidebar(page: Page): Promise<void> {
    const openSidebar = page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible').first();
    if (await openSidebar.isVisible().catch(() => false)) {
        return;
    }

    await expect.poll(async () => page.evaluate(() => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Open session history"]')]
            .find(candidate => {
                const style = window.getComputedStyle(candidate);
                const rect = candidate.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 1
                    && rect.height > 1;
            });
        if (!button) {
            return false;
        }
        button.click();
        return true;
    }), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible')).toBeVisible();
}

async function expectDesktopSessionsSidebarLayout(page: Page): Promise<void> {
    const layout = await page.evaluate(() => {
        const visibleRect = (selector: string): { left: number; right: number; width: number; height: number } | undefined => {
            const element = [...document.querySelectorAll<HTMLElement>(selector)].find(candidate => {
                const style = window.getComputedStyle(candidate);
                const candidateRect = candidate.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && candidateRect.width > 1
                    && candidateRect.height > 1;
            });
            if (!element) {
                return undefined;
            }
            const elementRect = element.getBoundingClientRect();
            return { left: elementRect.left, right: elementRect.right, width: elementRect.width, height: elementRect.height };
        };

        const sidebar = visibleRect('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible');
        const project = visibleRect('.theia-mobile-projects.theia-mod-visible');
        if (!sidebar || !project) {
            throw new Error('Expected visible Work Hub project and sessions sidebar surfaces.');
        }

        return {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            sidebar,
            project,
        };
    });

    expect(layout.sidebar.left).toBeLessThanOrEqual(1);
    // Allow the one-pixel sidebar border to meet the Work Hub surface without a gap.
    expect(layout.project.left).toBeGreaterThanOrEqual(layout.sidebar.right - 2);
    expect(layout.project.right).toBeGreaterThanOrEqual(layout.viewportWidth - 1);
    expect(layout.project.height).toBeGreaterThanOrEqual(layout.viewportHeight - 1);
    expect(layout.project.width).toBeGreaterThanOrEqual(layout.viewportWidth - layout.project.left - 1);
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

async function openProxiedDevPreview(app: TheiaApp, port: number): Promise<void> {
    const previewUrl = await app.page.evaluate(async (previewPort: number) => {
        const response = await fetch(`/qaap-dev/api/probe/${previewPort}`, { cache: 'no-store' });
        const body = await response.json() as { previewUrl?: string };
        return body.previewUrl ?? `${window.location.origin}/qaap-dev/${previewPort}/`;
    }, port);

    await app.quickCommandPalette.open();
    const input = app.page.locator(
        '#quick-input-container .monaco-inputbox .input, #quick-input-container .quick-input-and-message input'
    );
    await expect(input).toBeVisible();
    await input.fill('>');
    await input.pressSequentially('Open URL', { delay: 40 });

    const clicked = await app.page.evaluate(async (url: string) => {
        await new Promise(resolve => setTimeout(resolve, 400));
        const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].find(
            element => /open url|mini-browser\.openurl/i.test(element.textContent?.trim() ?? ''),
        );
        if (row instanceof HTMLElement) {
            row.click();
            return true;
        }
        return false;
    }, previewUrl);
    if (!clicked) {
        await app.page.keyboard.press('Enter');
    }

    // Qaap's mini-browser handler opens an empty preview immediately; enter the URL
    // in the preview toolbar rather than expecting the upstream quick-input prompt.
    const urlInput = app.page.locator('.theia-mini-browser .theia-mini-browser-url-field input');
    await expect(urlInput).toBeVisible({ timeout: 10_000 });
    await urlInput.fill(previewUrl);
    await app.page.keyboard.press('Enter');
    await app.page.waitForSelector('.quick-input-widget', { state: 'hidden', timeout: 15_000 })
        .catch(() => app.page.keyboard.press('Escape'));
}

async function waitForDevPreviewSurface(app: TheiaApp): Promise<void> {
    // The desktop IDE docks the preview in the right side panel, not the main area.
    const miniBrowser = app.page.locator('.theia-mini-browser').filter({ visible: true }).first();
    await expect(miniBrowser).toBeVisible({ timeout: 60_000 });
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

async function reserveEphemeralTcpPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        await new Promise<void>(resolve => server.close(() => resolve()));
        throw new Error('Could not allocate an ephemeral Vite port.');
    }
    const port = address.port;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
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

async function startWorkspaceViteDevServer(workspacePath: string, port: number): Promise<ChildProcess> {
    const viteBin = path.join(workspacePath, 'node_modules', 'vite', 'bin', 'vite.js');
    const viteDevServer = spawn(
        process.execPath,
        [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        {
            cwd: workspacePath,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'development' },
        },
    );
    await waitForDevServerOnPort(port);
    return viteDevServer;
}

async function expectBootstrapDetected(page: Page, phase: RegExp): Promise<void> {
    const banner = page.locator('.qaap-project-bootstrap-banner');
    await expect(banner).toBeAttached({ timeout: 30_000 });
    await expect(banner).toHaveAttribute('data-phase', phase);
}

test.describe('@qaap-mobile Work Hub (default mobile UI)', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('skips login gate and shows workbench shell', async ({ playwright, browser }) => {
        const app = await TheiaAppLoader.load({ playwright, browser });
        await app.waitForShellAndInitialized();

        await expect(app.page.locator('#theia-app-shell')).toBeVisible();
        await expect(app.page.locator('body')).not.toHaveClass(/qaap-login-active/);
        await expect(app.page.locator('#qaap-login-host')).toHaveCount(0);

        await app.page.close();
    });

    test('lands on Agents Work Hub with sticky composer and hidden bottom bar', async ({ playwright, browser }) => {
        const app = await TheiaAppLoader.load({ playwright, browser });
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);

        await expect(app.page.locator('#theia-app-shell')).toHaveClass(/theia-mod-mobile-one-column/);
        await expectAgentsHubLanding(app.page);
        await expectWorkHubQuickActions(app.page);

        await app.page.close();
    });

    test('quick action fills the sticky composer prompt', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expectAgentsHubLanding(app.page);

        await app.page.locator('.theia-mobile-agent-transcript-empty-action').filter({ hasText: /Explore code/i }).click();
        const composer = app.page.locator('.theia-mobile-projects-sticky-composer-input');
        await expect(composer).toHaveValue(/explore|architecture|codebase/i);

        await app.page.close();
    });

    test('detects bootstrap phase while Work Hub hides the banner', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([LEGACY_BOOTSTRAP_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await expectAgentsHubLanding(app.page);

        await expectBootstrapDetected(app.page, /detected|ready-to-run/);
        await expect(app.page.locator('.qaap-project-bootstrap-banner')).toBeHidden();

        await app.page.close();
    });

    test('command palette filter accepts text on mobile viewport', async ({ playwright, browser }) => {
        const app = await TheiaAppLoader.load({ playwright, browser });
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);

        await app.quickCommandPalette.open();
        const input = app.page.locator(
            '#quick-input-container .monaco-inputbox .input, #quick-input-container .quick-input-and-message input'
        );
        await expect(input).toBeVisible();
        await input.focus();
        await input.pressSequentially('about', { delay: 40 });
        await expect(input).toHaveValue(/about/i);

        await app.quickCommandPalette.hide();
        await app.page.close();
    });
});

test.describe('@qaap-mobile Classic IDE (desktop Open IDE escape hatch)', () => {

    test.use({ viewport: DESKTOP_IDE_VIEWPORT });

    test('opens Explorer in the classic IDE', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await openDesktopIde(app);

        await app.openView(TheiaExplorerView);
        await expect(app.page.locator('#theia-left-content-panel')).not.toHaveClass(/theia-mod-collapsed/);
        await expect(app.page.locator('#explorer-view-container--files')).toBeVisible();

        await app.page.close();
    });

    test('opens a file from Explorer in the editor', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await openDesktopIde(app);

        await app.openView(TheiaExplorerView);
        const sampleFile = app.page.locator('#explorer-view-container--files .theia-FileStatNode', { hasText: 'sample.txt' });
        await expect(sampleFile).toBeVisible();
        await sampleFile.dblclick();
        await expect(app.page.locator(`${MAIN_CONTENT_PANEL} span:has-text("content line 2")`).first()).toBeVisible();

        await app.page.close();
    });

    test('shows project bootstrap banner in the editor surface', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([LEGACY_BOOTSTRAP_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await openDesktopIde(app);

        const banner = app.page.locator('.qaap-project-bootstrap-banner');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toHaveAttribute('data-phase', /detected|ready-to-run/);

        await app.page.close();
    });

    test('detects Next.js workspace in bootstrap banner', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([NEXT_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await openDesktopIde(app);

        const banner = app.page.locator('.qaap-project-bootstrap-banner');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner.locator('.qaap-project-bootstrap-title')).toContainText(/Next/i);

        await app.page.close();
    });

    test('detects Vite workspace in bootstrap banner', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([VITE_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await openDesktopIde(app);

        const banner = app.page.locator('.qaap-project-bootstrap-banner');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toHaveAttribute('data-phase', /ready-to-run/);
        await expect(banner.getByRole('button', { name: /run & preview/i })).toBeVisible();

        await app.page.close();
    });

    test('returns to Work Hub when the classic IDE enters mobile mode', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await openDesktopIde(app);

        await app.page.setViewportSize(MOBILE_VIEWPORT);
        await waitForWorkHubReady(app.page);
        await expect(app.page.locator('#theia-app-shell')).toHaveClass(/theia-mod-mobile-one-column/);
        await expect.poll(() => app.page.evaluate(() =>
            window.sessionStorage.getItem('qaap.mobileProjects.preferDesktopIde'))).toBeNull();

        await app.page.close();
    });
});

test.describe('@qaap-mobile Classic IDE is desktop-only', () => {

    test.use({ viewport: MOBILE_VIEWPORT });

    test('does not offer Open IDE in the mobile command palette', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([SAMPLE_FILES]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await waitForWorkHubReady(app.page);

        await expectOpenIdeNotOffered(app);
        await expectAgentsHubLanding(app.page);

        await app.page.close();
    });
});

test.describe('@qaap-mobile Desktop Work Hub sessions sidebar regression', () => {

    test.use({ viewport: DESKTOP_WORK_HUB_VIEWPORT });

    test('keeps the Work Hub to the right of the sessions sidebar across remounts', async ({ playwright, browser }) => {
        const app = await TheiaAppLoader.load({ playwright, browser });
        try {
            await dismissMobileTutorial(app.page);
            await waitForWorkHubReady(app.page);

            for (let cycle = 0; cycle < 3; cycle++) {
                if (cycle > 0) {
                    await app.page.reload();
                    await app.waitForShellAndInitialized();
                    await dismissMobileTutorial(app.page);
                    await waitForWorkHubReady(app.page);
                }
                await openWorkHubSessionsSidebar(app.page);
                await expectDesktopSessionsSidebarLayout(app.page);

                await app.page.locator('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible button[aria-label="Close"]').click();
                await expect(app.page.locator('body')).not.toHaveClass(/theia-mobile-mod-sessions-sidebar-open/);
            }
        } finally {
            await app.page.close();
        }
    });
});

test.describe('@qaap-mobile Qaap time to preview', () => {

    test.use({ viewport: MOBILE_VIEWPORT });
    test.describe.configure({ timeout: 300_000 });

    test.beforeAll(() => {
        if (!fs.existsSync(path.join(VITE_FIXTURE, 'node_modules'))) {
            execSync('npm install --no-audit --no-fund', {
                cwd: VITE_FIXTURE,
                stdio: 'inherit',
                timeout: 180_000,
                env: { ...process.env, NODE_ENV: 'development' },
            });
        }
    });

    test('opens proxied dev preview within KPI window from classic IDE', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([VITE_FIXTURE]);
        let viteDevServer: ChildProcess | undefined;
        const vitePort = await reserveEphemeralTcpPort();
        try {
            viteDevServer = await startWorkspaceViteDevServer(VITE_FIXTURE, vitePort);

            const app = await TheiaAppLoader.load({ playwright, browser }, ws);
            await app.waitForShellAndInitialized();
            await openDesktopIde(app);
            await waitForBackendDevProbe(app.page, vitePort);

            const started = Date.now();
            await openProxiedDevPreview(app, vitePort);
            await waitForDevPreviewSurface(app);

            const previewFrame = app.page.locator(PREVIEW_FRAME_SELECTOR);
            await expect(previewFrame.first()).toBeAttached({ timeout: 30_000 });

            const elapsed = Date.now() - started;
            expect(elapsed).toBeLessThan(KPI_PREVIEW_MS);

            await app.page.close();
        } finally {
            stopWorkspaceViteDevServer(viteDevServer);
        }
    });
});

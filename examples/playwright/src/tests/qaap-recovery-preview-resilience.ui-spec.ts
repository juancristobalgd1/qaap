// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { TheiaApp } from '../theia-app';
import { TheiaWorkspace } from '../theia-workspace';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../qaap-work-hub-perf-probe-support';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const RESOURCES = path.join(path.resolve(__dirname, '../../src/tests/resources'));
const SAMPLE_FILES = path.join(RESOURCES, 'sample-files1');
const BOOTSTRAP_FIXTURE = path.join(RESOURCES, 'qaap-bootstrap-fixture');
const VITE_FIXTURE = path.join(RESOURCES, 'qaap-vite-fixture');
const DEV_PREVIEW_PORT = 5173;

interface QaapBootstrapProbeState {
    readonly phase?: string;
    readonly previewUrl?: string;
    readonly error?: string;
    readonly needsInstall?: boolean;
    readonly nodeModulesPresent?: boolean;
}

interface QaapBootstrapWindow {
    readonly getState?: () => QaapBootstrapProbeState;
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

async function continueInLocalMode(page: Page): Promise<void> {
    const button = page.getByRole('button', { name: /continue in local mode/i });
    if (await button.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await button.click();
        await expect(page.locator('#qaap-login-host')).toHaveCount(0, { timeout: 15_000 });
    }
}

async function loadQaapApp(page: Page, workspace: TheiaWorkspace): Promise<TheiaApp> {
    workspace.initialize();
    const app = new TheiaApp(page, workspace, false);
    await page.goto('/#' + workspace.pathAsPathComponent);
    await app.waitForShellAndInitialized();
    await continueInLocalMode(page);
    return app;
}

async function openDesktopIdeViaAccountMenu(page: Page): Promise<boolean> {
    const opened = await page.evaluate(() => {
        const account = [...document.querySelectorAll('.theia-workbench-account-btn')].find(
            element => element instanceof HTMLElement && element.offsetParent !== null,
        );
        if (!(account instanceof HTMLElement)) {
            return false;
        }
        account.click();
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
    await app.quickCommandPalette.open();
    const input = app.page.locator(
        '#quick-input-container .monaco-inputbox .input, #quick-input-container .quick-input-and-message input',
    );
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('>');
    await input.pressSequentially('Open IDE', { delay: 25 });

    const clicked = await app.page.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 400));
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
    return app.page.locator('#theia-mobile-bottom-bar').isVisible();
}

async function openDesktopIde(app: TheiaApp): Promise<void> {
    await dismissMobileTutorial(app.page);
    await waitForWorkHubReady(app.page);

    const bottomBar = app.page.locator('#theia-mobile-bottom-bar');
    if (await bottomBar.isVisible()) {
        return;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await openDesktopIdeViaAccountMenu(app.page)
            && await bottomBar.isVisible({ timeout: 5_000 }).catch(() => false)) {
            return;
        }
        if (await openDesktopIdeViaCommandPalette(app)
            && await bottomBar.isVisible({ timeout: 5_000 }).catch(() => false)) {
            return;
        }
        await app.page.waitForTimeout(700);
    }
    await expect(bottomBar).toBeVisible({ timeout: 30_000 });
}

async function waitForTcpListener(port: number): Promise<void> {
    await expect.poll(async () => new Promise<boolean>(resolve => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        const finish = (ready: boolean): void => {
            socket.destroy();
            resolve(ready);
        };
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
    }), { timeout: 10_000 }).toBe(true);
}

async function occupyTcpPort(port: number): Promise<ChildProcess> {
    const script = [
        "const net = require('net');",
        'const server = net.createServer();',
        "server.listen(Number(process.argv[1]), '127.0.0.1');",
        'process.stdin.resume();',
    ].join('');
    const child = spawn(process.execPath, ['-e', script, String(port)], {
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    await waitForTcpListener(port);
    return child;
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

async function waitForBootstrapPhase(page: Page, phase: string): Promise<void> {
    await expect.poll(async () => page.evaluate(expected => {
        const api = (window as unknown as { __qaapBootstrap?: QaapBootstrapWindow }).__qaapBootstrap;
        return api?.getState?.().phase === expected;
    }, phase), { timeout: 60_000 }).toBe(true);
}

async function installTaskRecoverySocket(
    page: Page,
    workspaceCwd: string,
): Promise<{ getConnectionCount: () => number; closeFirst: () => Promise<void> }> {
    let connectionCount = 0;
    let firstSocket: WebSocketRoute | undefined;
    const task = {
        id: 'e2e-interrupted-task',
        cwd: workspaceCwd,
        state: 'interrupted',
        title: 'Recover after browser disconnect',
        command: 'qaap recovery probe',
        agentId: 'qaiq',
        createdAt: Date.now() - 5_000,
        startedAt: Date.now() - 4_000,
        finishedAt: Date.now() - 1_000,
    };

    await page.routeWebSocket('**/qaap/api/agent-tasks/ws', socket => {
        connectionCount++;
        if (!firstSocket) {
            firstSocket = socket;
        }
        socket.send(JSON.stringify({
            type: 'snapshot',
            agentConfigured: true,
            defaultAgent: 'qaiq',
            agents: [{ id: 'qaiq', label: 'QAIQ', available: true }],
            groups: [{ cwd: workspaceCwd, activeCount: 0, tasks: [task] }],
        }));
        socket.send(JSON.stringify({ type: 'heartbeat' }));
    });

    return {
        getConnectionCount: () => connectionCount,
        closeFirst: async () => {
            if (!firstSocket) {
                throw new Error('The recovery WebSocket was never opened.');
            }
            await firstSocket.close({ code: 1000, reason: 'browser disconnect probe' });
        },
    };
}

test.describe('@qaap-mobile recovery and preview resilience', () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    test.describe.configure({ timeout: 300_000 });

    test('reconnects after a disconnect and keeps one persisted task after F5', async ({ browser }) => {
        const page = await browser.newPage();
        await page.addInitScript((key: string) => {
            window.sessionStorage.setItem(key, '1');
        }, QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY);
        const workspace = new TheiaWorkspace([SAMPLE_FILES]);
        const recovery = await installTaskRecoverySocket(page, workspace.path);
        const app = await loadQaapApp(page, workspace);

        try {
            await dismissMobileTutorial(page);
            await waitForWorkHubReady(page);
            await expect.poll(() => recovery.getConnectionCount(), { timeout: 30_000 }).toBeGreaterThan(0);
            await expect.poll(async () => page.evaluate(() => typeof window.__qaapWorkHubPerfProbe !== 'undefined'))
                .toBe(true);
            await page.evaluate(() => window.__qaapWorkHubPerfProbe?.showTasksInboxWithTeamForProbe());

            const transport = page.locator('.theia-mobile-agent-tasks-transport');
            await expect(transport).toHaveClass(/theia-mod-connected/, { timeout: 30_000 });
            const taskRow = page.getByText('Recover after browser disconnect', { exact: true });
            await expect(taskRow).toHaveCount(1, { timeout: 30_000 });
            await expect(page.locator('.theia-mobile-agent-tasks-queue-chip.theia-mod-interrupted'))
                .toContainText('1');

            await recovery.closeFirst();
            await expect.poll(() => recovery.getConnectionCount(), { timeout: 20_000 }).toBeGreaterThan(1);
            await expect(transport).toHaveClass(/theia-mod-connected/, { timeout: 20_000 });
            await expect(taskRow).toHaveCount(1);

            await page.reload({ waitUntil: 'domcontentloaded' });
            await app.waitForShellAndInitialized();
            await dismissMobileTutorial(page);
            await waitForWorkHubReady(page);
            await expect.poll(() => recovery.getConnectionCount(), { timeout: 30_000 }).toBeGreaterThan(2);
            await expect.poll(async () => page.evaluate(() => typeof window.__qaapWorkHubPerfProbe !== 'undefined'))
                .toBe(true);
            await page.evaluate(() => window.__qaapWorkHubPerfProbe?.showTasksInboxWithTeamForProbe());
            await expect(page.getByText('Recover after browser disconnect', { exact: true })).toHaveCount(1, {
                timeout: 30_000,
            });
        } finally {
            await page.close();
        }
    });

    test('surfaces the install action when a project has no dependencies', async ({ browser }) => {
        const page = await browser.newPage();
        const workspace = new TheiaWorkspace([BOOTSTRAP_FIXTURE]);
        const app = await loadQaapApp(page, workspace);

        try {
            await openDesktopIde(app);
            const banner = page.locator('.qaap-project-bootstrap-banner');
            await expect(banner).toBeVisible({ timeout: 30_000 });
            await expect(banner).toHaveAttribute('data-phase', 'detected');
            await expect(banner.getByRole('button', { name: /^install$/i })).toBeVisible();
            await expect.poll(async () => page.evaluate(() => {
                const api = (window as unknown as { __qaapBootstrap?: QaapBootstrapWindow }).__qaapBootstrap;
                return api?.getState?.().nodeModulesPresent === false;
            })).toBe(true);
        } finally {
            await page.close();
        }
    });

    test('recovers Preview to another port when the expected port is occupied', async ({ browser }) => {
        ensureFixtureDeps(VITE_FIXTURE);
        const occupied = await occupyTcpPort(DEV_PREVIEW_PORT);
        const page = await browser.newPage();
        const workspace = new TheiaWorkspace([VITE_FIXTURE]);
        const app = await loadQaapApp(page, workspace);

        try {
            await openDesktopIde(app);
            const banner = page.locator('.qaap-project-bootstrap-banner');
            await expect(banner).toBeVisible({ timeout: 30_000 });
            await expect(banner.getByRole('button', { name: /run & preview|resume preview/i })).toBeVisible();
            await banner.getByRole('button', { name: /run & preview|resume preview/i }).click();

            await expect.poll(async () => page.evaluate(() => {
                const api = (window as unknown as { __qaapBootstrap?: QaapBootstrapWindow }).__qaapBootstrap;
                return api?.getState?.().phase;
            }), { timeout: 90_000 }).toMatch(/running|run-failed/);
            const initialPhase = await page.evaluate(() => {
                const api = (window as unknown as { __qaapBootstrap?: QaapBootstrapWindow }).__qaapBootstrap;
                return api?.getState?.().phase;
            });
            let state = await page.evaluate(() => {
                const api = (window as unknown as { __qaapBootstrap?: QaapBootstrapWindow }).__qaapBootstrap;
                return api?.getState?.();
            });
            if (initialPhase === 'run-failed') {
                expect(state?.phase).toBe('run-failed');
                expect(`${state?.error ?? ''} ${await banner.textContent()}`).toMatch(/5173|port|address|in use/i);
                await expect(banner.getByRole('button', { name: /restart preview/i })).toBeVisible();
                await expect(banner.getByRole('button', { name: /copy diagnostic/i })).toBeVisible();
                occupied.kill();
                await banner.getByRole('button', { name: /restart preview/i }).click();
                await waitForBootstrapPhase(page, 'running');
                state = await page.evaluate(() => {
                    const api = (window as unknown as { __qaapBootstrap?: QaapBootstrapWindow }).__qaapBootstrap;
                    return api?.getState?.();
                });
            }
            expect(state?.previewUrl).toBeTruthy();
            if (initialPhase === 'running') {
                // Identity previews are served from /qaap-preview/<previewId>/, so the recovered
                // port is only visible on the forwarded-port record, never in the URL itself.
                const recoveredPort = state?.forwardedPorts?.find(entry => entry.primary)?.port
                    ?? state?.forwardedPorts?.[0]?.port;
                expect(recoveredPort).toBeGreaterThanOrEqual(5174);
                expect(recoveredPort).toBeLessThanOrEqual(5180);
            }
        } finally {
            await page.close();
            occupied.kill();
        }
    });
});

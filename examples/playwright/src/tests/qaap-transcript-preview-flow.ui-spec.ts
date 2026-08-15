// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execSync } from 'child_process';
import * as fs from 'fs';
import { expect, test } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';
import * as path from 'path';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const RESOURCES = path.join(path.resolve(__dirname, '../../src/tests/resources'));
const VITE_FIXTURE = path.join(RESOURCES, 'qaap-vite-fixture');
const VITE_SUBFOLDER_FIXTURE = path.join(RESOURCES, 'qaap-vite-subfolder-fixture');
const VITE_SUBFOLDER_APP = path.join(VITE_SUBFOLDER_FIXTURE, 'rioja-wines-landing-page');

async function dismissMobileTutorial(page: import('@playwright/test').Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
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

async function expectDevServerClaimReady(
    page: import('@playwright/test').Page,
    projectId: string,
): Promise<void> {
    await expect.poll(async () => {
        const state = await page.evaluate(async (currentProjectId: string) => {
            const currentResponse = await fetch(
                `/qaap-dev/api/current?projectId=${encodeURIComponent(currentProjectId)}`,
                { cache: 'no-store' },
            );
            if (!currentResponse.ok) {
                return false;
            }
            const current = await currentResponse.json() as {
                ready?: boolean;
                port?: number;
                previewUrl?: string;
            };
            return current.ready === true
                && Number.isInteger(current.port)
                && typeof current.previewUrl === 'string';
        }, projectId);
        return state;
    }, { timeout: 180_000 }).toBe(true);
}

async function expectDevPreviewMounted(page: import('@playwright/test').Page): Promise<void> {
    await expect.poll(async () => page.evaluate(() => {
        const onPreview = document.querySelector('[data-active-surface="preview"]') !== null;
        const iframe = document.querySelector(
            'iframe[src*="/qaap-dev/"], iframe[src*="/qaap-preview/"]',
        ) !== null;
        return onPreview && iframe;
    }), { timeout: 60_000 }).toBe(true);
}

async function runLevantaLaAppPreviewFlow(
    page: import('@playwright/test').Page,
    projectId: string,
): Promise<void> {
    await expect(page.locator('.theia-mobile-projects-sticky-composer-input')).toBeVisible({ timeout: 60_000 });
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input');
    await composer.fill('levanta la app');
    await page.getByRole('button', { name: /^send$|^create$/i }).click();
    await expect(page.getByRole('heading', { name: /levanta la app/i })).toBeVisible({ timeout: 60_000 });
    // Product no longer auto-switches to Preview on "levanta la app" — wait for the
    // staged Open preview affordance (or API claim), then navigate explicitly.
    await expectDevServerClaimReady(page, projectId);
    const openPreview = page.getByRole('button', { name: /open preview/i }).first();
    if (await openPreview.count()) {
        await openPreview.click();
    } else {
        // Composer / transcript may expose the same CTA as a link.
        const openLink = page.getByRole('link', { name: /open preview/i }).first();
        await expect(openLink).toBeVisible({ timeout: 30_000 });
        await openLink.click();
    }
    await expectDevPreviewMounted(page);
}

test.describe('@qaap-mobile transcript dev preview flow', () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    test.describe.configure({ timeout: 300_000 });

    test('levanta la app switches to Preview and mounts proxied iframe', async ({ playwright, browser }) => {
        ensureFixtureDeps(VITE_FIXTURE);
        const ws = new TheiaWorkspace([VITE_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await runLevantaLaAppPreviewFlow(app.page, ws.pathAsUrl(''));
        await app.page.close();
    });

    test('levanta la app from orphan scaffold subfolder switches to Preview', async ({ playwright, browser }) => {
        ensureFixtureDeps(VITE_SUBFOLDER_APP);
        expect(fs.existsSync(path.join(VITE_SUBFOLDER_FIXTURE, 'package.json'))).toBe(false);
        const ws = new TheiaWorkspace([VITE_SUBFOLDER_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);
        await runLevantaLaAppPreviewFlow(app.page, ws.pathAsUrl(''));
        await app.page.close();
    });
});

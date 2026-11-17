// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test, type Page } from '@playwright/test';
import * as path from 'path';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';

/** Hover-capable desktop: the actions must be hidden until the bubble is hovered or focused. */
const DESKTOP_WORK_HUB_VIEWPORT = { width: 1200, height: 953 };
/** Wider than the 767px narrow breakpoint, so the inline action row is in use, with a touch pointer. */
const TOUCH_TABLET_VIEWPORT = { width: 1024, height: 768 };
const SAMPLE_FILES = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'sample-files1');

async function dismissMobileTutorial(page: Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

/** Mounts one user bubble with its action row, using the production class names. */
async function mountUserMessageFixture(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.getElementById('qaap-user-actions-fixture')?.remove();
        const host = document.createElement('div');
        host.id = 'qaap-user-actions-fixture';
        host.innerHTML = `
<div class="theia-mobile-agent-transcript-user-wrap" data-testid="user-message-wrap" tabindex="-1">
  <div class="theia-mobile-agent-transcript-msg theia-mod-user">Explain the scroll container</div>
  <div class="theia-mobile-agent-transcript-user-actions">
    <button type="button" class="theia-mobile-agent-transcript-user-action theia-mod-edit" title="Edit" aria-label="Edit">
      <span class="codicon codicon-edit" aria-hidden="true"></span><span class="theia-mobile-agent-transcript-user-action-label">Edit</span>
    </button>
    <button type="button" class="theia-mobile-agent-transcript-user-action theia-mod-copy" title="Copy" aria-label="Copy">
      <span class="codicon codicon-copy" aria-hidden="true"></span><span class="theia-mobile-agent-transcript-user-action-label">Copy</span>
    </button>
  </div>
</div>`;
        // Production rows are direct children of the visible message scroller. Appending to the
        // `real-chat` clip instead lands below the scroller, squeezed under the sticky composer, where
        // a pointer can never reach it.
        const scroller = Array.from(document.querySelectorAll<HTMLElement>('.theia-mobile-agent-transcript-real-chat>.theia-mobile-agent-transcript'))
            .find(element => element.getClientRects().length > 0);
        if (!scroller) {
            throw new Error('No visible transcript scroller to mount the user message fixture in.');
        }
        scroller.prepend(host);
        host.scrollIntoView({ block: 'center' });
    });
}

/** The fixture must be on screen and the topmost element under its centre, or hover tests nothing. */
async function expectFixtureHittable(page: Page): Promise<void> {
    const hit = await page.evaluate(() => {
        const bubble = document.querySelector<HTMLElement>('#qaap-user-actions-fixture .theia-mobile-agent-transcript-msg.theia-mod-user');
        const box = bubble?.getBoundingClientRect();
        if (!bubble || !box || box.width === 0 || box.height === 0) {
            return false;
        }
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !!top && bubble.contains(top);
    });
    expect(hit, 'user message fixture is visible and not covered').toBe(true);
}

async function openWorkHub(playwright: Parameters<typeof TheiaAppLoader.load>[0]['playwright'], browser: Parameters<typeof TheiaAppLoader.load>[0]['browser']): Promise<Page> {
    const ws = new TheiaWorkspace([SAMPLE_FILES]);
    const app = await TheiaAppLoader.load({ playwright, browser }, ws);
    await app.waitForShellAndInitialized();
    await dismissMobileTutorial(app.page);
    await expect(app.page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-input').first()).toBeVisible({ timeout: 60_000 });
    await mountUserMessageFixture(app.page);
    await expectFixtureHittable(app.page);
    return app.page;
}

test.describe('@qaap-mobile transcript user message actions', () => {

    test.use({ viewport: DESKTOP_WORK_HUB_VIEWPORT });

    test('desktop: actions are hidden until hover or keyboard focus, without moving the bubble', async ({ playwright, browser }) => {
        const page = await openWorkHub(playwright, browser);

        const wrap = page.getByTestId('user-message-wrap');
        const bubble = wrap.locator('.theia-mobile-agent-transcript-msg.theia-mod-user');
        const actions = wrap.locator('.theia-mobile-agent-transcript-user-actions');
        const edit = wrap.locator('.theia-mobile-agent-transcript-user-action.theia-mod-edit');

        await page.mouse.move(0, 0);
        await expect(actions).toHaveCSS('opacity', '0');
        const hiddenBox = await bubble.boundingBox();
        const hiddenActionsBox = await actions.boundingBox();
        expect(hiddenActionsBox?.height ?? 0).toBeGreaterThan(0);

        await bubble.hover();
        await expect(actions).toHaveCSS('opacity', '1');
        const hoveredBox = await bubble.boundingBox();
        expect(Math.abs((hoveredBox?.width ?? 0) - (hiddenBox?.width ?? 0))).toBeLessThanOrEqual(0.5);
        expect(Math.abs((hoveredBox?.height ?? 0) - (hiddenBox?.height ?? 0))).toBeLessThanOrEqual(0.5);
        const hoveredActionsBox = await actions.boundingBox();
        expect(Math.abs((hoveredActionsBox?.y ?? 0) - (hiddenActionsBox?.y ?? 0))).toBeLessThanOrEqual(0.5);

        // Keyboard: the hidden row stays in the tab order and reveals itself on focus.
        await page.mouse.move(0, 0);
        await expect(actions).toHaveCSS('opacity', '0');
        await edit.focus();
        await expect(actions).toHaveCSS('opacity', '1');

        await page.close();
    });
});

test.describe('@qaap-mobile transcript user message actions (touch)', () => {

    test.use({ viewport: TOUCH_TABLET_VIEWPORT, hasTouch: true, isMobile: true });

    test('touch pointer: actions stay visible', async ({ playwright, browser }) => {
        const page = await openWorkHub(playwright, browser);

        const coarse = await page.evaluate(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches);
        test.skip(!coarse, 'Emulated pointer is not coarse in this Chromium build; the touch rule cannot be exercised.');

        const actions = page.getByTestId('user-message-wrap').locator('.theia-mobile-agent-transcript-user-actions');
        await expect(actions).toHaveCSS('opacity', '1');

        await page.close();
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect, test } from '@playwright/test';
import { TheiaAppLoader } from '../theia-app-loader';
import { TheiaWorkspace } from '../theia-workspace';
import * as path from 'path';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const VITE_FIXTURE = path.join(path.resolve(__dirname, '../../src/tests/resources'), 'qaap-vite-fixture');
/** Same copy as `QAAP_AGENTS_HUB_QUICK_ACTIONS` `run-app` promptDefault. */
const RUN_APP_PROMPT_TEXT = 'Figure out how to build and run this project locally. '
    + 'Start the dev server, confirm it boots cleanly, and report the URL plus any setup steps I should know.';
const RUN_APP_PROMPT = /figure out how to build and run/i;

async function dismissMobileTutorial(page: import('@playwright/test').Page): Promise<void> {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
    }
}

/**
 * Claude Code (the default harness) holds a send until a model is chosen — the model picker opens — and
 * asks once before the first paid send in a project. Pick the first model, resend, and confirm.
 */
async function acceptComposerSendGuards(page: import('@playwright/test').Page): Promise<void> {
    const picker = page.locator('.qaap-model-picker').first();
    const visible = (locator: import('@playwright/test').Locator): Promise<boolean> =>
        locator.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    if (await visible(picker)) {
        await page.locator('.qaap-model-picker-row:not(:disabled)').first().click();
        await picker.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
        await page.getByRole('button', { name: /^send$|^create$/i }).click();
    }
    const paidConfirm = page.locator('.dialogOverlay .theia-button.main').first();
    if (await visible(paidConfirm)) {
        await paidConfirm.click();
    }
}

test.describe('@qaap-mobile agent auto-continue after exploration stop', () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    test.describe.configure({ timeout: 300_000 });

    test('continues run-app task after search-only agent stop', async ({ playwright, browser }) => {
        const ws = new TheiaWorkspace([VITE_FIXTURE]);
        const app = await TheiaAppLoader.load({ playwright, browser }, ws);
        await app.waitForShellAndInitialized();
        await dismissMobileTutorial(app.page);

        const composer = app.page.locator('.theia-mobile-projects:visible .theia-mobile-projects-sticky-composer-input').first();
        await expect(composer).toBeVisible({ timeout: 60_000 });

        // Run app on the empty transcript launches managed preview (no LLM prompt).
        // Auto-continue still applies when the user sends the run-app task text.
        await composer.fill(RUN_APP_PROMPT_TEXT);
        await expect(composer).toHaveValue(RUN_APP_PROMPT);
        await app.page.getByRole('button', { name: /^send$|^create$/i }).click();
        await acceptComposerSendGuards(app.page);

        const workspaceCwd = ws.path;

        await expect.poll(async () => {
            const state = await app.page.evaluate(async (cwd: string) => {
                const listResponse = await fetch(`/qaap/api/agent-conversations?cwd=${encodeURIComponent(cwd)}`, { credentials: 'include' });
                if (!listResponse.ok) {
                    return { ok: false, reason: 'list-failed' };
                }
                const listBody = await listResponse.json() as { conversations?: Array<{ id: string; updatedAt: number }> };
                const conversations = listBody.conversations ?? [];
                if (!conversations.length) {
                    return { ok: false, reason: 'no-conversation' };
                }
                const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
                const detailResponse = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(latest.id)}`, { credentials: 'include' });
                if (!detailResponse.ok) {
                    return { ok: false, reason: 'detail-failed' };
                }
                const conv = await detailResponse.json() as {
                    status: string;
                    messages: Array<{
                        role: string;
                        content: string;
                        segments?: Array<{ type: string; name?: string; finished?: boolean }>;
                    }>;
                };
                const autoContinue = conv.messages.some(message =>
                    message.role === 'user' && /continue this task now/i.test(message.content));
                const hasBash = conv.messages.some(message =>
                    message.segments?.some(segment =>
                        segment.type === 'tool'
                        && segment.finished
                        && /bash|shell|terminal/i.test(segment.name ?? '')));
                const userTurns = conv.messages.filter(message => message.role === 'user').length;
                const agentStreaming = conv.status === 'streaming' && userTurns > 1;
                return {
                    ok: autoContinue || hasBash || agentStreaming,
                    autoContinue,
                    hasBash,
                    agentStreaming,
                    userTurns,
                    status: conv.status,
                };
            }, workspaceCwd);
            return state;
        }, { timeout: 240_000 }).toMatchObject({ ok: true });

        await app.page.close();
    });
});

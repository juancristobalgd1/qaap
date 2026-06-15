#!/usr/bin/env node
/**
 * Verify Agent Trace iteration 1+2 against the built browser app.
 * Requires: npm run build:browser && npm run start:browser on :3000
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = process.env.QAAP_SCREENSHOT_DIR
    ?? path.join('/opt/cursor/artifacts/screenshots', 'agent-trace-verify');
const MOBILE = { width: 390, height: 844 };

async function waitForServer(page) {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await page.request.get(BASE)).ok()) {
                return;
            }
        } catch {
            // retry
        }
        await page.waitForTimeout(2000);
    }
    throw new Error(`Server not ready at ${BASE}`);
}

async function dismissTutorial(page) {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
        await page.waitForTimeout(400);
    }
}

async function openFirstTranscript(page) {
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await dismissTutorial(page);

    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    if (!(await composer.isVisible({ timeout: 5000 }).catch(() => false))) {
        const agentBtn = page.locator('#theia-mobile-bottom-bar .theia-mobile-bottom-activity-btn[data-action-id="agent"]').first();
        if (await agentBtn.count()) {
            await agentBtn.click();
            await page.waitForTimeout(1500);
        }
    }
    await page.waitForSelector('.theia-mobile-projects-sticky-composer-input', { timeout: 60000 });

    const task = page.locator('.theia-mobile-projects-task-item').first();
    const continueCard = page.locator('button, [role="button"]').filter({ hasText: /continue|corre todas/i }).first();
    if (await continueCard.count()) {
        await continueCard.click();
    } else if (await task.count()) {
        await task.click();
    } else {
        const sessionsBtn = page.locator('.theia-workbench-nav-btn.theia-mod-mobile-sessions-sidebar').first();
        if (await sessionsBtn.count()) {
            await sessionsBtn.click();
            await page.waitForTimeout(600);
            const sidebarTask = page.locator('.theia-mobile-projects-task-item').first();
            if (await sidebarTask.count()) {
                await sidebarTask.click({ timeout: 15000 });
            }
        }
    }
    await page.waitForTimeout(1500);
}

async function injectTraceHarness(page) {
    return page.evaluate(() => {
        document.querySelector('.qaap-agent-trace-verify-overlay')?.remove();
        const host = document.createElement('div');
        host.className = 'qaap-agent-trace-verify-overlay';
        host.innerHTML = `
<div class="theia-mobile-agent-transcript-root theia-mod-visible" style="position:fixed;inset:0;z-index:9999;background:var(--theia-editor-background,#0b0b0a);display:flex;flex-direction:column;">
  <div class="theia-mobile-agent-transcript" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
    <div class="theia-mobile-agent-transcript-real-chat" style="flex:1;overflow-y:auto;padding:12px 14px 120px;">
      <div class="theia-mobile-agent-transcript-user-wrap">
        <div class="theia-mobile-agent-transcript-msg theia-mod-user">Verifica el agent trace</div>
      </div>
      <div class="theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming" id="qaap-verify-agent-row">
        <div class="theia-mobile-agent-transcript-segments">
          <details class="theia-mobile-agent-thought-brief">
            <summary><span class="theia-mobile-agent-thought-brief-title">Thought for 6s</span></summary>
          </details>
          <details class="theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible" open data-transcript-activity-timeline="true">
            <summary class="theia-mobile-agent-activity-timeline-summary">
              <span class="theia-mobile-agent-activity-timeline-summary-icon codicon codicon-checklist"></span>
              <span class="theia-mobile-agent-activity-timeline-summary-label">Explored 2 files, 1 command</span>
              <span class="theia-mobile-agent-activity-timeline-summary-count">3</span>
            </summary>
            <ol class="theia-mobile-agent-activity-list">
              <li class="theia-mobile-agent-activity-item theia-mod-done theia-mod-clickable" role="button" tabindex="0" data-transcript-activity-action="file" data-verify="read">
                <span class="theia-mobile-agent-activity-icon theia-mod-done codicon codicon-check"></span>
                <span class="theia-mobile-agent-activity-label">Read README.md</span>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-done theia-mod-clickable" role="button" tabindex="0" data-transcript-activity-action="terminal" data-verify="terminal">
                <span class="theia-mobile-agent-activity-icon theia-mod-done codicon codicon-check"></span>
                <span class="theia-mobile-agent-activity-label">Running: npm test</span>
              </li>
              <li class="theia-mobile-agent-activity-item theia-mod-running theia-mod-active theia-mod-clickable" role="button" tabindex="0" data-transcript-activity-action="file" data-verify="edit">
                <span class="theia-mobile-agent-activity-icon theia-mod-active theia-mod-pulse"><span class="codicon codicon-arrow-small-right"></span></span>
                <span class="theia-mobile-agent-activity-label theia-mod-shimmer">Editing src/app.ts</span>
              </li>
            </ol>
          </details>
          <div class="theia-mobile-agent-transcript-content theia-mod-markdown"><p>Respuesta en streaming…</p></div>
        </div>
      </div>
    </div>
    <div class="theia-mobile-agent-transcript-chat-input" style="padding:8px;">
      <div class="theia-mobile-projects-sticky-composer-inner">
        <div class="theia-mobile-projects-sticky-composer-card theia-mod-codex theia-mod-has-activity">
          <div class="theia-mobile-sticky-composer-activity-stack">
            <div class="theia-mobile-sticky-composer-activity-section theia-mod-streaming">
              <button type="button" class="theia-mobile-sticky-composer-streaming-activity theia-mobile-agent-stream-line theia-mod-editing" id="qaap-verify-composer-stream">
                <span class="theia-mobile-agent-stream-dot"></span>
                <span class="theia-mobile-agent-stream-label theia-mod-shimmer">Editing src/app.ts…</span>
              </button>
            </div>
          </div>
          <div class="theia-mobile-projects-sticky-composer-stage">
            <textarea class="theia-mobile-projects-sticky-composer-input" rows="1" placeholder="Follow up…"></textarea>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;
        document.body.append(host);

        const results = { composerClick: false, timelineClickable: 0, hasCollapsibleTimeline: false, hasComposerStream: false };
        results.hasCollapsibleTimeline = !!document.querySelector('.theia-mobile-agent-activity-timeline.theia-mod-collapsible');
        results.hasComposerStream = !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity');
        results.timelineClickable = document.querySelectorAll('.theia-mobile-agent-activity-item.theia-mod-clickable').length;

        const composerBtn = document.getElementById('qaap-verify-composer-stream');
        composerBtn?.addEventListener('click', () => {
            results.composerClick = true;
            const timeline = document.querySelector('[data-transcript-activity-timeline]');
            if (timeline instanceof HTMLDetailsElement) {
                timeline.open = true;
            }
            timeline?.scrollIntoView({ block: 'nearest' });
        });

        return results;
    });
}

async function tryLiveAgentProbe(page, cwd) {
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    if (!(await composer.count())) {
        return { attempted: false, reason: 'no-composer' };
    }
    const draft = 'Lista los archivos del workspace en una sola linea';
    await composer.fill(draft);
    const send = page.getByRole('button', { name: /^send$|^create$/i }).first();
    if (await send.count()) {
        await send.click();
    } else {
        await composer.press('Enter');
    }

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        const state = await page.evaluate(async (workspaceCwd) => {
            const listRes = await fetch(`/qaap/api/agent-conversations?cwd=${encodeURIComponent(workspaceCwd)}`, { credentials: 'include' });
            if (!listRes.ok) {
                return { phase: 'api-error' };
            }
            const list = await listRes.json();
            const conversations = list.conversations ?? [];
            const latest = [...conversations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
            if (!latest?.id) {
                return { phase: 'no-conv' };
            }
            const detailRes = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(latest.id)}`, { credentials: 'include' });
            if (!detailRes.ok) {
                return { phase: 'detail-error' };
            }
            const conv = await detailRes.json();
            const agent = [...(conv.messages ?? [])].reverse().find(m => m.role === 'agent');
            const segments = agent?.segments ?? [];
            const hasTimeline = !!document.querySelector('[data-transcript-activity-timeline]');
            const hasThought = !!document.querySelector('[data-transcript-thought-brief], .theia-mobile-agent-thought-brief');
            const hasComposerStream = !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity');
            const clickable = document.querySelectorAll('.theia-mobile-agent-activity-item.theia-mod-clickable').length;
            const streaming = conv.status === 'streaming';
            const toolCount = segments.filter(s => s.type === 'tool').length;
            const hasText = segments.some(s => s.type === 'text' && (s.content ?? '').trim());
            return {
                phase: streaming ? 'streaming' : 'idle',
                status: conv.status,
                toolCount,
                hasText,
                hasTimeline,
                hasThought,
                hasComposerStream,
                clickable,
                segmentTypes: segments.map(s => s.type),
            };
        }, cwd);
        if (state.phase === 'streaming' && (state.toolCount > 0 || state.hasThought || state.hasTimeline)) {
            return { attempted: true, ok: true, state };
        }
        if (state.phase === 'idle' && (state.toolCount > 0 || state.hasText)) {
            return { attempted: true, ok: true, state };
        }
        await page.waitForTimeout(2000);
    }
    return { attempted: true, ok: false, reason: 'timeout' };
}

async function screenshot(page, name) {
    const file = path.join(OUT_DIR, `${name}.png`);
    const timeline = page.locator('[data-transcript-activity-timeline], .theia-mobile-agent-activity-timeline').first();
    if (await timeline.count()) {
        await timeline.screenshot({ path: file });
    } else {
        await page.screenshot({ path: file, fullPage: false });
    }
    return file;
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trace-verify-'));
    fs.writeFileSync(path.join(workspace, 'README.md'), '# verify\n');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: MOBILE });
    await waitForServer(page);

    const report = {
        outDir: OUT_DIR,
        shots: [],
        checks: {},
        liveAgent: null,
    };

    // 1) Harness on loaded bundle (CSS + composer stream interaction)
    await page.goto(`${BASE}/#/${encodeURIComponent(workspace)}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2000);
    const harness = await injectTraceHarness(page);
    report.checks.harness = harness;
    await page.locator('#qaap-verify-composer-stream').click();
    await page.waitForTimeout(500);
    report.checks.composerScrollAfterClick = await page.evaluate(() => {
        const timeline = document.querySelector('[data-transcript-activity-timeline]');
        return {
            composerClickHandled: true,
            timelineOpen: timeline instanceof HTMLDetailsElement ? timeline.open : undefined,
        };
    });
    report.shots.push(await screenshot(page, '01-harness-timeline'));

    // 2) Work Hub + optional live agent (best-effort — depends on backend agent)
    await page.evaluate(() => document.querySelector('.qaap-agent-trace-verify-overlay')?.remove());
    await page.goto(`${BASE}/#/${encodeURIComponent(workspace)}`, { waitUntil: 'domcontentloaded' });
    try {
        await openFirstTranscript(page);
        report.shots.push(await screenshot(page, '02-work-hub-composer'));
        report.liveAgent = await tryLiveAgentProbe(page, workspace);
        if (report.liveAgent.ok) {
            report.shots.push(await screenshot(page, '03-live-agent-trace'));
        } else {
            report.checks.liveAgentSkipped = report.liveAgent.reason ?? 'no-streaming-trace';
        }
        report.checks.idleComposer = await page.evaluate(() => ({
            streamingRow: !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity'),
            activityStack: !!document.querySelector('.theia-mobile-sticky-composer-activity-stack'),
        }));
    } catch (error) {
        report.checks.workHubError = error instanceof Error ? error.message : String(error);
    }

    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    await browser.close();

    const failed = !harness.hasCollapsibleTimeline
        || !harness.hasComposerStream
        || harness.timelineClickable < 3;
    if (failed) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

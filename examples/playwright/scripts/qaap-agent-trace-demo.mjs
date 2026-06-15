#!/usr/bin/env node
/**
 * Capture Agent Trace / Activity Timeline screenshots from the built browser app.
 *
 * Usage (from repo root):
 *   npm run build:browser && npm run start:browser
 *   node examples/playwright/scripts/qaap-agent-trace-demo.mjs
 *
 * Env: QAAP_BASE_URL (default http://127.0.0.1:3000), QAAP_SCREENSHOT_DIR
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = process.env.QAAP_SCREENSHOT_DIR
    ?? path.join(process.cwd(), 'test-results', 'agent-trace-demo');

function activityItem(state, label, active = false, stalled = false) {
    const activeClass = active ? ' theia-mod-active' : '';
    const shimmer = active && !stalled ? ' theia-mod-shimmer' : '';
    const stall = active && stalled ? ' theia-mod-stall' : '';
    let icon;
    if (active) {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-active theia-mod-pulse" aria-hidden="true"><span class="codicon codicon-arrow-small-right" aria-hidden="true"></span></span>';
    } else if (state === 'done') {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-done codicon codicon-check" aria-hidden="true"></span>';
    } else {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-pending" aria-hidden="true"></span>';
    }
    return `<li class="theia-mobile-agent-activity-item theia-mod-${state}${activeClass}">${icon}<span class="theia-mobile-agent-activity-label${shimmer}${stall}">${label}</span></li>`;
}

function buildTimeline(items, { stalled = false, collapsed = false } = {}) {
    const list = items.map((item, i) => activityItem(item.state, item.label, item.active ?? i === items.findIndex(x => x.active), stalled)).join('');
    const summary = items.length > 0 ? 'Explored 3 files, 2 commands' : 'Activity';
    return `
<details class="theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible${stalled ? ' theia-mod-stalled' : ''}" aria-label="Activity"${collapsed ? '' : ' open'}>
  <summary class="theia-mobile-agent-activity-timeline-summary">
    <span class="theia-mobile-agent-activity-timeline-summary-icon codicon codicon-checklist" aria-hidden="true"></span>
    <span class="theia-mobile-agent-activity-timeline-summary-label">${summary}</span>
    <span class="theia-mobile-agent-activity-timeline-summary-count">${items.length}</span>
  </summary>
  <ol class="theia-mobile-agent-activity-list">${list}</ol>
</details>`;
}

function buildThoughtBrief({ live = false, title, meta }) {
    return `
<details class="theia-mobile-agent-thought-brief${live ? ' theia-mod-thinking-live' : ''}" open>
  <summary>
    <span class="theia-mobile-agent-thought-brief-glyph codicon codicon-lightbulb" aria-hidden="true"></span>
    <span class="theia-mobile-agent-thought-brief-title">${title}</span>
  </summary>
  ${meta ? `<div class="theia-mobile-agent-thought-brief-meta">${meta}</div>` : ''}
</details>`;
}

function buildAgentRow({ thought, timeline, streamLine, text, artifacts = '' }) {
    return `
<div class="theia-mobile-agent-transcript-msg theia-mod-agent theia-mod-streaming">
  <div class="theia-mobile-agent-transcript-segments">
    ${thought ?? ''}
    ${timeline ?? ''}
    ${text ? `<div class="theia-mobile-agent-transcript-content theia-mod-markdown theia-mod-streaming-incremental-markdown">${text}</div>` : ''}
    ${artifacts ? `<div class="theia-mobile-agent-transcript-artifacts">${artifacts}</div>` : ''}
    ${streamLine ?? ''}
  </div>
</div>`;
}

function buildStreamLine(kind, label, stalled = false) {
    const shimmer = !stalled && (kind === 'thinking' || kind === 'planning') ? ' theia-mod-shimmer' : '';
    const stall = stalled ? ' theia-mod-stall' : '';
    return `
<div class="theia-mobile-agent-stream-line theia-mod-${kind}">
  <span class="theia-mobile-agent-stream-dot" aria-hidden="true"></span>
  <span class="theia-mobile-agent-stream-label${shimmer}${stall}">${label}…</span>
  <span class="theia-mobile-agent-stream-meta">· 18s · ~1.2k tokens</span>
</div>`;
}

function buildTranscriptShell(innerRows) {
    return `
<div class="theia-mobile-agent-transcript-root theia-mod-visible" style="position:fixed;inset:0;z-index:9999;background:var(--theia-editor-background,#0b0b0a);display:flex;flex-direction:column;">
  <div class="theia-mobile-agent-transcript theia-mod-sheet-mounted" style="flex:1;display:flex;flex-direction:column;min-height:0;">
    <div class="theia-mobile-agent-transcript-real-chat" style="flex:1;overflow-y:auto;padding:12px 14px 96px;">
      <div class="theia-mobile-agent-transcript-user-wrap">
        <div class="theia-mobile-agent-transcript-msg theia-mod-user">Refactoriza el módulo de autenticación y añade tests</div>
      </div>
      ${innerRows}
    </div>
  </div>
</div>`;
}

const DEMOS = {
    thinking: buildTranscriptShell(buildAgentRow({
        thought: buildThoughtBrief({ live: true, title: 'Thinking for 12s', meta: '' }),
        streamLine: buildStreamLine('thinking', 'Thinking for 12s'),
    })),
    tools: buildTranscriptShell(buildAgentRow({
        thought: buildThoughtBrief({ title: 'Thought for 8s', meta: 'Explored 3 files, 2 commands' }),
        timeline: buildTimeline([
            { state: 'done', label: 'Read auth/service.ts' },
            { state: 'done', label: 'Running: npm test -- auth' },
            { state: 'running', label: 'Editing auth/login.ts', active: true },
        ]),
        text: '<p>Voy a extraer la validación de tokens a un módulo compartido y añadir cobertura en los tests existentes.</p>',
    })),
    stalled: buildTranscriptShell(buildAgentRow({
        thought: buildThoughtBrief({ title: 'Thought for 22s', meta: 'Explored 4 files, 3 commands' }),
        timeline: buildTimeline([
            { state: 'done', label: 'Read package.json' },
            { state: 'done', label: 'Running: npm run compile' },
            { state: 'running', label: 'Taking longer than expected', active: true },
        ], { stalled: true }),
        streamLine: buildStreamLine('stall', 'Taking longer than expected', true),
    })),
    complete: buildTranscriptShell(`
<div class="theia-mobile-agent-transcript-msg theia-mod-agent">
  <div class="theia-mobile-agent-transcript-segments">
    ${buildThoughtBrief({ title: 'Explored the workspace', meta: 'Explored 4 files, 2 commands' })}
    ${buildTimeline([
        { state: 'done', label: 'Read auth/service.ts' },
        { state: 'done', label: 'Running: npm test' },
        { state: 'done', label: 'Edited auth/login.ts' },
        { state: 'done', label: 'Writing response' },
    ], { collapsed: true })}
    <div class="theia-mobile-agent-transcript-content theia-mod-markdown">
      <p>Listo: moví la validación a <code>auth/token-validator.ts</code> y añadí 6 tests. Puedes revisar los cambios en la pestaña <strong>Files</strong>.</p>
    </div>
    <div class="theia-mobile-agent-transcript-artifacts">
      <details class="theia-mobile-agent-tool-group"><summary class="theia-mobile-agent-tool-group-head"><span class="theia-mobile-agent-tool-group-label">Ran 2 commands, edited 1 file</span></summary></details>
    </div>
  </div>
</div>`),
};

async function waitForServer(page) {
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const res = await page.request.get(BASE);
            if (res.ok()) {
                return;
            }
        } catch {
            // retry
        }
        await page.waitForTimeout(2000);
    }
    throw new Error(`Server not ready at ${BASE}`);
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trace-demo-'));
    fs.writeFileSync(path.join(workspace, 'README.md'), '# demo\n');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await waitForServer(page);

    const url = `${BASE}/#/${encodeURIComponent(workspace)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(3000);

    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
        await page.waitForTimeout(500);
    }

    const shots = [];
    for (const [name, html] of Object.entries(DEMOS)) {
        await page.evaluate(demoHtml => {
            document.querySelector('.qaap-agent-trace-demo-overlay')?.remove();
            const host = document.createElement('div');
            host.className = 'qaap-agent-trace-demo-overlay';
            host.innerHTML = demoHtml;
            document.body.append(host);
        }, html);
        await page.waitForTimeout(800);
        const file = path.join(OUT_DIR, `${name}.png`);
        const clip = await page.evaluate(() => {
            const root = document.querySelector('.theia-mobile-agent-transcript-root');
            if (!root) {
                return undefined;
            }
            const rect = root.getBoundingClientRect();
            return {
                x: Math.max(0, rect.x),
                y: Math.max(0, rect.y),
                width: Math.min(rect.width, window.innerWidth),
                height: Math.min(rect.height, window.innerHeight),
            };
        });
        if (clip) {
            await page.screenshot({ path: file, clip });
        } else {
            await page.screenshot({ path: file, fullPage: false });
        }
        shots.push(file);
        console.log(`saved ${file}`);
    }

    await browser.close();
    console.log(JSON.stringify({ outDir: OUT_DIR, shots }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

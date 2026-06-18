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

function activityItem(item, active = false, stalled = false) {
    const state = item.state;
    const activeClass = active ? ' theia-mod-active' : '';
    const shimmer = active && !stalled ? ' theia-mod-shimmer' : '';
    const stall = active && stalled ? ' theia-mod-stall' : '';
    const tier = item.tier ?? (active ? 'current' : 'recent');
    const tierClass = ` theia-mod-timeline-${tier}`;
    const currentAttr = active ? ' aria-current="step" data-transcript-activity-active="true"' : '';
    let icon;
    if (item.cursor) {
        icon = '';
    } else if (active) {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-active theia-mod-pulse" aria-hidden="true"><span class="codicon codicon-arrow-small-right" aria-hidden="true"></span></span>';
    } else if (state === 'success' || state === 'done') {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-success codicon codicon-check" aria-hidden="true"></span>';
    } else if (state === 'error') {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-error codicon codicon-error" aria-hidden="true"></span>';
    } else {
        icon = '<span class="theia-mobile-agent-activity-icon theia-mod-pending" aria-hidden="true"></span>';
    }
    const copy = item.cursor
        ? `<div class="theia-mobile-agent-activity-copy">
            <span class="theia-mobile-agent-activity-row${shimmer}${stall}">
              <span class="theia-mobile-agent-activity-verb">${item.verb}</span>
              <span class="theia-mobile-agent-activity-detail"> ${item.detail}</span>
              ${item.diff ? `<span class="theia-mobile-agent-activity-diff-stats"><span class="theia-mobile-agent-activity-diff-add">+${item.diff.add}</span><span class="theia-mobile-agent-activity-diff-remove">−${item.diff.remove}</span></span>` : ''}
              ${item.tail ? `<span class="theia-mobile-agent-activity-tail"> ${item.tail}</span>` : ''}
            </span>
            ${item.meta ? `<span class="theia-mobile-agent-activity-meta">${item.meta}</span>` : ''}
            ${item.error ? `<span class="theia-mobile-agent-activity-narrative theia-mod-error"><span class="theia-mobile-agent-activity-narrative-label">What:</span><span class="theia-mobile-agent-activity-narrative-value">${item.error}</span></span>` : ''}
            ${item.recovery ? `<span class="theia-mobile-agent-activity-narrative theia-mod-recovery"><span class="theia-mobile-agent-activity-narrative-label">Recovery:</span><span class="theia-mobile-agent-activity-narrative-value">${item.recovery}</span></span>` : ''}
          </div>`
        : `<div class="theia-mobile-agent-activity-copy"><span class="theia-mobile-agent-activity-label${shimmer}${stall}">${item.label}</span></div>`;
    return `<li class="theia-mobile-agent-activity-item theia-mod-${state}${activeClass}${tierClass}"${currentAttr}>${icon}${copy}</li>`;
}

function buildTimeline(items, { stalled = false, collapsed = false } = {}) {
    const list = items.map((item, i) => activityItem(item, item.active ?? i === items.findIndex(x => x.active), stalled)).join('');
    const active = items.find(item => item.active) ?? items.find(item => item.state === 'running');
    const activeLabel = active?.label ?? (active?.verb && active?.detail ? `${active.verb} ${active.detail}` : undefined);
    const summary = activeLabel ?? (items.length > 0 ? 'Explored 3 files, 2 commands' : 'Activity');
    return `
<details class="theia-mobile-agent-premium-card theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible theia-mod-cursor-trace${stalled ? ' theia-mod-stalled' : ''}" aria-label="Activity"${collapsed ? '' : ' open'}>
  <summary class="theia-mobile-agent-activity-timeline-summary">
    <span class="theia-mobile-agent-activity-timeline-summary-icon codicon codicon-checklist" aria-hidden="true"></span>
    <span class="theia-mobile-agent-activity-timeline-summary-label">${summary}</span>
    <span class="theia-mobile-agent-activity-timeline-summary-count">${items.length}</span>
  </summary>
  <div class="theia-mobile-agent-activity-timeline-open-panel"><ol class="theia-mobile-agent-activity-list">${list}</ol></div>
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
    ${streamLine ?? ''}
    ${text ? `<div class="theia-mobile-agent-transcript-content theia-mod-markdown theia-mod-streaming-incremental-markdown">${text}</div>` : ''}
    ${artifacts ? `<div class="theia-mobile-agent-transcript-artifacts">${artifacts}</div>` : ''}
  </div>
</div>`;
}

function buildTraceStatus(label, stalled = false) {
    return `<div class="theia-mobile-agent-trace-status${stalled ? ' theia-mod-stall' : ' theia-mod-live'}">${label}</div>`;
}

function terminalPill({ failed = false, preview = 'output: 218 passing' } = {}) {
    return `
<details class="theia-mobile-agent-tool-pill theia-mod-terminal ${failed ? 'theia-mod-failed' : 'theia-mod-done'}">
  <summary class="theia-mobile-agent-tool-pill-summary">
    <span class="theia-mobile-agent-tool-pill-chevron codicon codicon-chevron-right" aria-hidden="true"></span>
    <span class="theia-mobile-agent-tool-pill-icon codicon codicon-terminal" aria-hidden="true"></span>
    <span class="theia-mobile-agent-tool-pill-verb">${failed ? 'Failed' : 'Ran'}</span>
    <span class="theia-mobile-agent-tool-pill-label">npm test</span>
    <span class="theia-mobile-agent-tool-pill-result-preview">${preview}</span>
  </summary>
</details>`;
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
        thought: buildThoughtBrief({ live: true, title: 'Planning next step · 12s', meta: '' }),
        streamLine: buildStreamLine('thinking', 'Planning next step'),
    })),
    tools: buildTranscriptShell(buildAgentRow({
        thought: buildThoughtBrief({ title: 'Thought for 8s', meta: 'Explored 3 files, 2 commands' }),
        timeline: buildTimeline([
            { state: 'success', cursor: true, verb: 'Read', detail: 'auth/service.ts', meta: '1.1s', tier: 'history' },
            { state: 'success', cursor: true, verb: 'Ran', detail: 'npm test -- auth', meta: '4.2s', tail: 'terminal' },
            { state: 'running', cursor: true, verb: 'Editing', detail: 'auth/login.ts', meta: '12s', diff: { add: 18, remove: 3 }, active: true },
        ]),
        streamLine: buildTraceStatus('Running shell · 12s'),
        text: '<p>Voy a extraer la validación de tokens a un módulo compartido y añadir cobertura en los tests existentes.</p>',
        artifacts: terminalPill(),
    })),
    stalled: buildTranscriptShell(buildAgentRow({
        thought: buildThoughtBrief({ title: 'Thought for 22s', meta: 'Explored 4 files, 3 commands' }),
        timeline: buildTimeline([
            { state: 'success', cursor: true, verb: 'Read', detail: 'package.json', meta: '0.7s', tier: 'history' },
            { state: 'error', cursor: true, verb: 'Failed', detail: 'npm run compile', meta: '3.4s', error: 'Port 3000 already in use' },
            { state: 'retrying', cursor: true, verb: 'Retrying', detail: 'npm run compile', meta: '18s', recovery: 'Retrying after: Port 3000 already in use', active: true },
        ], { stalled: true }),
        streamLine: buildTraceStatus('Taking longer than expected', true),
        artifacts: terminalPill({ failed: true, preview: 'failed: Error: port in use' }),
    })),
    complete: buildTranscriptShell(`
<div class="theia-mobile-agent-transcript-msg theia-mod-agent">
  <div class="theia-mobile-agent-transcript-segments">
    ${buildThoughtBrief({ title: 'Explored the workspace', meta: 'Explored 4 files, 2 commands' })}
    ${buildTimeline([
        { state: 'success', cursor: true, verb: 'Read', detail: 'auth/service.ts', meta: '0.9s', tier: 'history' },
        { state: 'success', cursor: true, verb: 'Ran', detail: 'npm test', meta: '8.2s', tail: 'terminal' },
        { state: 'success', cursor: true, verb: 'Edited', detail: 'auth/login.ts', meta: '1.8s', diff: { add: 24, remove: 6 } },
        { state: 'success', cursor: true, verb: 'Wrote', detail: 'response', meta: 'now' },
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

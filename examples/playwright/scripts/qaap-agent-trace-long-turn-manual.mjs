#!/usr/bin/env node
/**
 * Kick off a real long agent turn for manual Agent Trace validation (50+ tools, subagent).
 *
 * Usage:
 *   npm run build:browser && npm run start:browser
 *   QAAP_HEADLESS=0 node examples/playwright/scripts/qaap-agent-trace-long-turn-manual.mjs
 *
 * Env:
 *   QAAP_BASE_URL      default http://127.0.0.1:3000
 *   QAAP_WORKSPACE     default repo root (cwd)
 *   QAAP_HEADLESS      set to 0 for headed browser (recommended for manual QA)
 *   QAAP_SCREENSHOT_DIR  default $TMPDIR/qaap-agent-trace-long-turn
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const WORKSPACE = path.resolve(process.env.QAAP_WORKSPACE ?? process.cwd());
const OUT_DIR = process.env.QAAP_SCREENSHOT_DIR
    ?? path.join(os.tmpdir(), 'qaap-agent-trace-long-turn');
const HEADLESS = process.env.QAAP_HEADLESS !== '0';
const MOBILE = { width: 390, height: 844 };

const LONG_TURN_PROMPT = [
    'Validación UI Agent Trace (solo lectura, no modifiques archivos):',
    '',
    '1) Lanza un subagente hijo (spawn_agent / task / agent) que liste recursivamente los .ts en packages/qaap-mobile-shell/src/common.',
    '2) Luego ejecuta al menos 50 tool calls de lectura separados: uno por archivo .ts en packages/qaap-mobile-shell/src/browser (glob + read/list, sin batch).',
    '3) Termina con una sola línea: cuántas herramientas ejecutaste.',
].join('\n');

const MANUAL_CHECKLIST = [
    { id: 'LT-01', when: '≥20 tools', check: 'Timeline colapsado: fila "+N earlier steps" (theia-mod-history-gap) visible' },
    { id: 'LT-02', when: '≥48 tools', check: 'Lista .theia-mod-virtualized; gap before/after si aplica' },
    { id: 'LT-03', when: 'gap visible', check: 'Tap/Enter en gap expande steps ocultos' },
    { id: 'LT-04', when: 'subagent', check: 'Fila .theia-mod-subagent-root + hijos .theia-mod-nest-1 indentados' },
    { id: 'LT-05', when: 'streaming', check: 'Composer stream line (.theia-mobile-sticky-composer-streaming-activity) = step activo' },
    { id: 'LT-06', when: 'scroll arriba', check: 'FAB ↓ (.theia-mobile-agent-transcript-scroll-to-bottom) y autoscroll al activo' },
    { id: 'LT-07', when: 'timeline abierto', check: 'Sticky bar del summary visible al hacer scroll (open-panel)' },
    { id: 'LT-08', when: 'viewport ≤767px', check: 'Pan vertical con dedo en chat + lista timeline (touch scroll)' },
    { id: 'LT-09', when: 'edits reales', check: 'Card details.theia-mobile-agent-changed-files (opcional si el turno edita)' },
];

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
        await skip.click({ force: true });
        await page.waitForTimeout(400);
    }
}

async function resolvePageWorkspaceCwd(page) {
    return page.evaluate(() => {
        const raw = window.location.hash.replace(/^#\/?/, '');
        if (!raw) {
            return undefined;
        }
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    });
}

async function evaluateTraceMetrics(page, cwd) {
    return page.evaluate(async (workspaceCwd) => {
        const fetchList = async (queryCwd) => {
            const url = queryCwd
                ? `/qaap/api/agent-conversations?cwd=${encodeURIComponent(queryCwd)}`
                : '/qaap/api/agent-conversations';
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                return { ok: false, status: res.status };
            }
            const body = await res.json();
            return { ok: true, conversations: body.conversations ?? [] };
        };
        let list = workspaceCwd ? await fetchList(workspaceCwd) : { ok: false };
        if (!list.ok || list.conversations.length === 0) {
            list = await fetchList(undefined);
        }
        if (!list.ok) {
            return { phase: 'api-error' };
        }
        const latest = [...list.conversations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
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
        const tools = segments.filter(s => s.type === 'tool');
        const nested = tools.filter(s => s.parentToolUseId);
        const dom = {
            hasTimeline: !!document.querySelector('[data-transcript-activity-timeline]'),
            timelineOpen: (() => {
                const el = document.querySelector('[data-transcript-activity-timeline]');
                return el instanceof HTMLDetailsElement ? el.open : undefined;
            })(),
            stepCount: document.querySelectorAll('.theia-mobile-agent-activity-item:not(.theia-mod-history-gap)').length,
            gapRows: document.querySelectorAll('.theia-mobile-agent-activity-item.theia-mod-history-gap').length,
            virtualized: !!document.querySelector('.theia-mobile-agent-activity-list.theia-mod-virtualized'),
            subagentRoot: !!document.querySelector('.theia-mod-subagent-root'),
            nestIndent: document.querySelectorAll('.theia-mod-nest-1').length,
            composerStream: !!document.querySelector('.theia-mobile-sticky-composer-streaming-activity'),
            scrollFab: !!document.querySelector('.theia-mobile-agent-transcript-scroll-to-bottom.theia-mod-visible, .theia-mobile-agent-transcript-scroll-to-bottom:not([hidden])'),
            stickyBar: !!document.querySelector('.theia-mobile-agent-activity-timeline-sticky-bar'),
        };
        return {
            phase: conv.status === 'streaming' ? 'streaming' : 'idle',
            status: conv.status,
            conversationId: latest.id,
            toolCount: tools.length,
            nestedToolCount: nested.length,
            dom,
        };
    }, cwd);
}

async function screenshotTrace(page, name) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${name}.png`);
    const timeline = page.locator('[data-transcript-activity-timeline], .theia-mobile-agent-transcript-real-chat').first();
    if (await timeline.count()) {
        await timeline.screenshot({ path: file });
    } else {
        await page.screenshot({ path: file, fullPage: false });
    }
    return file;
}

async function openLiveTranscriptIfNeeded(page) {
    const hasTranscript = await page.evaluate(() => (
        !!document.querySelector('.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-agent-transcript-real-chat')
    ));
    if (hasTranscript) {
        return true;
    }
    const task = page.locator('.theia-mobile-projects-task-item').first();
    if (await task.count()) {
        await task.click({ force: true });
        await page.waitForTimeout(1200);
    }
    return page.evaluate(() => (
        !!document.querySelector('.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-agent-transcript-real-chat')
    ));
}

async function submitLongTurnPrompt(page) {
    await page.waitForSelector('.theia-mobile-projects-sticky-composer-input', { timeout: 60000 });
    const emptyAction = page.locator('.theia-mobile-agent-transcript-empty-action').first();
    if (await emptyAction.count()) {
        await emptyAction.click({ force: true });
        await page.waitForTimeout(600);
    }
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    await composer.click({ force: true });
    await composer.fill(LONG_TURN_PROMPT);
    await page.waitForTimeout(300);
    const readySend = page.locator('.theia-mobile-projects-sticky-composer-send.theia-mod-ready').first();
    if (await readySend.count()) {
        await readySend.click({ force: true });
    } else {
        await page.locator('.theia-mobile-projects-sticky-composer-send:not([disabled])').first()
            .click({ force: true }).catch(() => composer.press('Enter'));
    }
}

function printChecklist() {
    console.log('\n=== Manual checklist (marca PASS/FAIL mientras corre el turno) ===\n');
    for (const item of MANUAL_CHECKLIST) {
        console.log(`[ ] ${item.id} (${item.when}): ${item.check}`);
    }
    console.log('');
}

async function launchBrowser() {
    const opts = { headless: HEADLESS, slowMo: HEADLESS ? 0 : 80 };
    if (process.env.PW_CHANNEL === 'chrome' || (process.platform === 'darwin' && process.env.PW_CHANNEL !== 'bundled')) {
        return chromium.launch({ ...opts, channel: 'chrome' });
    }
    try {
        return await chromium.launch(opts);
    } catch {
        console.warn('Chromium bundled missing — retrying with system Chrome.');
        return chromium.launch({ ...opts, channel: 'chrome' });
    }
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    printChecklist();

    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: MOBILE });
    await waitForServer(page);

    const url = `${BASE}/#/${encodeURIComponent(WORKSPACE)}`;
    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
    await page.waitForTimeout(2000);
    await dismissTutorial(page);

    const cwd = (await resolvePageWorkspaceCwd(page)) || WORKSPACE;
    console.log(`Workspace cwd: ${cwd}`);
    console.log('Sending long-turn prompt…\n');

    await submitLongTurnPrompt(page);
    await openLiveTranscriptIfNeeded(page);
    await page.waitForTimeout(2000);

    if (cwd !== WORKSPACE && !cwd.endsWith(path.basename(WORKSPACE))) {
        console.warn(`⚠ Workspace activo (${cwd}) ≠ QAAP_WORKSPACE (${WORKSPACE}). Valida en el browser correcto.`);
    }

    const milestones = { tools20: false, tools48: false, nested: false };
    const deadline = Date.now() + 20 * 60 * 1000;
    let lastMetrics;

    while (Date.now() < deadline) {
        const metrics = await evaluateTraceMetrics(page, cwd);
        lastMetrics = metrics;
        const tc = metrics.toolCount ?? 0;
        const dom = metrics.dom ?? {};
        if (tc > 0 && (dom.stepCount ?? 0) === 0) {
            await openLiveTranscriptIfNeeded(page);
        }
        console.log(JSON.stringify({
            t: new Date().toISOString(),
            phase: metrics.phase,
            status: metrics.status,
            toolCount: tc,
            nestedToolCount: metrics.nestedToolCount,
            domSteps: dom.stepCount,
            gapRows: dom.gapRows,
            virtualized: dom.virtualized,
            nestIndent: dom.nestIndent,
            subagentRoot: dom.subagentRoot,
        }));

        if (tc >= 20 && !milestones.tools20) {
            milestones.tools20 = true;
            const shot = await screenshotTrace(page, 'milestone-20-tools');
            console.log(`→ Screenshot @20 tools: ${shot}`);
        }
        if (tc >= 48 && !milestones.tools48) {
            milestones.tools48 = true;
            const shot = await screenshotTrace(page, 'milestone-48-tools');
            console.log(`→ Screenshot @48 tools: ${shot}`);
        }
        if ((metrics.nestedToolCount ?? 0) > 0 && !milestones.nested) {
            milestones.nested = true;
            const shot = await screenshotTrace(page, 'milestone-subagent');
            console.log(`→ Screenshot @subagent: ${shot}`);
        }

        if (metrics.phase === 'idle' && tc >= 50) {
            console.log('\nTurn complete (≥50 tools). Final screenshot…');
            break;
        }
        if (metrics.phase === 'idle' && tc > 0 && metrics.status !== 'streaming') {
            console.log('\nAgent idle — continue manual checks in browser, then close window.');
            break;
        }
        await page.waitForTimeout(5000);
    }

    const finalShot = await screenshotTrace(page, 'final-state');
    const report = {
        outDir: OUT_DIR,
        workspace: cwd,
        milestones,
        finalScreenshot: finalShot,
        lastMetrics,
        checklist: MANUAL_CHECKLIST,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'long-turn-report.json'), JSON.stringify(report, null, 2));
    console.log('\nReport:', path.join(OUT_DIR, 'long-turn-report.json'));
    console.log('Screenshots:', OUT_DIR);

    if (!HEADLESS) {
        console.log('\nBrowser abierto — valida touch scroll y gaps manualmente. Cierra la ventana para terminar.');
        await page.waitForEvent('close', { timeout: 0 }).catch(() => undefined);
    }

    await browser.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

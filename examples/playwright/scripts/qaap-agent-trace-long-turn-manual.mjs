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
 *   QAAP_STORAGE_STATE   optional Playwright storageState JSON (logged-in session cookies)
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
const STORAGE_STATE = process.env.QAAP_STORAGE_STATE;
const MOBILE = { width: 390, height: 844 };
const WORKSPACE_FORCE_RETRIES = 3;
const NO_CONV_FAIL_FAST_MS = 180_000;

function normalizeWorkspacePath(rawPath) {
    let normalized = rawPath.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

function workspacePathsMatch(left, right) {
    const a = normalizeWorkspacePath(left);
    const b = normalizeWorkspacePath(right);
    if (a === b) {
        return true;
    }
    return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function buildWorkspaceLaunchUrl(base, workspacePath) {
    const normalized = normalizeWorkspacePath(workspacePath);
    const hashPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `${base}#${encodeURI(hashPath)}`;
}

async function prepareWorkHubPlaywrightSession(page) {
    await page.addInitScript(() => {
        const clearKeys = [
            'qaap.mobileProjects.homeVisible',
            'qaap.mobileProjects.preferDesktopIde',
            'qaap.mobileProjects.explicitDesktopIde',
        ];
        for (const key of clearKeys) {
            sessionStorage.removeItem(key);
        }
        sessionStorage.setItem('qaap.mobileProjects.dismissPanel', '1');
    });
}

async function decodeHashWorkspacePath(page) {
    return page.evaluate(() => {
        const hash = window.location.hash;
        if (hash.length <= 1) {
            return undefined;
        }
        try {
            return decodeURI(hash.substring(1));
        } catch {
            return hash.substring(1);
        }
    });
}

async function ensureTargetWorkspace(page, targetWorkspace) {
    const normalizedTarget = normalizeWorkspacePath(targetWorkspace);
    let lastSeen;

    for (let attempt = 0; attempt < WORKSPACE_FORCE_RETRIES; attempt += 1) {
        const url = buildWorkspaceLaunchUrl(BASE, normalizedTarget);
        if (attempt === 0) {
            console.log(`Opening ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        } else {
            console.log(`Re-forcing workspace (attempt ${attempt + 1}/${WORKSPACE_FORCE_RETRIES})…`);
            await page.evaluate((workspacePath) => {
                sessionStorage.setItem('qaap.mobileProjects.dismissPanel', '1');
                sessionStorage.removeItem('qaap.mobileProjects.homeVisible');
                const next = `${window.location.pathname}${window.location.search}#${encodeURI(workspacePath)}`;
                window.location.replace(next);
            }, normalizedTarget);
            await page.waitForLoadState('domcontentloaded', { timeout: 120000 });
        }

        await page.waitForSelector('#theia-app-shell', { timeout: 60000 });
        await page.waitForTimeout(2000);
        await dismissTutorial(page);

        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
            lastSeen = await decodeHashWorkspacePath(page);
            if (lastSeen && workspacePathsMatch(lastSeen, normalizedTarget)) {
                await page.waitForSelector('.theia-mobile-projects-sticky-composer-input', { timeout: 60000 }).catch(() => undefined);
                return normalizedTarget;
            }
            await page.waitForTimeout(1000);
        }
    }

    throw new Error(
        `Could not open target workspace ${normalizedTarget} (last hash path: ${lastSeen ?? 'unknown'})`,
    );
}

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

async function enablePageRenderMetrics(page) {
    await page.evaluate(() => {
        const root = globalThis;
        const key = '__QAAP_TRANSCRIPT_RENDER_METRICS__';
        if (!root[key]) {
            root[key] = { enabled: false, counts: {} };
        }
        root[key].enabled = true;
        root[key].counts = {
            sse_scheduled: 0,
            sse_flushed: 0,
            render_full: 0,
            render_patch_activity: 0,
            render_patch_last_agent: 0,
            render_patch_append: 0,
            render_patch_none: 0,
            render_skip_unchanged_tail: 0,
            timeline_sync: 0,
            timeline_sync_skipped: 0,
            timeline_create: 0,
            timeline_item_sync: 0,
            timeline_item_sync_skipped: 0,
        };
    });
}

async function readPageRenderMetrics(page) {
    return page.evaluate(() => {
        const store = globalThis.__QAAP_TRANSCRIPT_RENDER_METRICS__;
        if (!store?.enabled) {
            return undefined;
        }
        return { ...store.counts };
    });
}
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
    return decodeHashWorkspacePath(page);
}

async function readShellDiagnostics(page) {
    return page.evaluate(() => ({
        loginActive: document.body.classList.contains('qaap-login-active'),
        hash: window.location.hash,
        composerVisible: !!document.querySelector('.theia-mobile-projects-sticky-composer-input'),
        sendReady: !!document.querySelector('.theia-mobile-projects-sticky-composer-send.theia-mod-ready'),
        sendEnabled: !!document.querySelector('.theia-mobile-projects-sticky-composer-send:not([disabled])'),
        transcriptVisible: !!document.querySelector('.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-agent-transcript-real-chat'),
    }));
}

async function evaluateTraceMetrics(page, cwd, promptSubmittedAt) {
    const queryCwd = cwd ? normalizeWorkspacePath(cwd) : undefined;
    return page.evaluate(async ({ workspaceCwd, submittedAt }) => {
        const normalize = (value) => {
            let normalized = value.replace(/\\/g, '/');
            while (normalized.length > 1 && normalized.endsWith('/')) {
                normalized = normalized.slice(0, -1);
            }
            return normalized;
        };
        const fetchList = async (queryPath) => {
            const url = queryPath
                ? `/qaap/api/agent-conversations?cwd=${encodeURIComponent(queryPath)}`
                : '/qaap/api/agent-conversations';
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                return { ok: false, status: res.status };
            }
            const body = await res.json();
            return { ok: true, conversations: body.conversations ?? [] };
        };
        if (!workspaceCwd) {
            return { phase: 'no-cwd' };
        }
        let list = await fetchList(workspaceCwd);
        if (!list.ok) {
            return { phase: 'api-error', cwd: workspaceCwd, status: list.status };
        }
        let conversations = list.conversations;
        if (conversations.length === 0) {
            const all = await fetchList(undefined);
            if (all.ok) {
                const target = normalize(workspaceCwd);
                conversations = all.conversations.filter(entry => normalize(entry.cwd ?? '') === target);
            }
        }
        if (conversations.length === 0) {
            return { phase: 'no-conv', cwd: workspaceCwd };
        }
        const targetNorm = normalize(workspaceCwd);
        const sorted = [...conversations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        const latest = submittedAt
            ? sorted.find(entry => (entry.updatedAt ?? 0) >= submittedAt - 5000) ?? sorted[0]
            : sorted[0];
        if (!latest?.id) {
            return { phase: 'no-conv', cwd: workspaceCwd };
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
            cwd: workspaceCwd,
            conversationCwd: latest.cwd,
            toolCount: tools.length,
            nestedToolCount: nested.length,
            dom,
        };
    }, { workspaceCwd: queryCwd, submittedAt: promptSubmittedAt ?? 0 });
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

async function openPage(browser) {
    if (STORAGE_STATE && fs.existsSync(STORAGE_STATE)) {
        const context = await browser.newContext({ viewport: MOBILE, storageState: STORAGE_STATE });
        return context.newPage();
    }
    return browser.newPage({ viewport: MOBILE });
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    printChecklist();

    const browser = await launchBrowser();
    const page = await openPage(browser);
    await waitForServer(page);
    await prepareWorkHubPlaywrightSession(page);

    const cwd = await ensureTargetWorkspace(page, WORKSPACE);
    await enablePageRenderMetrics(page);

    const preSubmitDiag = await readShellDiagnostics(page);
    console.log(`Workspace cwd: ${cwd}`);
    if (preSubmitDiag.loginActive) {
        throw new Error(
            'Login gate activo — exporta sesión con Playwright (QAAP_STORAGE_STATE) o usa QAAP_HEADLESS=0 en un browser ya autenticado.',
        );
    }
    console.log('Sending long-turn prompt…\n');

    await submitLongTurnPrompt(page);
    await openLiveTranscriptIfNeeded(page);
    await page.waitForTimeout(2000);

    const promptSubmittedAt = Date.now();
    let sawStreaming = false;
    let noConvSince = promptSubmittedAt;

    const milestones = { tools20: false, tools48: false, nested: false };
    const deadline = Date.now() + 20 * 60 * 1000;
    let lastMetrics;
    let baselineToolCount = 0;

    while (Date.now() < deadline) {
        const metrics = await evaluateTraceMetrics(page, cwd, promptSubmittedAt);
        lastMetrics = metrics;
        const tc = metrics.toolCount ?? 0;
        if (metrics.phase === 'no-conv') {
            if (Date.now() - noConvSince >= NO_CONV_FAIL_FAST_MS) {
                const diag = await readShellDiagnostics(page);
                throw new Error(
                    `Sin conversación tras ${NO_CONV_FAIL_FAST_MS / 1000}s en ${cwd}. `
                    + `Diag: ${JSON.stringify(diag)}. `
                    + '¿Agente configurado y sesión autenticada?',
                );
            }
        } else {
            noConvSince = Date.now();
        }
        if (baselineToolCount === 0 && tc > 0 && Date.now() - promptSubmittedAt < 8000) {
            baselineToolCount = tc;
        }
        const dom = metrics.dom ?? {};
        if (metrics.phase === 'streaming') {
            sawStreaming = true;
        }
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
            renderMetrics: await readPageRenderMetrics(page),
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
        const graceElapsedMs = Date.now() - promptSubmittedAt;
        const newToolsSinceSubmit = tc - baselineToolCount;
        if (metrics.phase === 'idle' && tc > 0 && metrics.status !== 'streaming') {
            if (!sawStreaming && graceElapsedMs < 120_000) {
                // Still waiting for the new turn to start streaming.
            } else if (newToolsSinceSubmit < 10 && graceElapsedMs < 180_000) {
                // Prior idle conversation — keep polling until tools grow or timeout.
            } else {
                console.log('\nAgent idle — continue manual checks in browser, then close window.');
                break;
            }
        }
        await page.waitForTimeout(5000);
    }

    const finalShot = await screenshotTrace(page, 'final-state');
    const report = {
        outDir: OUT_DIR,
        workspace: cwd,
        requestedWorkspace: WORKSPACE,
        preSubmitDiagnostics: preSubmitDiag,
        milestones,
        finalScreenshot: finalShot,
        lastMetrics,
        renderMetrics: await readPageRenderMetrics(page),
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

#!/usr/bin/env node
/**
 * Nova/Qaap — Tarea de prueba estándar QA (Rioja landing, mobile 390px).
 * Captura timestamps T+0…T+F, RAM, FPS y genera report.json.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = path.join(process.cwd(), 'test-results', 'qaap-nova-standard-qa');
const MOBILE = { width: 390, height: 844 };

const EXACT_PROMPT =
    'Crea una landing page de una sola página sobre vinos Rioja. HTML + CSS vanilla, sin frameworks, sin dependencias externas. Debe tener: hero con headline, sección de variedades, CTA de contacto. Lanza el servidor y muéstrame la preview.';

function now() { return Date.now(); }
function fmtMs(ms) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }

async function dismissTutorial(page) {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
        await page.waitForTimeout(400);
    }
}

async function waitForShell(page, timeoutMs = 90_000) {
    await page.waitForSelector('#theia-app-shell', { timeout: timeoutMs });
    await page.waitForSelector('.theia-preload', { state: 'detached', timeout: timeoutMs }).catch(() => undefined);
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    await composer.waitFor({ state: 'visible', timeout: timeoutMs });
}

function createEmptyWorkspace() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-nova-ws-'));
}

async function pollFirstFile(cwd, timeoutMs = 120_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        const entries = fs.readdirSync(cwd, { withFileTypes: true });
        const files = entries.filter(e => e.isFile()).map(e => e.name);
        if (files.length) {
            return { ok: true, file: files[0], allFiles: files, elapsedMs: now() - start };
        }
        await new Promise(r => setTimeout(r, 200));
    }
    return { ok: false, elapsedMs: now() - start };
}

async function pollConversationFirstToken(page, cwd, timeoutMs = 30_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        const state = await page.evaluate(async (workspaceCwd) => {
            const listRes = await fetch(`/qaap/api/agent-conversations?cwd=${encodeURIComponent(workspaceCwd)}`, { credentials: 'include' });
            if (!listRes.ok) return { ok: false };
            const list = await listRes.json();
            const convs = list.conversations ?? [];
            if (!convs.length) return { ok: false, reason: 'no-conv' };
            const latest = [...convs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
            const detailRes = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(latest.id)}`, { credentials: 'include' });
            if (!detailRes.ok) return { ok: false };
            const conv = await detailRes.json();
            for (const msg of conv.messages ?? []) {
                if (msg.role === 'agent' && (msg.content?.length || msg.segments?.length)) {
                    return { ok: true, status: conv.status, agentId: conv.agentId };
                }
            }
            return { ok: false, reason: 'no-agent-content' };
        }, cwd);
        if (state.ok) return { ...state, elapsedMs: now() - start };
        await new Promise(r => setTimeout(r, 150));
    }
    return { ok: false, timedOut: true, elapsedMs: now() - start };
}

async function createAgentConversation(page, cwd, message, agent = 'qaiq') {
    return page.evaluate(async ({ workspaceCwd, body, agentId }) => {
        const res = await fetch('/qaap/api/agent-conversations', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cwd: workspaceCwd,
                agent: agentId,
                message: body,
                title: body.slice(0, 96),
                autoApprove: true,
                approvalPolicyId: 'full-access',
            }),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }, { workspaceCwd: cwd, body: message, agentId: agent });
}

async function waitForDevProbe(port = 5173, timeoutMs = 120_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
            if (response.status > 0 && response.status < 500) {
                return { ok: true, elapsedMs: now() - start };
            }
        } catch { /* retry */ }
        try {
            const probe = await fetch(`${BASE}/qaap-dev/api/probe/${port}`, { cache: 'no-store' });
            if (probe.ok) {
                const body = await probe.json();
                if (body.ready) return { ok: true, via: 'qaap-probe', elapsedMs: now() - start };
            }
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return { ok: false, elapsedMs: now() - start };
}

async function bootstrapPreview(page, workspace) {
    const banner = page.locator('.qaap-project-bootstrap-banner').getByRole('button', { name: /run & preview|run preview|ejecutar/i }).first();
    if (await banner.count()) {
        await banner.click();
        return { via: 'banner' };
    }
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    if (await composer.isVisible()) {
        await composer.fill('levanta la app');
        const sent = await page.evaluate(() => {
            const btn = document.querySelector('.theia-mobile-projects-sticky-composer-send.theia-mod-ready');
            if (btn instanceof HTMLButtonElement && !btn.disabled) { btn.click(); return true; }
            return false;
        });
        if (sent) return { via: 'composer-followup' };
    }
    return { via: 'none' };
}

async function waitForPreviewVisible(page, port = 5173, timeoutMs = 120_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        const state = await page.evaluate(async (probePort) => {
            let probeReady = false;
            try {
                const r = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' });
                if (r.ok) probeReady = (await r.json()).ready === true;
            } catch { /* ignore */ }
            const iframe = document.querySelector(`iframe[src*="qaap-dev/${probePort}"]`);
            const previewSurface = document.querySelector('[data-active-surface="preview"]');
            return { probeReady, hasIframe: iframe instanceof HTMLIFrameElement, previewSurface: !!previewSurface };
        }, port);
        if (state.probeReady && (state.hasIframe || state.previewSurface)) {
            return { ok: true, ...state, elapsedMs: now() - start };
        }
        await new Promise(r => setTimeout(r, 500));
    }
    return { ok: false, timedOut: true, elapsedMs: now() - start };
}

async function measureRamAndFps(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = await cdp.send('Performance.getMetrics');
    const jsHeap = metrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value;
    await cdp.send('Performance.disable');

    const fpsSamples = await page.evaluate(async () => {
        const samples = [];
        let last = performance.now();
        let frames = 0;
        return new Promise(resolve => {
            const tick = (t) => {
                frames++;
                if (t - last >= 1000) {
                    samples.push(frames);
                    frames = 0;
                    last = t;
                    if (samples.length >= 3) { resolve(samples); return; }
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            setTimeout(() => resolve(samples.length ? samples : [0]), 3500);
        });
    });
    const avgFps = fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : 0;
    return { jsHeapBytes: jsHeap, jsHeapMB: jsHeap ? jsHeap / (1024 * 1024) : undefined, fpsSamples, avgFps };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = createEmptyWorkspace();
    const report = {
        workspace,
        prompt: EXACT_PROMPT,
        timestamps: {},
        metrics: {},
        interventions: [],
        errors: [],
        files: {},
    };

    const t0 = now();
    report.timestamps['T+0'] = 0;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: MOBILE,
        isMobile: true,
        hasTouch: true,
        locale: 'es-ES',
    });
    const page = await context.newPage();

    try {
        // T+0 → UI interactiva
        const url = `${BASE}/#/${encodeURIComponent(workspace)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await waitForShell(page);
        await dismissTutorial(page);
        report.timestamps['T+UI'] = now() - t0;
        report.metrics.uiInteractiveMs = report.timestamps['T+UI'];
        await page.screenshot({ path: path.join(OUT_DIR, '01-ui-interactive.png'), fullPage: true });

        // T+A → proyecto nuevo (workspace vacío vía URL)
        report.timestamps['T+A'] = now() - t0;
        report.projectMethod = 'URL hash workspace vacío (equivalente a nuevo proyecto)';

        // T+B → prompt al agente
        const tB = now();
        report.timestamps['T+B'] = tB - t0;
        const conv = await createAgentConversation(page, workspace, EXACT_PROMPT, 'qaiq');
        report.conversationId = conv.id;

        // Primer token agente
        const firstToken = await pollConversationFirstToken(page, workspace, 30_000);
        report.metrics.firstTokenMs = firstToken.elapsedMs;

        // T+C → primer archivo
        const filePoll = pollFirstFile(workspace, 120_000);
        const convDone = (async () => {
            const start = now();
            while (now() - start < 120_000) {
                const s = await page.evaluate(async (cwd) => {
                    const r = await fetch(`/qaap/api/agent-conversations?cwd=${encodeURIComponent(cwd)}`, { credentials: 'include' });
                    const list = await r.json();
                    const c = (list.conversations ?? [])[0];
                    if (!c) return { done: false };
                    const d = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(c.id)}`, { credentials: 'include' });
                    const conv = await d.json();
                    return { done: conv.status !== 'streaming', status: conv.status };
                }, workspace);
                if (s.done) return s;
                await new Promise(r => setTimeout(r, 500));
            }
            return { done: false, timedOut: true };
        })();

        const [firstFile, agentResult] = await Promise.all([filePoll, convDone]);
        report.timestamps['T+C'] = now() - t0;
        report.metrics.firstFileMs = firstFile.elapsedMs;
        report.files.firstFile = firstFile;
        report.agentResult = agentResult;

        const wsFiles = fs.readdirSync(workspace, { recursive: true }).map(String);
        report.files.all = wsFiles;
        report.files.hasPackageJson = wsFiles.some(f => f.endsWith('package.json'));
        report.files.hasVanillaOnly = !report.files.hasPackageJson && wsFiles.some(f => f.endsWith('.html'));

        await page.screenshot({ path: path.join(OUT_DIR, '02-agent-done.png'), fullPage: true });

        // T+D → servidor
        const tDStart = now();
        await bootstrapPreview(page, workspace);
        const serverProbe = await waitForDevProbe(5173, 90_000);
        report.timestamps['T+D'] = now() - t0;
        report.metrics.serverActiveMs = now() - tDStart;
        report.server = serverProbe;

        // T+E → preview visible
        const preview = await waitForPreviewVisible(page, 5173, 90_000);
        report.timestamps['T+E'] = now() - t0;
        report.metrics.previewVisibleMs = preview.elapsedMs;
        report.preview = preview;

        // T+F → fin
        report.timestamps['T+F'] = now() - t0;
        report.perf = await measureRamAndFps(page);

        await page.screenshot({ path: path.join(OUT_DIR, '03-preview.png'), fullPage: true });

        report.flowCompleted =
            firstFile.ok
            && serverProbe.ok
            && preview.ok
            && agentResult.status !== 'failed';

        report.metrics.thresholds = {
            uiInteractive: { ok: report.metrics.uiInteractiveMs < 3000, measured: report.metrics.uiInteractiveMs, threshold: 3000 },
            firstToken: { ok: (firstToken.elapsedMs ?? 99999) < 2000, measured: firstToken.elapsedMs, threshold: 2000 },
            firstFile: { ok: (firstFile.elapsedMs ?? 99999) < 15000, measured: firstFile.elapsedMs, threshold: 15000 },
            serverActive: { ok: report.metrics.serverActiveMs < 45000, measured: report.metrics.serverActiveMs, threshold: 45000 },
            previewVisible: { ok: (preview.elapsedMs ?? 99999) < 60000, measured: preview.elapsedMs, threshold: 60000 },
            interventions: { ok: report.interventions.length === 0, measured: report.interventions.length, threshold: 0 },
            ramMB: { ok: (report.perf.jsHeapMB ?? 999) < 400, measured: report.perf.jsHeapMB, threshold: 400 },
            fps: { ok: (report.perf.avgFps ?? 0) > 50, measured: report.perf.avgFps, threshold: 50 },
        };

        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

        console.log('\n=== Nova Standard QA Eval ===');
        console.log(`Workspace: ${workspace}`);
        for (const [k, v] of Object.entries(report.timestamps)) {
            console.log(`${k}: ${fmtMs(v)}`);
        }
        console.log('\nThresholds:', JSON.stringify(report.metrics.thresholds, null, 2));
        console.log(`\nReport: ${path.join(OUT_DIR, 'report.json')}`);
        process.exitCode = report.flowCompleted ? 0 : 1;
    } catch (err) {
        report.errors.push(String(err));
        report.timestamps['T+F'] = now() - t0;
        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
        console.error(err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();

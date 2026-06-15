#!/usr/bin/env node
/**
 * E2E evaluación: proyecto vacío → agente QAIQ crea landing Rioja → install → preview.
 *
 * Requiere:
 *   - Browser app compilado y servidor en QAAP_BASE_URL (default http://127.0.0.1:3000)
 *   - Mock QAIQ en PATH como `qaiq` (scripts/mock-qaiq-rioja-agent)
 *
 * Arranque típico del backend con mock:
 *   export PATH="$(pwd)/examples/playwright/scripts:$PATH"
 *   ln -sf "$(pwd)/examples/playwright/scripts/mock-qaiq-rioja-agent" /tmp/qaiq-mock-bin/qaiq
 *   export PATH="/tmp/qaiq-mock-bin:$PATH"
 *   npm run start:browser
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT_DIR = path.join(process.cwd(), 'test-results', 'qaap-rioja-e2e');
const MOBILE = { width: 375, height: 812 };
const MOCK_QAIQ = path.join(__dirname, 'mock-qaiq-rioja-agent');
const MOCK_QAIQ_BIN_DIR = path.join(OUT_DIR, 'mock-qaiq-bin');

function resolveMockQaiqPath() {
    try {
        const resolved = fs.realpathSync(MOCK_QAIQ);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    } catch {
        // fall through
    }
    return MOCK_QAIQ;
}

function ensureMockQaiqSymlink() {
    fs.mkdirSync(MOCK_QAIQ_BIN_DIR, { recursive: true });
    const linkPath = path.join(MOCK_QAIQ_BIN_DIR, 'qaiq');
    const target = resolveMockQaiqPath();
    try {
        if (fs.existsSync(linkPath)) {
            fs.unlinkSync(linkPath);
        }
        fs.symlinkSync(target, linkPath);
    } catch (err) {
        return { ok: false, linkPath, target, error: String(err) };
    }
    return { ok: true, linkPath, target };
}

function detectQaiqOnPath() {
    const which = process.env.PATH?.split(path.delimiter).some(dir => {
        try {
            return fs.existsSync(path.join(dir, 'qaiq'));
        } catch {
            return false;
        }
    });
    return { onPath: !!which, pathEnv: process.env.PATH ?? '' };
}

const PROMPT = 'Crea una landing page moderna sobre vinos Rioja con Vite. Incluye hero, secciones de bodegas y variedades, y estilos elegantes.';
const PREVIEW_PROMPT = 'levanta la app y muéstrame la vista previa';

function now() { return Date.now(); }

function fmtMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

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
    await page.waitForTimeout(1500);
}

function createEmptyWorkspace() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-rioja-ws-'));
}

async function openWorkspace(page, workspace) {
    const wsPath = workspace.replace(/\\/g, '/');
    const hash = encodeURIComponent('/' + wsPath);
    await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' });
    await waitForShell(page);
    await dismissTutorial(page);
    // Agents Hub landing: abrir superficie de chat si el composer no está visible aún.
    const agentBtn = page.locator('#theia-mobile-bottom-bar .theia-mobile-bottom-activity-btn[data-action-id="agent"]').first();
    if (!(await page.locator('.theia-mobile-projects-sticky-composer-input').count()) && await agentBtn.count()) {
        await agentBtn.click();
        await page.waitForTimeout(1500);
    }
    await page.locator('.theia-mobile-projects-sticky-composer-input').waitFor({ state: 'visible', timeout: 60_000 });
}

async function pollConversation(page, cwd, { timeoutMs = 180_000 } = {}) {
    const start = now();
    let last = {};
    while (now() - start < timeoutMs) {
        last = await page.evaluate(async (workspaceCwd) => {
            const listRes = await fetch(`/qaap/api/agent-conversations?cwd=${encodeURIComponent(workspaceCwd)}`, { credentials: 'include' });
            if (!listRes.ok) return { ok: false, reason: 'list-failed', status: listRes.status };
            const list = await listRes.json();
            const conversations = list.conversations ?? [];
            if (!conversations.length) return { ok: false, reason: 'no-conversation' };
            const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
            const detailRes = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(latest.id)}`, { credentials: 'include' });
            if (!detailRes.ok) return { ok: false, reason: 'detail-failed' };
            const conv = await detailRes.json();
            const toolSegments = [];
            for (const msg of conv.messages ?? []) {
                for (const seg of msg.segments ?? []) {
                    if (seg.type === 'tool') toolSegments.push({ name: seg.name, finished: seg.finished });
                }
            }
            return {
                ok: true,
                status: conv.status,
                messageCount: conv.messages?.length ?? 0,
                toolSegments,
                agentId: conv.agentId,
                lastAgentText: [...(conv.messages ?? [])].reverse().find(m => m.role === 'agent')?.content?.slice(0, 200),
            };
        }, cwd);
        if (last.ok && last.status !== 'streaming') {
            return last;
        }
        await page.waitForTimeout(1500);
    }
    return { ...last, timedOut: true };
}

async function checkWorkspaceFiles(cwd) {
    const files = ['package.json', 'index.html', 'src/style.css', 'src/main.js'];
    const exists = {};
    for (const f of files) {
        exists[f] = fs.existsSync(path.join(cwd, f));
    }
    const hasNodeModules = fs.existsSync(path.join(cwd, 'node_modules'));
    const html = exists['index.html'] ? fs.readFileSync(path.join(cwd, 'index.html'), 'utf8') : '';
    const mentionsRioja = /rioja/i.test(html);
    return { exists, hasNodeModules, mentionsRioja, htmlLength: html.length };
}

async function waitForPreview(page, port = 5173, timeoutMs = 180_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        const state = await page.evaluate(async (probePort) => {
            let probeReady = false;
            try {
                const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' });
                if (response.ok) {
                    const body = await response.json();
                    probeReady = body.ready === true;
                }
            } catch { /* ignore */ }
            const onPreview = document.querySelector('[data-active-surface="preview"]') !== null;
            const iframe = document.querySelector(`iframe[src*="qaap-dev/${probePort}"]`) !== null;
            const previewTab = document.querySelector('[data-surface="preview"], [data-tab="preview"]') !== null;
            return { probeReady, onPreview, iframe, previewTab };
        }, port);
        if (state.probeReady && (state.onPreview || state.iframe)) {
            return { ...state, elapsedMs: now() - start };
        }
        await page.waitForTimeout(2000);
    }
    return { probeReady: false, timedOut: true, elapsedMs: now() - start };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const workspace = createEmptyWorkspace();
    const wsPath = workspace.replace(/\\/g, '/');

    const mockLink = ensureMockQaiqSymlink();
    const qaiqPath = detectQaiqOnPath();

    const metrics = {
        workspace,
        mockQaiq: { script: resolveMockQaiqPath(), symlink: mockLink, qaiqOnPath: qaiqPath },
        phases: {},
        files: {},
        conversation: {},
        preview: {},
        ux: [],
        errors: [],
    };

    const t0 = now();
    console.log('\n=== Qaap Rioja E2E Eval (QAIQ) ===');
    console.log(`Workspace vacío: ${workspace}`);
    console.log(`Mock QAIQ: ${resolveMockQaiqPath()}`);
    console.log(`Symlink: ${mockLink.linkPath} -> ${mockLink.target}`);
    if (!qaiqPath.onPath) {
        console.warn('\n⚠️  `qaiq` no está en PATH. Reinicia el backend con:');
        console.warn(`   export PATH="${MOCK_QAIQ_BIN_DIR}:$PATH"`);
        console.warn('   npm run start:browser\n');
        metrics.errors.push('qaiq not on PATH — backend must be started with mock bin dir prepended');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: MOBILE,
        isMobile: true,
        hasTouch: true,
        locale: 'es-ES',
    });
    const page = await context.newPage();

    try {
        // Phase 1: Load Work Hub with empty workspace
        const tLoad = now();
        await openWorkspace(page, workspace);
        metrics.phases.shellLoadMs = now() - tLoad;

        const composerVisible = await page.locator('.theia-mobile-projects-sticky-composer-input').isVisible();
        metrics.ux.push(composerVisible ? 'Composer sticky visible en workspace vacío' : 'Composer NO visible tras abrir workspace');
        await page.screenshot({ path: path.join(OUT_DIR, '01-workspace-empty.png'), fullPage: true });

        if (!composerVisible) {
            metrics.errors.push('No se pudo acceder al composer — flujo bloqueado');
            throw new Error('Composer not visible');
        }

        // Phase 2: Send Rioja landing prompt
        const tPrompt = now();
        const composer = page.locator('.theia-mobile-projects-sticky-composer-input');
        await composer.fill(PROMPT);
        await page.getByRole('button', { name: /^send$|^create$/i }).click();
        metrics.phases.promptSubmitMs = now() - tPrompt;

        await expectHeading(page, /rioja|landing|vino/i, 60_000).catch(() => {
            metrics.ux.push('El encabezado del turno no reflejó el prompt inmediatamente (puede ser normal con streaming)');
        });
        await page.screenshot({ path: path.join(OUT_DIR, '02-prompt-sent.png'), fullPage: true });

        // Phase 3: Wait for agent to complete
        const tAgent = now();
        const conv = await pollConversation(page, workspace, { timeoutMs: 120_000 });
        metrics.phases.agentTurnMs = now() - tAgent;
        metrics.conversation = conv;

        metrics.files = await checkWorkspaceFiles(workspace);
        await page.screenshot({ path: path.join(OUT_DIR, '03-agent-complete.png'), fullPage: true });

        // Phase 4: Request preview
        const tPreviewPrompt = now();
        await composer.fill(PREVIEW_PROMPT);
        await page.getByRole('button', { name: /^send$|^create$/i }).click();
        metrics.phases.previewPromptMs = now() - tPreviewPrompt;

        const tPreview = now();
        const preview = await waitForPreview(page, 5173, 180_000);
        metrics.phases.previewReadyMs = now() - tPreview;
        metrics.preview = preview;

        // Try to read iframe content
        const iframeContent = await page.evaluate(async () => {
            const iframe = document.querySelector('iframe[src*="qaap-dev/5173"]');
            if (!(iframe instanceof HTMLIFrameElement)) return { found: false };
            try {
                const doc = iframe.contentDocument;
                const title = doc?.title ?? '';
                const h1 = doc?.querySelector('h1')?.textContent ?? '';
                return { found: true, title, h1 };
            } catch {
                return { found: true, crossOrigin: true };
            }
        });
        metrics.preview.iframeContent = iframeContent;

        await page.screenshot({ path: path.join(OUT_DIR, '04-preview.png'), fullPage: true });

        metrics.phases.totalMs = now() - t0;

        // Write JSON report
        const reportPath = path.join(OUT_DIR, 'report.json');
        fs.writeFileSync(reportPath, JSON.stringify(metrics, null, 2));

        console.log('\n--- Métricas ---');
        for (const [k, v] of Object.entries(metrics.phases)) {
            console.log(`${k}: ${fmtMs(v)}`);
        }
        console.log('\n--- Archivos creados ---');
        console.log(JSON.stringify(metrics.files, null, 2));
        console.log('\n--- Conversación ---');
        console.log(JSON.stringify(metrics.conversation, null, 2));
        console.log('\n--- Preview ---');
        console.log(JSON.stringify(metrics.preview, null, 2));
        console.log(`\nReporte: ${reportPath}`);
        console.log(`Screenshots: ${OUT_DIR}`);

        const success = metrics.files.exists?.['index.html']
            && metrics.files.mentionsRioja
            && metrics.preview.probeReady
            && (metrics.conversation.agentId === 'qaiq' || metrics.conversation.agentId === undefined);
        process.exitCode = success ? 0 : 1;
    } catch (err) {
        metrics.errors.push(String(err));
        metrics.phases.totalMs = now() - t0;
        fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(metrics, null, 2));
        console.error(err);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

async function expectHeading(page, pattern, timeoutMs) {
    await page.getByRole('heading', { name: pattern }).waitFor({ timeout: timeoutMs });
}

main();

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
import { execSync, spawn } from 'child_process';
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


const PROMPT = 'Crea una landing page moderna sobre vinos Rioja con Vite. Incluye hero, secciones de bodegas y variedades, y estilos elegantes.';
const PREVIEW_PROMPT = 'levanta la app';

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
    const url = `${BASE}/#/${encodeURIComponent(workspace)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitForShell(page);
    await dismissTutorial(page);
    const agentBtn = page.locator('#theia-mobile-bottom-bar .theia-mobile-bottom-activity-btn[data-action-id="agent"]').first();
    if (!(await page.locator('.theia-mobile-projects-sticky-composer-input').count()) && await agentBtn.count()) {
        await agentBtn.click();
        await page.waitForTimeout(1500);
    }
    await page.locator('.theia-mobile-projects-sticky-composer-input').waitFor({ state: 'visible', timeout: 60_000 });
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
        if (!res.ok) {
            throw new Error(await res.text());
        }
        return res.json();
    }, { workspaceCwd: cwd, body: message, agentId: agent });
}

async function postConversationMessage(page, conversationId, message, agent = 'qaiq') {
    return page.evaluate(async ({ id, body, agentId }) => {
        const res = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(id)}/messages`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: body, agent: agentId, autoApprove: true, approvalPolicyId: 'full-access' }),
        });
        if (!res.ok) {
            throw new Error(await res.text());
        }
        return res.json();
    }, { id: conversationId, body: message, agentId: agent });
}


async function startNewAgentChat(page) {
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    const placeholder = await composer.getAttribute('placeholder');
    if (/delegate a task/i.test(placeholder ?? '')) {
        return { ok: true, skipped: true, placeholder };
    }
    if (/follow up on this task/i.test(placeholder ?? '')) {
        await page.evaluate(() => {
            const btn = document.querySelector('.theia-workbench-nav-btn.theia-mod-mobile-sessions-sidebar');
            if (btn instanceof HTMLButtonElement) {
                btn.click();
            }
        });
        await page.waitForSelector('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible', { timeout: 10_000 }).catch(() => undefined);
        const newChat = page.locator('.theia-mobile-work-hub-sessions-sidebar-nav-item').filter({ hasText: /new chat/i }).first();
        if (await newChat.count()) {
            await newChat.click();
            await page.waitForTimeout(1200);
        }
        const nextPlaceholder = await composer.getAttribute('placeholder');
        if (/follow up on this task/i.test(nextPlaceholder ?? '')) {
            throw new Error('Composer sigue en follow-up de otra tarea — workspace no aislado');
        }
        return { ok: true, skipped: false, placeholder: nextPlaceholder };
    }
    return { ok: true, skipped: true, placeholder };
}

async function selectComposerAgent(page, labelPattern) {
    const agentBtn = page.locator('.theia-mobile-projects-sticky-composer-agent:not(.theia-mod-locked)').first();
    if (!(await agentBtn.count()) || await agentBtn.isDisabled()) {
        return { ok: false, reason: 'agent-selector-unavailable' };
    }
    const currentLabel = ((await agentBtn.textContent()) ?? '').trim();
    if (labelPattern.test(currentLabel)) {
        return { ok: true, label: currentLabel, skipped: true };
    }
    await agentBtn.click();
    await page.waitForSelector('.theia-mobile-sticky-composer-sheet', { timeout: 10_000 });
    const option = page.locator('.theia-mobile-sticky-composer-sheet-option').filter({ hasText: labelPattern }).first();
    if (!(await option.count())) {
        const closeBtn = page.locator('.theia-mobile-sticky-composer-sheet-close').first();
        if (await closeBtn.count()) {
            await closeBtn.click();
        }
        return { ok: false, reason: 'agent-option-not-found' };
    }
    await option.click();
    await page.waitForTimeout(400);
    const closeBtn = page.locator('.theia-mobile-sticky-composer-sheet-close').first();
    if (await closeBtn.count()) {
        await closeBtn.click();
    } else {
        await page.keyboard.press('Escape').catch(() => undefined);
    }
    await page.waitForSelector('.theia-mobile-sticky-composer-sheet', { state: 'hidden', timeout: 5000 }).catch(() => undefined);
    const label = ((await agentBtn.textContent()) ?? '').trim();
    return { ok: true, label, skipped: false };
}

async function fetchBackendAgents(page) {
    return page.evaluate(async () => {
        const res = await fetch('/qaap/api/agent-tasks', { credentials: 'include' });
        if (!res.ok) {
            return { ok: false, status: res.status };
        }
        const body = await res.json();
        return {
            ok: true,
            agentConfigured: body.agentConfigured,
            defaultAgent: body.defaultAgent,
            agents: (body.agents ?? []).map(agent => ({ id: agent.id, label: agent.label, bin: agent.bin })),
        };
    });
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
        const failed = await page.locator('.theia-mobile-agent-log-header, .theia-mobile-agents-hub-inline-execution')
            .filter({ hasText: /failed|task failed|exhausted/i }).count();
        if (failed) {
            return { ok: false, reason: 'task-failed-ui', timedOut: false };
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

function killDevPort(port = 5173) {
    try {
        execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', shell: '/bin/bash' });
    } catch {
        // Port was free.
    }
}

async function isDirectDevPortReady(port = 5173) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500) });
        return response.status > 0 && response.status < 500;
    } catch {
        return false;
    }
}

async function waitForDevProbe(port = 5173, timeoutMs = 120_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        if (await isDirectDevPortReady(port)) {
            try {
                const response = await fetch(`${BASE}/qaap-dev/api/probe/${port}`, { cache: 'no-store' });
                if (response.ok) {
                    const body = await response.json();
                    if (body.ready === true) {
                        return { ok: true, via: 'qaap-probe', previewUrl: body.previewUrl, elapsedMs: now() - start };
                    }
                }
            } catch {
                // Qaap backend may be reloading; direct port is still a strong signal.
            }
            return { ok: true, via: 'direct-port', elapsedMs: now() - start };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { ok: false, elapsedMs: now() - start };
}

async function startWorkspaceDevServer(workspace, port = 5173) {
    killDevPort(port);
    await new Promise(resolve => setTimeout(resolve, 500));
    const logPath = path.join(OUT_DIR, 'dev-server.log');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const logFd = fs.openSync(logPath, 'w');
    const child = spawn('npm', ['run', 'dev'], {
        cwd: workspace,
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: { ...process.env, NODE_ENV: 'development' },
    });
    fs.closeSync(logFd);
    child.unref();
    const probe = await waitForDevProbe(port, 90_000);
    let logTail = '';
    try {
        logTail = fs.readFileSync(logPath, 'utf8').slice(-1200);
    } catch {
        // ignore
    }
    return { spawned: true, pid: child.pid, probe, logTail };
}

async function openSessionsSidebar(page) {
    await page.evaluate(() => {
        const btn = document.querySelector('.theia-workbench-nav-btn.theia-mod-mobile-sessions-sidebar');
        if (btn instanceof HTMLButtonElement) {
            btn.click();
        }
    });
    await page.waitForSelector('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible', { timeout: 10_000 }).catch(() => undefined);
}

async function openConversationInTranscript(page, titlePattern = /rioja|landing|vite|crea una/i, conversationId) {
    await openSessionsSidebar(page);
    const selectors = [
        '.theia-mobile-work-hub-sessions-sidebar-list .theia-mobile-projects-task-row',
        '.theia-mobile-projects-task-row',
    ];
    for (const selector of selectors) {
        const row = page.locator(selector).filter({ hasText: titlePattern }).first();
        if (await row.count()) {
            await row.click();
            await page.waitForTimeout(2000);
            return { ok: true, via: selector.includes('sidebar') ? 'sidebar' : 'task-row' };
        }
    }
    if (conversationId) {
        const opened = await page.evaluate((id) => {
            const title = document.querySelector(`.theia-mobile-projects-task-title[data-conversation-id="${id}"]`);
            const row = title?.closest('.theia-mobile-projects-task-row');
            const button = row?.querySelector('.theia-mobile-projects-task-item');
            if (button instanceof HTMLButtonElement) {
                button.click();
                return true;
            }
            return false;
        }, conversationId).catch(() => false);
        if (opened) {
            await page.waitForTimeout(2000);
            return { ok: true, via: 'conversation-id' };
        }
    }
    const firstRow = page.locator('.theia-mobile-work-hub-sessions-sidebar-list .theia-mobile-projects-task-row .theia-mobile-projects-task-item').first();
    if (await firstRow.count()) {
        await firstRow.click();
        await page.waitForTimeout(2000);
        return { ok: true, via: 'first-sidebar-row' };
    }
    return { ok: false, reason: 'conversation-row-not-found' };
}

async function selectPreviewTab(page) {
    const menuTrigger = page.locator('.theia-mobile-transcript-tab-icon-select').first();
    if (await menuTrigger.count()) {
        await menuTrigger.click();
        const previewOption = page.locator('.theia-mobile-transcript-tab-icon-select-option').filter({ hasText: /^preview$|^vista previa$/i }).first();
        if (await previewOption.count()) {
            await previewOption.click();
            await page.waitForTimeout(800);
            return { ok: true, via: 'tab-menu' };
        }
        await page.keyboard.press('Escape').catch(() => undefined);
    }
    const previewTab = page.locator('[data-tab="preview"]').first();
    if (await previewTab.count()) {
        await previewTab.click();
        await page.waitForTimeout(800);
        return { ok: true, via: 'data-tab' };
    }
    return { ok: false, reason: 'preview-tab-not-found' };
}

async function clickOpenPreviewIfOffered(page) {
    const openPreview = page.locator('.theia-mobile-transcript-preview-ready-open, button').filter({ hasText: /^open preview$|^abrir vista previa$/i }).first();
    if (await openPreview.count()) {
        await openPreview.click();
        await page.waitForTimeout(1500);
        return { ok: true };
    }
    return { ok: false };
}

async function tryQaapBootstrapBanner(page) {
    const runBtn = page.locator('.qaap-project-bootstrap-banner').getByRole('button', { name: /run & preview|run preview|ejecutar/i }).first();
    if (await runBtn.count()) {
        await runBtn.click();
        return { ok: true, via: 'banner' };
    }
    return { ok: false };
}

async function submitPreviewViaComposer(page, message, timeoutMs = 8000) {
    const composer = page.locator(
        '.theia-mobile-projects-sticky-composer-input, .theia-mobile-transcript-composer .theia-mobile-projects-sticky-composer-input',
    ).first();
    try {
        await composer.waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
        return { ok: false, reason: 'composer-not-visible' };
    }
    await composer.fill(message);
    const sent = await page.evaluate(() => {
        const btn = document.querySelector('.theia-mobile-projects-sticky-composer-send.theia-mod-ready');
        if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
            return false;
        }
        btn.click();
        return true;
    });
    if (!sent) {
        return { ok: false, reason: 'send-not-ready' };
    }
    await page.waitForTimeout(1500);
    return { ok: true };
}

async function clickRunAppQuickAction(page) {
    const runApp = page.locator('.theia-mobile-agent-transcript-empty-action, .theia-mobile-projects-empty-action')
        .filter({ hasText: /run app|ejecutar|levanta/i }).first();
    if (await runApp.count()) {
        await runApp.click();
        await page.waitForTimeout(1500);
        return { ok: true, via: 'quick-action' };
    }
    return { ok: false };
}

async function triggerFrontendDevBootstrap(page) {
    const banner = await tryQaapBootstrapBanner(page);
    if (banner.ok) {
        return banner;
    }
    const quickAction = await clickRunAppQuickAction(page);
    if (quickAction.ok) {
        return quickAction;
    }
    const composer = await submitPreviewViaComposer(page, PREVIEW_PROMPT);
    if (composer.ok) {
        return { ok: true, via: 'composer' };
    }
    return { ok: false, reason: composer.reason ?? 'no-frontend-trigger' };
}

async function mountPreviewIframe(page, port = 5173) {
    const openPreviewOffer = await clickOpenPreviewIfOffered(page);
    if (openPreviewOffer.ok) {
        return { ok: true, via: 'open-preview-button' };
    }
    const mounted = await page.evaluate(async (probePort) => {
        const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' }).catch(() => undefined);
        const previewUrl = response?.ok
            ? ((await response.json())?.previewUrl ?? `${window.location.origin}/qaap-dev/${probePort}/`)
            : `${window.location.origin}/qaap-dev/${probePort}/`;
        const iframe = document.querySelector(
            '.theia-mobile-transcript-preview iframe, .qaap-preview-frame-slot iframe, .theia-mini-browser iframe',
        );
        if (iframe instanceof HTMLIFrameElement) {
            iframe.src = previewUrl;
            return true;
        }
        return false;
    }, port).catch(() => false);
    return { ok: mounted, via: mounted ? 'iframe-src' : 'none' };
}

async function bootstrapPreview(page, workspace, conversation) {
    const result = { steps: [] };

    // Hub composer visible before opening sidebar/transcript.
    result.frontendBootstrap = await triggerFrontendDevBootstrap(page);
    result.steps.push(result.frontendBootstrap.ok
        ? `frontend-bootstrap-${result.frontendBootstrap.via}`
        : `frontend-bootstrap-skipped-${result.frontendBootstrap.reason ?? 'none'}`);

    result.probe = await waitForDevProbe(5173, result.frontendBootstrap.ok ? 45_000 : 5_000);
    result.steps.push(result.probe.ok ? `probe-${result.probe.via}` : 'frontend-probe-pending');

    if (!result.probe.ok) {
        result.devServer = await startWorkspaceDevServer(workspace);
        result.steps.push(result.devServer.probe.ok ? 'dev-server-fallback-ready' : 'dev-server-fallback-timeout');
        result.probe = result.devServer.probe.ok ? result.devServer.probe : await waitForDevProbe(5173, 30_000);
    }

    result.openConversation = await openConversationInTranscript(
        page,
        /Crea una landing|rioja|landing|vite/i,
        conversation?.id,
    );
    result.steps.push(result.openConversation.ok ? 'conversation-opened' : 'conversation-not-found');

    result.previewTab = await selectPreviewTab(page);
    result.steps.push(result.previewTab.ok ? 'preview-tab-selected' : 'preview-tab-missing');

    if (result.probe.ok) {
        result.openPreviewOffer = await mountPreviewIframe(page, 5173);
        if (result.openPreviewOffer.ok) {
            result.steps.push('preview-mounted');
        }
    }

    return result;
}

async function waitForPreview(page, port = 5173, timeoutMs = 180_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        const state = await page.evaluate(async (probePort) => {
            let probeReady = false;
            let previewUrl;
            try {
                const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' });
                if (response.ok) {
                    const body = await response.json();
                    probeReady = body.ready === true;
                    previewUrl = body.previewUrl;
                }
            } catch { /* ignore */ }
            const onPreview = document.querySelector('[data-active-surface="preview"]') !== null;
            const iframe = document.querySelector(`iframe[src*="qaap-dev/${probePort}"]`) !== null;
            const previewTab = document.querySelector('[data-surface="preview"], [data-tab="preview"]') !== null;
            return { probeReady, onPreview, iframe, previewTab, previewUrl };
        }, port);
        if (state.probeReady && (state.onPreview || state.iframe)) {
            return { ...state, elapsedMs: now() - start };
        }
        if ((state.probeReady || await isDirectDevPortReady(port)) && !state.iframe && (now() - start) > 3000) {
            await selectPreviewTab(page).catch(() => undefined);
            await clickOpenPreviewIfOffered(page).catch(() => undefined);
            await page.evaluate(async (probePort) => {
                const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' }).catch(() => undefined);
                const previewUrl = response?.ok
                    ? ((await response.json())?.previewUrl ?? `${window.location.origin}/qaap-dev/${probePort}/`)
                    : `${window.location.origin}/qaap-dev/${probePort}/`;
                const iframe = document.querySelector(
                    '.theia-mobile-transcript-preview iframe, .qaap-preview-frame-slot iframe, .theia-mini-browser iframe',
                );
                if (iframe instanceof HTMLIFrameElement && !iframe.src.includes(`qaap-dev/${probePort}`)) {
                    iframe.src = previewUrl;
                }
            }, port).catch(() => undefined);
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

    const metrics = {
        workspace,
        mockQaiq: { script: resolveMockQaiqPath(), symlink: mockLink },
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

        metrics.backendAgents = await fetchBackendAgents(page);
        if (!metrics.backendAgents.ok || !metrics.backendAgents.agents?.some(a => a.id === 'qaiq')) {
            metrics.errors.push('Backend no detecta QAIQ — reinicia con PATH="/tmp/qaiq-mock-bin:$PATH" npm run start:browser');
            console.warn('\n⚠️  Backend sin QAIQ mock. Reinicia el servidor con:');
            console.warn('   PATH="/tmp/qaiq-mock-bin:$PATH" npm run start:browser\n');
        }

        metrics.newChat = await startNewAgentChat(page).catch(err => ({ ok: false, error: String(err) }));

        const composerVisible = await page.locator('.theia-mobile-projects-sticky-composer-input').isVisible();
        metrics.ux.push(composerVisible ? 'Composer sticky visible en workspace vacío' : 'Composer NO visible tras abrir workspace');
        await page.screenshot({ path: path.join(OUT_DIR, '01-workspace-empty.png'), fullPage: true });

        if (!composerVisible) {
            metrics.errors.push('No se pudo acceder al composer — flujo bloqueado');
            throw new Error('Composer not visible');
        }

        // Phase 2: Start Rioja task via API (cwd explícito — evita que el composer use Mockup)
        const tPrompt = now();
        let conversation;
        try {
            conversation = await createAgentConversation(page, workspace, PROMPT, 'qaiq');
            metrics.conversationCreate = { ok: true, id: conversation.id, agentId: conversation.agentId, cwd: conversation.cwd };
        } catch (err) {
            metrics.conversationCreate = { ok: false, error: String(err) };
            throw err;
        }
        metrics.phases.promptSubmitMs = now() - tPrompt;
        await page.screenshot({ path: path.join(OUT_DIR, '02-prompt-sent.png'), fullPage: true });

        // Phase 3: Wait for agent to complete
        const tAgent = now();
        const conv = await pollConversation(page, workspace, { timeoutMs: 120_000 });
        metrics.phases.agentTurnMs = now() - tAgent;
        metrics.conversation = conv;

        metrics.files = await checkWorkspaceFiles(workspace);
        await page.screenshot({ path: path.join(OUT_DIR, '03-agent-complete.png'), fullPage: true });

        // Phase 4: Bootstrap dev server + abrir preview en transcript
        const tPreviewPrompt = now();
        metrics.previewBootstrap = await bootstrapPreview(page, workspace, conversation).catch(err => ({
            ok: false,
            error: String(err),
            steps: ['bootstrap-threw'],
        }));
        metrics.phases.previewPromptMs = now() - tPreviewPrompt;

        const tPreview = now();
        const preview = await waitForPreview(page, 5173, 120_000);
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

        const devProbeReady = metrics.preview.probeReady
            || metrics.previewBootstrap?.probe?.ok
            || metrics.previewBootstrap?.devServer?.probe?.ok;
        const success = metrics.files.exists?.['index.html']
            && metrics.files.mentionsRioja
            && metrics.files.hasNodeModules
            && devProbeReady
            && metrics.conversation.ok
            && metrics.conversation.status !== 'failed'
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

main();

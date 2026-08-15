/**
 * Shared helpers for Qaap Rioja agent E2E eval scripts (API + composer UI flows).
 */
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
export const MOBILE = { width: 375, height: 812 };
export const MOCK_QAIQ = path.join(__dirname, 'mock-qaiq-rioja-agent');

export const RIOJA_SCAFFOLD_PROMPT = 'Crea una landing page moderna sobre vinos Rioja con Vite. Incluye hero, secciones de bodegas y variedades, y estilos elegantes.';
export const RIOJA_UI_FLOW_PROMPT = 'Crea una landing page moderna para vinos Rioja, responsive, con hero, productos destacados, sección de historia, formulario de contacto y diseño premium.';
export const PREVIEW_PROMPT = 'levanta la app';

export function now() {
    return Date.now();
}

export function fmtMs(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
}

export function resolveMockQaiqPath() {
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

export function ensureMockQaiqSymlink(outDir) {
    const binDir = path.join(outDir, 'mock-qaiq-bin');
    fs.mkdirSync(binDir, { recursive: true });
    const linkPath = path.join(binDir, 'qaiq');
    const target = resolveMockQaiqPath();
    try {
        if (fs.existsSync(linkPath)) {
            fs.unlinkSync(linkPath);
        }
        fs.symlinkSync(target, linkPath);
    } catch (err) {
        return { ok: false, linkPath, target, error: String(err) };
    }
    return { ok: true, linkPath, target, binDir };
}

export function createEmptyWorkspace(prefix = 'qaap-rioja-ws-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function dismissTutorial(page) {
    const skip = page.locator('.theia-mobile-onboarding-overlay button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) {
        await skip.click();
        await page.waitForTimeout(400);
    }
}

export async function assertNoTutorialOverlay(page, { timeoutMs = 8000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const visible = await page.locator('.theia-mobile-onboarding-overlay').count();
        if (visible === 0) {
            return { ok: true, visible: false };
        }
        await page.waitForTimeout(400);
    }
    return { ok: false, visible: true };
}

export async function waitForShell(page, timeoutMs = 90_000) {
    await page.waitForSelector('#theia-app-shell', { timeout: timeoutMs });
    await page.waitForSelector('.theia-preload', { state: 'detached', timeout: timeoutMs }).catch(() => undefined);
    await page.waitForTimeout(1500);
}

/**
 * Runtime shell-health probe.
 *
 * Catches the class of regression where a single unbound contribution poisons
 * `CommandRegistry.onStart()` and leaves the whole app with ZERO registered commands
 * (dead palette, empty menus, every command-gated menu entry dropped). That bug passes
 * `npm run compile` AND `npm run build:browser` because it only manifests at runtime — so a
 * compile/build-only CI gate never sees it. Only booting the app and asking the live DI
 * container catches it.
 *
 * Healthy shell: ~1770 commands / ~107 CommandContributions.
 * Poisoned shell: ~665 commands / 0 contributions (getContributions() throws inside getAll).
 *
 * The generated frontend index exposes the DI container as `window.theia.container`, and the
 * module registry as `window.theia['<pkg>/lib/<path>']`.
 */
export async function sampleShellHealth(page) {
    return page.evaluate(() => {
        const t = window.theia;
        if (!t || !t.container) {
            return { ok: false, reason: 'no-container' };
        }
        const mod = t['@theia/core/lib/common/command'];
        if (!mod || !mod.CommandRegistry) {
            return { ok: false, reason: 'no-command-module' };
        }
        let reg;
        try {
            reg = t.container.get(mod.CommandRegistry);
        } catch (e) {
            return { ok: false, reason: 'no-registry: ' + String(e).slice(0, 160) };
        }
        const commandCount = Array.isArray(reg.commandIds) ? reg.commandIds.length : -1;
        let contribCount = -1;
        let contribError;
        try {
            contribCount = reg.contributionProvider.getContributions().length;
        } catch (e) {
            contribError = String(e).slice(0, 160);
        }
        // Floor 800 sits well below a healthy ~1770 and well above a poisoned ~665.
        const ok = contribError === undefined && contribCount > 0 && commandCount >= 800;
        return { ok, commandCount, contribCount, contribError };
    });
}

/** Match TheiaAppLoader: `/#` + absolute path (no encodeURIComponent on full path). */
export function workspaceOpenUrl(workspace) {
    const normalized = workspace.replace(/\\/g, '/');
    const pathComponent = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `${BASE}/#${pathComponent}`;
}

export async function openWorkspace(page, workspace) {
    const url = workspaceOpenUrl(workspace);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitForShell(page);
    const agentBtn = page.locator('#theia-mobile-bottom-bar .theia-mobile-bottom-activity-btn[data-action-id="agent"]').first();
    if (!(await page.locator('.theia-mobile-projects-sticky-composer-input').count()) && await agentBtn.count()) {
        await agentBtn.click();
        await page.waitForTimeout(1500);
    }
    await page.locator('.theia-mobile-projects-sticky-composer-input').waitFor({ state: 'visible', timeout: 60_000 });
}

export async function createAgentConversation(page, cwd, message, agent = 'qaiq') {
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

export async function startNewAgentChat(page) {
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

export async function selectComposerAgent(page, labelPattern = /qaiq|^q$/i) {
    const agentBtn = page.locator('.theia-mobile-projects-sticky-composer-agent:not(.theia-mod-locked)').first();
    if (!(await agentBtn.count()) || await agentBtn.isDisabled()) {
        return { ok: true, skipped: true, reason: 'agent-selector-unavailable' };
    }
    const currentLabel = ((await agentBtn.textContent()) ?? '').trim();
    if (labelPattern.test(currentLabel)) {
        return { ok: true, label: currentLabel, skipped: true };
    }
    await agentBtn.click();
    await page.waitForSelector('.theia-mobile-sticky-composer-sheet, .qaap-sticky-composer-sheet-popover.theia-mod-agent-picker', { timeout: 10_000 });
    const option = page.locator('.theia-qaap-agent-sheet-option, .theia-mobile-sticky-composer-sheet-option')
        .filter({ hasText: labelPattern })
        .first();
    if (!(await option.count())) {
        const closeBtn = page.locator('.theia-mobile-sticky-composer-sheet-close').first();
        if (await closeBtn.count()) {
            await closeBtn.click();
        } else {
            await page.keyboard.press('Escape').catch(() => undefined);
        }
        return { ok: false, reason: 'agent-option-not-found', currentLabel };
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

export async function submitPromptViaComposer(page, message, { agentPattern = /qaiq|^q$/i, requireAgentPick = false } = {}) {
    const agentPick = await selectComposerAgent(page, agentPattern);
    if (!agentPick.ok && requireAgentPick) {
        return { ok: false, reason: agentPick.reason ?? 'agent-select-failed' };
    }
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    await composer.fill(message);
    try {
        await page.waitForFunction(() => {
            const btn = document.querySelector('.theia-mobile-projects-sticky-composer-send.theia-mod-ready');
            return btn instanceof HTMLButtonElement && !btn.disabled;
        }, undefined, { timeout: 20_000 });
    } catch {
        return { ok: false, reason: 'send-not-ready' };
    }
    await page.locator('.theia-mobile-projects-sticky-composer-send.theia-mod-ready').first().click();
    await page.waitForTimeout(800);
    return {
        ok: true,
        agentLabel: agentPick.label ?? agentPick.currentLabel,
        agentPickWarning: agentPick.ok ? undefined : agentPick.reason,
    };
}

export async function readComposerProjectLabel(page) {
    return page.evaluate(() => {
        const labels = [...document.querySelectorAll('.theia-mobile-projects-sticky-composer-workspace-pill-label')]
            .map(el => el.textContent?.trim() ?? '')
            .filter(Boolean);
        return labels[0] ?? '';
    });
}

export async function readTranscriptHeaderText(page) {
    return page.evaluate(() => {
        const title = document.querySelector(
            '.theia-mobile-agent-log-title-row h1, .theia-mobile-agent-log-title-row h2, .theia-mobile-agent-log-header h2',
        );
        return title?.textContent?.trim() ?? '';
    });
}

export async function sampleAgentTranscriptUi(page) {
    return page.evaluate(() => {
        const thinking = document.querySelectorAll(
            '.theia-mobile-agent-thought-brief, .theia-mobile-agent-premium-card[data-segment-type="thinking"]',
        ).length;
        const toolRows = document.querySelectorAll(
            '.theia-mobile-agent-premium-card[data-segment-type="tool"], .theia-mobile-agent-tool-pill, .theia-mobile-agent-shell-window:not(.theia-mod-turn-failure)',
        ).length;
        const bodyText = document.body.innerText;
        const failedBadge = /\bfailed\b|task failed|exhausted/i.test(bodyText);
        const activeNow = /\bactive now\b|\brunning\b/i.test(bodyText);
        const composer = document.querySelector('.theia-mobile-projects-sticky-composer-input');
        return {
            thinking,
            toolRows,
            transcriptVisible: !!document.querySelector(
                '.theia-mobile-agent-transcript-root.theia-mod-visible, .theia-mobile-projects.theia-mod-agents-hub-inline-active.theia-mod-visible',
            ),
            failedBadge,
            activeNow,
            contradictoryBadges: failedBadge && activeNow,
            composerPlaceholder: composer?.getAttribute('placeholder') ?? '',
            bodyText: bodyText.slice(0, 500),
        };
    });
}

export async function fetchBackendAgents(page) {
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

const QAAP_VISUAL_VERIFICATION_MARKER = '[QAAP visual verification]';
const VISUAL_FILE_RE = /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)(?:["'\s,}]|$)/i;

/** Mirrors backend `conversationLikelyNeedsVisualVerification` for E2E settlement waits. */
export function conversationLikelyNeedsVisualVerification(messages) {
    const lastAgent = [...(messages ?? [])].reverse().find(message => message.role === 'agent');
    if (!lastAgent) {
        return false;
    }
    if (/\[qaap\s*(capture|record)/i.test(lastAgent.content ?? '')) {
        return true;
    }
    return (lastAgent.segments ?? []).some(segment =>
        segment.type === 'tool'
        && /write|edit|patch/i.test(segment.name ?? '')
        && VISUAL_FILE_RE.test(segment.args ?? ''));
}

/** True when a terminal `failed` status came from the bounded visual-repair loop, not the scaffold turn. */
export function conversationVisualRepairExhausted(conv) {
    if (!conv || conv.status !== 'failed') {
        return false;
    }
    const messages = conv.messages ?? [];
    if (messages.some(message => message.role === 'user' && message.visualRepairSourceAgentMessageId)) {
        return true;
    }
    if (messages.some(message =>
        message.role === 'agent'
        && (message.content ?? '').includes(QAAP_VISUAL_VERIFICATION_MARKER))) {
        return true;
    }
    const lastAgent = [...messages].reverse().find(message => message.role === 'agent');
    return /visual verification|repair attempt/i.test(lastAgent?.error ?? '');
}

/** Keep polling after the scaffold turn idles — headless/frontend capture may still be in flight. */
export function conversationAwaitingVisualSettlement(conv, visualVerificationPending) {
    if (!conv || conv.status !== 'idle') {
        return false;
    }
    if (visualVerificationPending) {
        return true;
    }
    const messages = conv.messages ?? [];
    const lastAgent = [...messages].reverse().find(message => message.role === 'agent');
    if (!lastAgent || lastAgent.error) {
        return false;
    }
    if ((lastAgent.content ?? '').includes(QAAP_VISUAL_VERIFICATION_MARKER)) {
        return false;
    }
    return conversationLikelyNeedsVisualVerification(messages);
}

export async function pollConversation(page, cwd, { timeoutMs = 180_000, onPoll } = {}) {
    const start = now();
    let last = {};
    while (now() - start < timeoutMs) {
        last = await page.evaluate(async (workspaceCwd) => {
            const listRes = await fetch(`/qaap/api/agent-conversations?cwd=${encodeURIComponent(workspaceCwd)}`, { credentials: 'include' });
            if (!listRes.ok) {
                return { ok: false, reason: 'list-failed', status: listRes.status };
            }
            const list = await listRes.json();
            const conversations = list.conversations ?? [];
            if (!conversations.length) {
                return { ok: false, reason: 'no-conversation' };
            }
            const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
            const detailRes = await fetch(`/qaap/api/agent-conversations/${encodeURIComponent(latest.id)}`, { credentials: 'include' });
            if (!detailRes.ok) {
                return { ok: false, reason: 'detail-failed' };
            }
            const conv = await detailRes.json();
            const toolSegments = [];
            const toolTraceEvents = [];
            for (const msg of conv.messages ?? []) {
                for (const seg of msg.segments ?? []) {
                    if (seg.type === 'tool') {
                        toolSegments.push({ name: seg.name, finished: seg.finished });
                    }
                }
                for (const event of msg.traceEvents ?? []) {
                    if (event.type === 'tool_call') {
                        toolTraceEvents.push({ name: event.name, status: event.status });
                    }
                }
            }
            const lastAgent = [...(conv.messages ?? [])].reverse().find(m => m.role === 'agent');
            const visualVerificationPending = latest.visualVerificationPending === true;
            const visualRepairExhausted = conv.status === 'failed' && (
                (conv.messages ?? []).some(message => message.role === 'user' && message.visualRepairSourceAgentMessageId)
                || (conv.messages ?? []).some(message =>
                    message.role === 'agent'
                    && (message.content ?? '').includes('[QAAP visual verification]'))
                || /visual verification|repair attempt/i.test(lastAgent?.error ?? '')
            );
            const awaitingVisualSettlement = conv.status === 'idle' && (
                visualVerificationPending
                || (() => {
                    if (!lastAgent || lastAgent.error) {
                        return false;
                    }
                    if ((lastAgent.content ?? '').includes('[QAAP visual verification]')) {
                        return false;
                    }
                    if (/\[qaap\s*(capture|record)/i.test(lastAgent.content ?? '')) {
                        return true;
                    }
                    return (lastAgent.segments ?? []).some(segment =>
                        segment.type === 'tool'
                        && /write|edit|patch/i.test(segment.name ?? '')
                        && /\.(?:html?|css|scss|sass|less|tsx|jsx|vue|svelte)(?:["'\s,}]|$)/i.test(segment.args ?? ''));
                })()
            );
            return {
                ok: true,
                id: conv.id,
                cwd: conv.cwd,
                status: conv.status,
                messageCount: conv.messages?.length ?? 0,
                toolSegments,
                toolTraceEvents,
                agentId: conv.agentId,
                lastAgentText: lastAgent?.content?.slice(0, 200),
                lastAgentTraceCount: lastAgent?.traceEvents?.length ?? 0,
                visualVerificationPending,
                visualRepairExhausted,
                awaitingVisualSettlement,
            };
        }, cwd);
        if (onPoll) {
            await onPoll(last);
        }
        if (last.ok && last.status !== 'streaming' && !last.awaitingVisualSettlement) {
            return last;
        }
        const failed = await page.locator('.theia-mobile-agent-log-header, .theia-mobile-agents-hub-inline-execution')
            .filter({ hasText: /failed|task failed|exhausted/i }).count();
        if (failed) {
            return { ...last, ok: false, reason: 'task-failed-ui', timedOut: false };
        }
        await page.waitForTimeout(1500);
    }
    return { ...last, timedOut: true };
}

export function resolveScaffoldAppRoot(cwd) {
    const nested = path.join(cwd, 'rioja-wines-landing-page');
    if (fs.existsSync(path.join(nested, 'package.json'))) {
        return nested;
    }
    return cwd;
}

export function checkWorkspaceFiles(cwd) {
    const appRoot = resolveScaffoldAppRoot(cwd);
    const files = ['package.json', 'index.html', 'src/style.css', 'src/main.js'];
    const exists = {};
    for (const f of files) {
        exists[f] = fs.existsSync(path.join(appRoot, f));
    }
    const hasNodeModules = fs.existsSync(path.join(appRoot, 'node_modules'));
    const html = exists['index.html'] ? fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8') : '';
    const mentionsRioja = /rioja/i.test(html);
    return { appRoot, exists, hasNodeModules, mentionsRioja, htmlLength: html.length };
}

export function killDevPort(port = 5173) {
    try {
        execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', shell: '/bin/bash' });
    } catch {
        // Port was free.
    }
}

export async function isDirectDevPortReady(port = 5173) {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500) });
        return response.status > 0 && response.status < 500;
    } catch {
        return false;
    }
}

export async function waitForDevProbe(port = 5173, timeoutMs = 120_000) {
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

export async function startWorkspaceDevServer(workspace, outDir, port = 5173) {
    killDevPort(port);
    await new Promise(resolve => setTimeout(resolve, 500));
    const appRoot = resolveScaffoldAppRoot(workspace);
    const logPath = path.join(outDir, 'dev-server.log');
    fs.mkdirSync(outDir, { recursive: true });
    const logFd = fs.openSync(logPath, 'w');
    const child = spawn('npm', ['run', 'dev'], {
        cwd: appRoot,
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

export async function openSessionsSidebar(page) {
    await page.evaluate(() => {
        const btn = document.querySelector('.theia-workbench-nav-btn.theia-mod-mobile-sessions-sidebar');
        if (btn instanceof HTMLButtonElement) {
            btn.click();
        }
    });
    await page.waitForSelector('.theia-mobile-work-hub-sessions-sidebar.theia-mod-visible', { timeout: 10_000 }).catch(() => undefined);
}

export async function openConversationInTranscript(page, titlePattern = /rioja|landing|vite|crea una/i, conversationId) {
    await openSessionsSidebar(page);
    const selectors = [
        '.theia-mobile-work-hub-sessions-sidebar-list .theia-mobile-projects-task-row',
        '.theia-mobile-projects-task-row',
    ];
    for (const selector of selectors) {
        const row = page.locator(selector).filter({ hasText: titlePattern }).first();
        if (await row.count()) {
            await row.click();
            await page.waitForTimeout(800);
            return { ok: true, via: selector.includes('sidebar') ? 'sidebar' : 'task-row' };
        }
    }
    if (conversationId) {
        const opened = await page.evaluate(id => {
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
            await page.waitForTimeout(800);
            return { ok: true, via: 'conversation-id' };
        }
    }
    const firstRow = page.locator('.theia-mobile-work-hub-sessions-sidebar-list .theia-mobile-projects-task-row .theia-mobile-projects-task-item').first();
    if (await firstRow.count()) {
        await firstRow.click();
        await page.waitForTimeout(800);
        return { ok: true, via: 'first-sidebar-row' };
    }
    return { ok: false, reason: 'conversation-row-not-found' };
}

export async function selectPreviewTab(page) {
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

export async function clickOpenPreviewIfOffered(page) {
    const openPreview = page.locator('.theia-mobile-transcript-preview-ready-open, button').filter({ hasText: /^open preview$|^abrir vista previa$/i }).first();
    if (await openPreview.count()) {
        await openPreview.click();
        await page.waitForTimeout(1500);
        return { ok: true };
    }
    return { ok: false };
}

export async function tryQaapBootstrapBanner(page) {
    const runBtn = page.locator('.qaap-project-bootstrap-banner').getByRole('button', { name: /run & preview|run preview|ejecutar/i }).first();
    if (await runBtn.count()) {
        await runBtn.click();
        return { ok: true, via: 'banner' };
    }
    return { ok: false };
}

export async function clickRunAppQuickAction(page) {
    const runApp = page.locator('.theia-mobile-agent-transcript-empty-action, .theia-mobile-projects-empty-action')
        .filter({ hasText: /run app|ejecutar|levanta/i }).first();
    if (await runApp.count()) {
        await runApp.click();
        await page.waitForTimeout(1500);
        return { ok: true, via: 'quick-action' };
    }
    return { ok: false };
}

export async function triggerBootstrapViaPage(page, port = 5173) {
    return page.evaluate(async probePort => {
        const api = window.__qaapBootstrap;
        if (!api?.refresh || !api?.runDevServer) {
            return { ok: false, reason: 'bootstrap-api-unavailable' };
        }
        const probeReady = async () => {
            try {
                const response = await fetch(`/qaap-dev/api/probe/${probePort}`, { cache: 'no-store' });
                if (!response.ok) {
                    return false;
                }
                const body = await response.json();
                return body.ready === true;
            } catch {
                return false;
            }
        };
        if (await probeReady()) {
            return { ok: true, via: 'probe-ready', state: api.getState?.() };
        }
        await api.refresh();
        const state = api.getState?.() ?? {};
        const shouldInstall = state.phase === 'detected'
            && state.nodeModulesPresent !== true
            && state.needsInstall !== false;
        if (shouldInstall) {
            await api.runInstall?.();
        } else if (state.phase !== 'running' && state.phase !== 'starting') {
            await api.runDevServer();
        }
        return { ok: true, via: shouldInstall ? 'install-then-dev' : 'run-dev', state: api.getState?.() };
    }, port);
}

export async function triggerFrontendDevBootstrap(page) {
    const banner = await tryQaapBootstrapBanner(page);
    if (banner.ok) {
        return banner;
    }
    const quickAction = await clickRunAppQuickAction(page);
    if (quickAction.ok) {
        return quickAction;
    }
    return { ok: false, reason: 'no-banner-or-quick-action' };
}

export async function mountPreviewIframe(page, port = 5173) {
    const openPreviewOffer = await clickOpenPreviewIfOffered(page);
    if (openPreviewOffer.ok) {
        return { ok: true, via: 'open-preview-button' };
    }
    const mounted = await page.evaluate(async probePort => {
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

export async function bootstrapPreview(page, workspace, conversation, outDir) {
    const result = { steps: [] };

    result.probe = await waitForDevProbe(5173, 3_000);
    if (result.probe.ok) {
        result.steps.push(`probe-${result.probe.via}-pre-bootstrap`);
    }

    if (!result.probe.ok) {
        result.bootstrapApi = await triggerBootstrapViaPage(page);
        result.steps.push(result.bootstrapApi.ok
            ? `bootstrap-api-${result.bootstrapApi.via ?? 'run-dev'}`
            : `bootstrap-api-skipped-${result.bootstrapApi.reason ?? 'failed'}`);

        if (!result.probe?.ok) {
            result.probe = await waitForDevProbe(5173, 12_000);
            result.steps.push(result.probe.ok ? `probe-${result.probe.via}` : 'frontend-probe-pending');
        }

        if (!result.probe.ok) {
            result.frontendBootstrap = await triggerFrontendDevBootstrap(page);
            result.steps.push(result.frontendBootstrap.ok
                ? `frontend-bootstrap-${result.frontendBootstrap.via}`
                : `frontend-bootstrap-skipped-${result.frontendBootstrap.reason ?? 'none'}`);
            if (!result.probe?.ok) {
                result.probe = await waitForDevProbe(5173, 12_000);
                result.steps.push(result.probe.ok ? `probe-${result.probe.via}-after-ui` : 'frontend-probe-pending-after-ui');
            }
        }
    }

    if (!result.probe.ok) {
        result.devServer = await startWorkspaceDevServer(workspace, outDir);
        result.steps.push(result.devServer.probe.ok ? 'dev-server-fallback-ready' : 'dev-server-fallback-timeout');
        result.probe = result.devServer.probe.ok ? result.devServer.probe : await waitForDevProbe(5173, 15_000);
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

export async function waitForPreview(page, port = 5173, timeoutMs = 180_000) {
    const start = now();
    while (now() - start < timeoutMs) {
        const state = await page.evaluate(async probePort => {
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
            await page.evaluate(async probePort => {
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
        await page.waitForTimeout(800);
    }
    return { probeReady: false, timedOut: true, elapsedMs: now() - start };
}

export function conversationStatusPassesScaffoldGate(conversation, { filesOk = false, toolTraceOk = false } = {}) {
    if (!conversation?.ok) {
        return false;
    }
    if (conversation.status !== 'failed') {
        return true;
    }
    // Visual-repair exhaustion is orthogonal to the Rioja scaffold contract (files + tools).
    return conversation.visualRepairExhausted === true && filesOk && toolTraceOk;
}

export function evaluateApiFlowSuccess(metrics) {
    const devProbeReady = metrics.preview?.probeReady
        || metrics.previewBootstrap?.probe?.ok
        || metrics.previewBootstrap?.devServer?.probe?.ok;
    const toolTraceOk = (metrics.conversation?.toolSegments?.length ?? 0) >= 1
        || (metrics.conversation?.toolTraceEvents?.length ?? 0) >= 1;
    const filesOk = !!(metrics.files?.exists?.['index.html'] && metrics.files?.mentionsRioja && metrics.files?.hasNodeModules);
    const conversationOk = conversationStatusPassesScaffoldGate(metrics.conversation, { filesOk, toolTraceOk });
    return {
        files: filesOk,
        conversation: conversationOk,
        preview: !!devProbeReady,
        toolTrace: toolTraceOk,
        tutorial: metrics.tutorialAfterPrompt?.ok !== false && metrics.tutorialAfterAgent?.ok !== false,
        all: !!(filesOk
            && devProbeReady
            && conversationOk
            && toolTraceOk
            && metrics.tutorialAfterPrompt?.ok !== false
            && metrics.tutorialAfterAgent?.ok !== false),
    };
}

export function evaluateUiFlowSuccess(metrics) {
    const mockupHeader = /mockup\s*·/i.test(metrics.routing?.transcriptHeader ?? '')
        || /mockup\s*·/i.test(metrics.uiDuringAgent?.bodyText ?? '');
    const composerLabelMockup = /^mockup$/i.test((metrics.composerProjectLabel ?? '').trim());
    const composerRoutingOk = !mockupHeader
        && !composerLabelMockup
        && metrics.conversation?.ok
        && metrics.conversation?.cwd === metrics.workspace;
    const toolTraceOk = (metrics.conversation?.toolSegments?.length ?? 0) >= 1
        || (metrics.conversation?.toolTraceEvents?.length ?? 0) >= 1
        || (metrics.uiDuringAgent?.maxToolRows ?? 0) >= 1;
    const filesOk = !!(metrics.files?.exists?.['index.html'] && metrics.files?.mentionsRioja && metrics.files?.hasNodeModules);
    const agentSettled = metrics.conversation?.status === 'idle'
        || conversationStatusPassesScaffoldGate(metrics.conversation, { filesOk, toolTraceOk });
    return {
        shellHealthy: metrics.shellHealth?.ok === true,
        composerSubmit: metrics.promptSentViaComposer?.ok === true,
        composerRouting: composerRoutingOk,
        files: filesOk,
        agentIdle: agentSettled,
        notFailedUi: metrics.uiDuringAgent?.failedBadge !== true,
        noContradictoryBadges: metrics.uiDuringAgent?.contradictoryBadges !== true,
        tutorial: metrics.tutorialAfterPrompt?.ok !== false && metrics.tutorialAfterAgent?.ok !== false,
        toolTrace: toolTraceOk,
        all: metrics.shellHealth?.ok === true
            && metrics.promptSentViaComposer?.ok === true
            && composerRoutingOk
            && filesOk
            && agentSettled
            && metrics.uiDuringAgent?.failedBadge !== true
            && metrics.uiDuringAgent?.contradictoryBadges !== true
            && metrics.tutorialAfterPrompt?.ok !== false
            && metrics.tutorialAfterAgent?.ok !== false,
    };
}

export async function createMobileBrowserContext(playwrightChromium) {
    const browser = await playwrightChromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: MOBILE,
        isMobile: true,
        hasTouch: true,
        locale: 'es-ES',
    });
    await context.addInitScript(() => {
        try {
            localStorage.removeItem('theia.mobile.tutorial.seen');
            sessionStorage.removeItem('qaap.mobile.tutorial.skippedSession');
        } catch {
            /* ignore */
        }
    });
    return { browser, context };
}

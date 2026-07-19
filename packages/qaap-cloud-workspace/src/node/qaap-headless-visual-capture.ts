// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
    agentMessageHasVisualVerificationMarker,
    parseQaapCaptureDirective,
    type QaapPreviewVisualValidationResult,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import { deriveVisualFlowSteps } from '@theia/qaap-mobile-shell/lib/common/qaap-visual-flow-plan';
import { conversationNeedsVisualVerificationEvidence, type QaapAgentConversation } from '../common/qaap-agent-conversation';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { QaapPreviewSupervisor } from './qaap-preview-supervisor';

/**
 * Server-side visual evidence: a headless Chromium (playwright-core) drives the workspace's dev
 * server and screenshots the walked routes, so evidence no longer depends on any browser tab
 * being open — the structural weakness of the frontend capture path on the VPS. The frontend
 * autopilot stays as fallback; the shared `[QAAP visual verification]` marker plus the store's
 * in-flight lock keep the two paths from double-attaching.
 *
 * Disabled cleanly when no Chromium binary is resolvable (the frontend path still works).
 * Set `QAAP_HEADLESS_VISUAL_CAPTURE=0|false|off` to turn it off explicitly.
 */

const HEADLESS_CAPTURE_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_HEADLESS_VISUAL_CAPTURE?.trim() ?? '');
/** Wait budget for a dev server we just started (cold installs can be slow). */
const SERVER_READY_TIMEOUT_MS = 90_000;
const SERVER_PROBE_INTERVAL_MS = 750;
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_MS = 700;
/** Stay under the 5 MB evidence cap with margin. */
const MAX_EVIDENCE_BYTES = 4_500_000;
const CAPTURE_VIEWPORT = { width: 1280, height: 900 } as const;

const SKIPPED_SCAN_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.cache']);

declare const __non_webpack_require__: NodeRequire | undefined;

/**
 * playwright-core cannot be bundled (dynamic requires + browser assets) — load it from
 * node_modules at runtime, bypassing the backend webpack bundle.
 */
function loadPlaywrightCore(): { chromium: { launch(options: object): Promise<any>; executablePath(): string } } {
    const nodeRequire: NodeRequire = typeof __non_webpack_require__ === 'function'
        ? __non_webpack_require__
        // eslint-disable-next-line no-eval
        : eval('require');
    return nodeRequire('playwright-core');
}

export interface QaapHeadlessCaptureAppTarget {
    /** Directory the dev server runs in (may be a child project of the workspace root). */
    readonly root: string;
    readonly kind: 'script' | 'static';
    /** Port the app is expected on; `PORT` env is injected, Vite-style configs are parsed. */
    readonly expectedPort: number;
}

function readPackageJson(dir: string): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
        return undefined;
    }
}

function expectedPortForProject(dir: string, pkg: NonNullable<ReturnType<typeof readPackageJson>>): number {
    // A port pinned in the dev/start script itself wins over everything —
    // "http-server -p 8080", "python3 -m http.server 5173", "vite --port 4444".
    for (const script of [pkg.scripts?.['dev'], pkg.scripts?.['start']]) {
        const pinned = /\b(\d{4,5})\b/.exec(script ?? '');
        if (pinned) {
            return Number(pinned[1]);
        }
    }
    // An explicit Vite server.port wins over framework defaults.
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
        try {
            const config = fs.readFileSync(path.join(dir, name), 'utf8');
            const match = /port\s*:\s*(\d{2,5})/.exec(config);
            if (match) {
                return Number(match[1]);
            }
        } catch {
            /* next candidate */
        }
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['vite']) {
        return 5173;
    }
    if (deps['astro']) {
        return 4321;
    }
    // next / react-scripts / nuxt / generic node servers default to 3000 and honor $PORT.
    return 3000;
}

/** The IDE's own listen port must never be probed or captured as "the app". */
export function qaapIdeListenPort(): number {
    const fromEnv = Number(process.env.PORT);
    return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3000;
}

function scriptProjectAt(dir: string): QaapHeadlessCaptureAppTarget | undefined {
    const pkg = readPackageJson(dir);
    if (!pkg?.scripts || !(pkg.scripts['dev'] || pkg.scripts['start'])) {
        return undefined;
    }
    return { root: dir, kind: 'script', expectedPort: expectedPortForProject(dir, pkg) };
}

/**
 * Resolves what to run for a workspace: the root project, the first runnable child project
 * (depth ≤ 2 — covers `artifacts/<app>` layouts), or a plain static site (`index.html`).
 */
export function resolveHeadlessCaptureAppTarget(cwd: string): QaapHeadlessCaptureAppTarget | undefined {
    const atRoot = scriptProjectAt(cwd);
    if (atRoot) {
        return atRoot;
    }
    const listDirs = (dir: string): string[] => {
        try {
            return fs.readdirSync(dir, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && !SKIPPED_SCAN_DIRS.has(entry.name) && !entry.name.startsWith('.'))
                .map(entry => path.join(dir, entry.name));
        } catch {
            return [];
        }
    };
    const level1 = listDirs(cwd);
    for (const child of level1) {
        const target = scriptProjectAt(child);
        if (target) {
            return target;
        }
    }
    for (const child of level1) {
        for (const grandChild of listDirs(child)) {
            const target = scriptProjectAt(grandChild);
            if (target) {
                return target;
            }
        }
    }
    if (fs.existsSync(path.join(cwd, 'index.html'))) {
        return { root: cwd, kind: 'static', expectedPort: 0 };
    }
    return undefined;
}

/** Resolves a Chromium executable: explicit env → playwright-core install → system binaries. */
export function resolveHeadlessChromiumExecutable(): string | undefined {
    const explicit = process.env.QAAP_HEADLESS_CHROMIUM?.trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    try {
        const bundled = loadPlaywrightCore().chromium.executablePath();
        if (bundled && fs.existsSync(bundled)) {
            return bundled;
        }
    } catch {
        /* fall through to system binaries */
    }
    const systemCandidates = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    return systemCandidates.find(candidate => fs.existsSync(candidate));
}

/** Same-shape DOM smoke check as the frontend's validateQaapPreviewDocument, run in the page. */
const PAGE_SMOKE_CHECK = `(() => {
    const issues = [];
    const bodyText = (document.body && (document.body.innerText || document.body.textContent) || '').trim();
    if (bodyText.length < 20) { issues.push('The page appears empty or contains very little visible text.'); }
    if (!document.querySelector('h1')) { issues.push('No primary page heading (h1) was found.'); }
    const brokenImages = [...document.images].filter(i => i.complete && i.naturalWidth === 0).length;
    if (brokenImages > 0) { issues.push(brokenImages + ' image' + (brokenImages === 1 ? '' : 's') + ' failed to load.'); }
    const hasName = el => !!((el.getAttribute('aria-label') || '').trim()
        || (el.getAttribute('aria-labelledby') || '').trim()
        || (el.getAttribute('title') || '').trim()
        || (el.textContent || '').trim());
    const unnamed = [...document.querySelectorAll('button, [role="button"]')].filter(b => !hasName(b)).length;
    if (unnamed > 0) { issues.push(unnamed + ' button' + (unnamed === 1 ? '' : 's') + ' lack an accessible name.'); }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) {
        issues.push('The page has horizontal overflow at the captured viewport width.');
    }
    const interactive = document.querySelectorAll('a, button, input, textarea, select, [role="button"]').length;
    return {
        status: issues.length === 0 ? 'passed' : 'warning',
        summary: issues.length === 0
            ? 'Preview loaded and passed the DOM smoke check (' + interactive + ' interactive elements).'
            : 'Preview loaded with ' + issues.length + ' visual/accessibility finding' + (issues.length === 1 ? '' : 's') + '.',
        issues,
    };
})()`;

@injectable()
export class QaapHeadlessVisualCaptureService {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapPreviewSupervisor)
    protected readonly supervisor: QaapPreviewSupervisor;

    protected readonly inFlight = new Set<string>();
    /** One headless attempt per settled turn (`conversationId:messageCount`). */
    protected readonly attemptedTurns = new Set<string>();
    protected chromiumMissingLogged = false;
    /** Serializes captures — one headless browser at a time. */
    protected queue: Promise<void> = Promise.resolve();

    @postConstruct()
    protected init(): void {
        if (!HEADLESS_CAPTURE_ENABLED) {
            return;
        }
        this.store.onDidChange(event => {
            if ((event.type === 'updated' || event.type === 'created') && event.conversation.visualVerificationPending) {
                this.schedule(event.conversation.id, event.conversation.messageCount);
            }
        });
        // Startup sweep: settle evidence slots that were pending when the backend last stopped
        // (turns that settled mid-restart, or before this service existed).
        setTimeout(() => {
            for (const summary of this.store.list(undefined)) {
                if (summary.visualVerificationPending) {
                    this.schedule(summary.id, summary.messageCount);
                }
            }
        }, 10_000);
    }

    protected schedule(conversationId: string, messageCount: number): void {
        const turnKey = `${conversationId}:${messageCount}`;
        if (this.inFlight.has(conversationId) || this.attemptedTurns.has(turnKey)) {
            return;
        }
        this.attemptedTurns.add(turnKey);
        this.inFlight.add(conversationId);
        this.queue = this.queue
            .then(() => this.captureConversation(conversationId))
            .catch(error => {
                console.warn('[qaap-headless-visual-capture] capture failed:', error);
                this.recordHeadlessCaptureFailure(conversationId, error);
            })
            .finally(() => {
                this.inFlight.delete(conversationId);
            });
    }

    /**
     * Uncaught capture failures (Playwright launch, temp-dir IO, etc.) used to leave
     * `[QAAP record]` turns spinning forever — attemptedTurns blocks retry, so settle the
     * evidence slot with a visible note instead.
     */
    protected recordHeadlessCaptureFailure(conversationId: string, error: unknown): void {
        const conv = this.store.get(conversationId);
        if (!conv || !conversationNeedsVisualVerificationEvidence(conv)) {
            return;
        }
        const target = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!target || agentMessageHasVisualVerificationMarker(target)) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.store.recordVisualVerificationFailure(
            conversationId,
            `Headless capture failed: ${message}`,
            target.id,
        );
    }

    protected async captureConversation(conversationId: string): Promise<void> {
        const conv = this.store.get(conversationId);
        if (!conv || !conversationNeedsVisualVerificationEvidence(conv)) {
            return;
        }
        const target = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!target || agentMessageHasVisualVerificationMarker(target)) {
            return;
        }
        const captureDirective = parseQaapCaptureDirective(target);
        const chromium = resolveHeadlessChromiumExecutable();
        if (!chromium) {
            if (captureDirective.mode === 'video') {
                this.store.recordVisualVerificationFailure(
                    conversationId,
                    'Video recording requires a server-side Chromium binary (set QAAP_HEADLESS_CHROMIUM '
                    + 'or install playwright browsers). Screenshots cannot substitute for [QAAP record].',
                    target.id,
                );
                return;
            }
            if (!this.chromiumMissingLogged) {
                this.chromiumMissingLogged = true;
                console.info('[qaap-headless-visual-capture] no Chromium binary found '
                    + '(set QAAP_HEADLESS_CHROMIUM or install playwright browsers); leaving capture to the frontend.');
            }
            return;
        }
        const app = resolveHeadlessCaptureAppTarget(conv.cwd);
        if (!app) {
            this.store.recordVisualVerificationFailure(
                conversationId,
                'No runnable app was found in the workspace (no package.json dev/start script and no index.html), '
                + 'so no screenshot could be captured. Scaffold the app first.',
                target.id,
            );
            return;
        }
        let staticServer: http.Server | undefined;
        try {
            let port: number;
            if (app.kind === 'static') {
                const started = await this.startStaticServer(app.root);
                staticServer = started.server;
                port = started.port;
            } else {
                const ready = await this.ensureScriptServer(app);
                if (ready.ok) {
                    port = ready.port;
                } else {
                    // The dev script did not yield a reachable port, but the app may still be a
                    // plain static site behind a wrapper script — serve it in-process instead of
                    // giving up (a landing page's `dev: http-server` counts on exactly this).
                    const staticRoot = [app.root, conv.cwd].find(dir => fs.existsSync(path.join(dir, 'index.html')));
                    if (!staticRoot) {
                        this.store.recordVisualVerificationFailure(
                            conversationId,
                            `The dev server did not become ready for the capture: ${ready.reason}`,
                            target.id,
                        );
                        return;
                    }
                    const started = await this.startStaticServer(staticRoot);
                    staticServer = started.server;
                    port = started.port;
                }
            }
            if (captureDirective.mode === 'video') {
                await this.recordFlowVideo(conversationId, conv, target.id, port);
            } else {
                await this.captureFlow(conversationId, conv, target.id, port);
            }
        } finally {
            staticServer?.close();
        }
    }

    /** Reuses an already-listening expected port, otherwise starts the app via the supervisor. */
    protected async ensureScriptServer(app: QaapHeadlessCaptureAppTarget): Promise<{ ok: true; port: number } | { ok: false; reason: string }> {
        // Probing the IDE's own listen port would "find" Qaap itself and screenshot the wrong
        // thing — shift to an alternate port instead ($PORT-honoring dev servers follow along).
        const port = app.expectedPort === qaapIdeListenPort() ? app.expectedPort + 7 : app.expectedPort;
        if (await this.probePort(port)) {
            return { ok: true, port };
        }
        // Identity-keyed (per app root), never the global `legacy-port-<port>` supervisor key:
        // capture servers must not collide with — or be mistaken for — user preview processes.
        // Deliberately NOT registered in the dev-preview port registry: this is an internal
        // loopback server, not a user-facing preview, and must stay non-proxyable.
        this.supervisor.start(app.root, port, {
            previewId: `qaap-headless-capture:${app.root}`,
            projectId: app.root,
        });
        const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (await this.probePort(port)) {
                return { ok: true, port };
            }
            const snapshot = this.supervisor.describe(port);
            if (snapshot?.status === 'exited') {
                const tail = snapshot.stderrTail?.slice(-3).join(' ').trim();
                return { ok: false, reason: tail || `the dev process exited (code ${snapshot.exitCode ?? '?'})` };
            }
            await new Promise(resolve => setTimeout(resolve, SERVER_PROBE_INTERVAL_MS));
        }
        return { ok: false, reason: `nothing answered on port ${port} within ${SERVER_READY_TIMEOUT_MS / 1000}s` };
    }

    protected probePort(port: number): Promise<boolean> {
        const probeHost = (host: string): Promise<boolean> => new Promise(resolve => {
            const request = http.get({ host, port, path: '/', timeout: 2000 }, response => {
                response.resume();
                resolve(true);
            });
            request.on('timeout', () => {
                request.destroy();
                resolve(false);
            });
            request.on('error', () => resolve(false));
        });
        return probeHost('127.0.0.1').then(ok => ok || probeHost('::1'));
    }

    /** Minimal read-only static file server for `index.html` workspaces, bound to loopback. */
    protected startStaticServer(root: string): Promise<{ server: http.Server; port: number }> {
        const server = http.createServer(async (request, response) => {
            try {
                const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
                const resolved = path.normalize(path.join(root, requested));
                if (!resolved.startsWith(path.normalize(root))) {
                    response.writeHead(403).end();
                    return;
                }
                let filePath = resolved;
                const stat = await fsp.stat(filePath).catch(() => undefined);
                if (!stat || stat.isDirectory()) {
                    filePath = path.join(stat ? filePath : root, 'index.html');
                }
                const body = await fsp.readFile(filePath);
                const types: Record<string, string> = {
                    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
                };
                response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream' });
                response.end(body);
            } catch {
                response.writeHead(404).end();
            }
        });
        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (address && typeof address === 'object') {
                    resolve({ server, port: address.port });
                } else {
                    reject(new Error('static server did not report a port'));
                }
            });
        });
    }

    protected async captureFlow(
        conversationId: string,
        conv: QaapAgentConversation,
        targetAgentMessageId: string,
        port: number,
    ): Promise<void> {
        const { chromium } = loadPlaywrightCore();
        const browser = await chromium.launch({
            executablePath: resolveHeadlessChromiumExecutable(),
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
        try {
            const context = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT } });
            const page = await context.newPage();
            const steps = deriveVisualFlowSteps(conv);
            const captured: { label: string; evidenceId: string; result: QaapPreviewVisualValidationResult }[] = [];
            const skipped: string[] = [];
            for (const step of steps) {
                try {
                    await page.goto(`http://127.0.0.1:${port}${step}`, { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS });
                    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
                    await page.waitForTimeout(PAGE_SETTLE_MS);
                    const result = await page.evaluate(PAGE_SMOKE_CHECK) as QaapPreviewVisualValidationResult;
                    let png: Buffer = await page.screenshot({ fullPage: true, type: 'png' });
                    if (png.length > MAX_EVIDENCE_BYTES) {
                        png = await page.screenshot({ fullPage: false, type: 'png' });
                    }
                    const evidenceId = await this.store.saveVisualEvidenceImage(conversationId, png);
                    if (!evidenceId) {
                        throw new Error('the evidence store rejected the image');
                    }
                    captured.push({ label: step, evidenceId, result });
                } catch (error) {
                    skipped.push(`\`${step}\`: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (captured.length === 0) {
                this.store.recordVisualVerificationFailure(
                    conversationId,
                    `Headless capture reached the dev server but no route could be captured — ${skipped.join('; ')}`,
                    targetAgentMessageId,
                );
                return;
            }
            if (skipped.length > 0) {
                const first = captured[0];
                captured[0] = {
                    ...first,
                    result: {
                        ...first.result,
                        status: 'warning',
                        issues: [...first.result.issues, ...skipped.map(reason => `Could not capture ${reason}.`)],
                    },
                };
            }
            await this.store.recordVisualVerificationFlow(conversationId, captured, targetAgentMessageId);
        } finally {
            await browser.close().catch(() => undefined);
        }
    }

    /**
     * `[QAAP record]`: one continuous webm of the walked routes — each page is loaded, settled,
     * and smoothly scrolled top-to-bottom, so motion, transitions, and below-the-fold content
     * show up where a static screenshot cannot.
     */
    protected async recordFlowVideo(
        conversationId: string,
        conv: QaapAgentConversation,
        targetAgentMessageId: string,
        port: number,
    ): Promise<void> {
        const { chromium } = loadPlaywrightCore();
        const videoDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qaap-visual-video-'));
        const browser = await chromium.launch({
            executablePath: resolveHeadlessChromiumExecutable(),
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
        let videoPath: string | undefined;
        const stepResults: { label: string; result: QaapPreviewVisualValidationResult }[] = [];
        const skipped: string[] = [];
        try {
            const context = await browser.newContext({
                viewport: { ...CAPTURE_VIEWPORT },
                recordVideo: { dir: videoDir, size: { ...CAPTURE_VIEWPORT } },
            });
            const page = await context.newPage();
            const video = page.video();
            for (const step of deriveVisualFlowSteps(conv)) {
                try {
                    await page.goto(`http://127.0.0.1:${port}${step}`, { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS });
                    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
                    await page.waitForTimeout(PAGE_SETTLE_MS);
                    const result = await page.evaluate(PAGE_SMOKE_CHECK) as QaapPreviewVisualValidationResult;
                    stepResults.push({ label: step, result });
                    // Scroll tour: reveal the page gradually so the recording shows all content.
                    await page.evaluate(`new Promise(resolve => {
                        const total = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
                        if (total === 0) { resolve(undefined); return; }
                        let y = 0;
                        const tick = () => {
                            y = Math.min(total, y + Math.max(12, total / 90));
                            window.scrollTo(0, y);
                            if (y >= total) { resolve(undefined); } else { requestAnimationFrame(tick); }
                        };
                        requestAnimationFrame(tick);
                    })`);
                    await page.waitForTimeout(800);
                } catch (error) {
                    skipped.push(`\`${step}\`: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            await context.close();
            videoPath = video ? await video.path() : undefined;
        } finally {
            await browser.close().catch(() => undefined);
        }
        try {
            if (stepResults.length === 0 || !videoPath) {
                this.store.recordVisualVerificationFailure(
                    conversationId,
                    `Headless recording reached the dev server but produced no video — ${skipped.join('; ') || 'no route loaded'}`,
                    targetAgentMessageId,
                );
                return;
            }
            if (skipped.length > 0) {
                const first = stepResults[0];
                stepResults[0] = {
                    ...first,
                    result: {
                        ...first.result,
                        status: 'warning',
                        issues: [...first.result.issues, ...skipped.map(reason => `Could not record ${reason}.`)],
                    },
                };
            }
            const evidenceId = await this.store.saveVisualEvidenceVideo(conversationId, videoPath);
            if (!evidenceId) {
                this.store.recordVisualVerificationFailure(
                    conversationId,
                    'The recorded video could not be stored (size cap or storage limit reached).',
                    targetAgentMessageId,
                );
                return;
            }
            this.store.recordVisualVerificationVideo(conversationId, evidenceId, stepResults, targetAgentMessageId);
        } finally {
            await fsp.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

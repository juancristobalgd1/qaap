// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { QAAP_SKIP_AUTH_USER_LOGIN } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import {
    agentMessageHasVisualVerificationMarker,
    parseQaapCaptureDirective,
    type QaapPreviewVisualValidationResult,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import { buildQaapIdentityPreviewUrl } from '@theia/qaap-mobile-shell/lib/common/qaap-dev-preview';
import {
    isQaapProcessPreviewIdentity,
    resolveQaapPreviewIdentity,
    type QaapProcessPreviewIdentity,
} from '@theia/qaap-mobile-shell/lib/common/qaap-preview-identity';
import {
    QaapDevPreviewPortRegistry,
    type QaapDevPreviewRecord,
} from '@theia/qaap-mobile-shell/lib/node/qaap-dev-preview-port-registry';
import { deriveVisualFlowSteps } from '@theia/qaap-mobile-shell/lib/common/qaap-visual-flow-plan';
import {
    QAAP_PREVIEW_CONFIG_PATH,
    QaapPreviewLaunchPlan,
    materializeQaapPreviewLaunchPlan,
    parseQaapPreviewLaunchConfigJson,
} from '@theia/qaap-mobile-shell/lib/common/qaap-preview-launch-plan';
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
/** Boot backlog cap: everything beyond this settles lazily when its conversation reactivates. */
const STARTUP_SWEEP_MAX_CAPTURES = 2;
/** Let the backend finish booting (plugins, frontends reconnecting) before any capture work. */
const STARTUP_SWEEP_DELAY_MS = 60_000;
/** Wait budget for a dev server we just started (cold installs can be slow). */
const SERVER_READY_TIMEOUT_MS = 90_000;
const SERVER_PROBE_INTERVAL_MS = 750;
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_MS = 700;
/** Stay under the 5 MB evidence cap with margin. */
const MAX_EVIDENCE_BYTES = 4_500_000;
const CAPTURE_VIEWPORT = { width: 1280, height: 900 } as const;
const DEFAULT_PUBLIC_PREVIEW_LEASE_MS = 15 * 60_000;
const MIN_PUBLIC_PREVIEW_LEASE_MS = 60_000;
const MAX_PUBLIC_PREVIEW_LEASE_MS = 24 * 60 * 60_000;
const MAX_RETAINED_PREVIEWS_PER_OWNER = 3;

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
    /** Exact argv plan shared with the frontend for non-package.json runtimes. */
    readonly launch?: QaapPreviewLaunchPlan;
}

interface QaapHeadlessPublicPreview {
    readonly identity: QaapProcessPreviewIdentity & { readonly previewId: string };
    readonly ownerLogin: string;
    readonly record: QaapDevPreviewRecord;
    readonly registeredByCapture: boolean;
}

interface QaapRetainedHeadlessPreview {
    readonly conversationId: string;
    readonly ownerLogin: string;
    readonly preview: QaapHeadlessPublicPreview;
    readonly staticServer?: http.Server;
    readonly supervisedPreviewId?: string;
    readonly retainedAt: number;
    readonly expiryTimer: ReturnType<typeof setTimeout>;
}

export function qaapHeadlessPublicPreviewLeaseMs(value = process.env.QAAP_HEADLESS_PREVIEW_LEASE_MS): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_PUBLIC_PREVIEW_LEASE_MS;
    }
    return Math.min(MAX_PUBLIC_PREVIEW_LEASE_MS, Math.max(MIN_PUBLIC_PREVIEW_LEASE_MS, Math.round(parsed)));
}

function isPathContainedBy(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Resolves a static-preview request without allowing lexical or symlink traversal outside root.
 * Unknown application routes retain the SPA fallback to the root index.html.
 */
export async function resolveQaapStaticPreviewFile(root: string, requestUrl: string): Promise<string | undefined> {
    let requested: string;
    try {
        requested = decodeURIComponent(requestUrl.split('?')[0]);
    } catch {
        return undefined;
    }
    if (requested.includes('\0')) {
        return undefined;
    }
    const absoluteRoot = path.resolve(root);
    const relativeRequest = requested.replace(/^[/\\]+/, '');
    const candidate = path.resolve(absoluteRoot, relativeRequest);
    if (!isPathContainedBy(absoluteRoot, candidate)) {
        return undefined;
    }
    const stat = await fsp.stat(candidate).catch(() => undefined);
    const filePath = stat?.isDirectory()
        ? path.join(candidate, 'index.html')
        : stat
            ? candidate
            : path.join(absoluteRoot, 'index.html');
    const [realRoot, realFile] = await Promise.all([
        fsp.realpath(absoluteRoot).catch(() => undefined),
        fsp.realpath(filePath).catch(() => undefined),
    ]);
    return realRoot && realFile && isPathContainedBy(realRoot, realFile) ? realFile : undefined;
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

function configuredProjectAt(workspaceRoot: string): QaapHeadlessCaptureAppTarget | undefined {
    try {
        const parsed = parseQaapPreviewLaunchConfigJson(
            fs.readFileSync(path.join(workspaceRoot, QAAP_PREVIEW_CONFIG_PATH), 'utf8'),
        );
        if (!parsed.ok) {
            return undefined;
        }
        const root = path.resolve(workspaceRoot, parsed.plan.cwd);
        const contained = root === workspaceRoot || root.startsWith(`${workspaceRoot}${path.sep}`);
        if (!contained || !fs.statSync(root).isDirectory()) {
            return undefined;
        }
        return { root, kind: 'script', expectedPort: parsed.plan.port, launch: parsed.plan };
    } catch {
        return undefined;
    }
}

function nativePlan(
    root: string,
    runtime: QaapPreviewLaunchPlan['runtime'],
    command: string,
    args: string[],
    port: number = 8080,
): QaapHeadlessCaptureAppTarget {
    return {
        root,
        kind: 'script',
        expectedPort: port,
        launch: { version: 1, runtime, cwd: '.', command, args, port },
    };
}

/** Conservative native-runtime discovery matching the frontend detector. */
function nativeProjectAt(dir: string): QaapHeadlessCaptureAppTarget | undefined {
    if (fs.existsSync(path.join(dir, 'manage.py'))) {
        return nativePlan(dir, 'python', 'python3', ['manage.py', 'runserver', '0.0.0.0:{{PORT}}'], 8000);
    }
    const pythonManifest = ['requirements.txt', 'pyproject.toml']
        .map(name => {
            try {
                return fs.readFileSync(path.join(dir, name), 'utf8');
            } catch {
                return '';
            }
        })
        .join('\n');
    if (pythonManifest && fs.existsSync(path.join(dir, 'app.py'))) {
        if (/\b(?:fastapi|uvicorn)\b/i.test(pythonManifest)) {
            return nativePlan(dir, 'python', 'python3', [
                '-m', 'uvicorn', 'app:app', '--host', '0.0.0.0', '--port', '{{PORT}}',
            ], 8000);
        }
        if (/\bflask\b/i.test(pythonManifest)) {
            return nativePlan(dir, 'python', 'python3', [
                '-m', 'flask', '--app', 'app', 'run', '--host', '0.0.0.0', '--port', '{{PORT}}',
            ], 5000);
        }
    }
    if (fs.existsSync(path.join(dir, 'go.mod'))) {
        return nativePlan(dir, 'go', 'go', ['run', '.']);
    }
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) {
        return nativePlan(dir, 'rust', 'cargo', ['run']);
    }
    let csproj: string | undefined;
    try {
        csproj = fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.csproj')).sort()[0];
    } catch {
        // Not a readable .NET project.
    }
    if (csproj) {
        return nativePlan(dir, 'dotnet', 'dotnet', [
            'run', '--project', csproj, '--urls', 'http://0.0.0.0:{{PORT}}',
        ]);
    }
    if (fs.existsSync(path.join(dir, 'index.php'))) {
        return nativePlan(dir, 'php', 'php', ['-S', '0.0.0.0:{{PORT}}']);
    }
    return undefined;
}

/**
 * Resolves what to run for a workspace: the root project, the first runnable child project
 * (depth ≤ 2 — covers `artifacts/<app>` layouts), or a plain static site (`index.html`).
 */
export function resolveHeadlessCaptureAppTarget(cwd: string): QaapHeadlessCaptureAppTarget | undefined {
    const configured = configuredProjectAt(cwd);
    if (configured) {
        return configured;
    }
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
        const target = configuredProjectAt(child);
        if (target) {
            return target;
        }
    }
    for (const child of level1) {
        const target = scriptProjectAt(child);
        if (target) {
            return target;
        }
    }
    for (const child of level1) {
        for (const grandChild of listDirs(child)) {
            const configuredChild = configuredProjectAt(grandChild);
            if (configuredChild) {
                return configuredChild;
            }
            const target = scriptProjectAt(grandChild);
            if (target) {
                return target;
            }
        }
    }
    if (fs.existsSync(path.join(cwd, 'index.html'))) {
        return { root: cwd, kind: 'static', expectedPort: 0 };
    }
    const nativeRoot = nativeProjectAt(cwd);
    if (nativeRoot) {
        return nativeRoot;
    }
    for (const child of level1) {
        const target = nativeProjectAt(child);
        if (target) {
            return target;
        }
    }
    for (const child of level1) {
        for (const grandChild of listDirs(child)) {
            const target = nativeProjectAt(grandChild);
            if (target) {
                return target;
            }
        }
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
    const fatalIssues = [];
    const bodyText = (document.body && (document.body.innerText || document.body.textContent) || '').trim();
    if (bodyText.length < 20) { fatalIssues.push('The page appears empty or contains very little visible text.'); }
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
    const allIssues = fatalIssues.concat(issues);
    return {
        status: fatalIssues.length > 0 ? 'failed' : issues.length === 0 ? 'passed' : 'warning',
        readiness: allIssues.length === 0 ? 'render_ready' : 'failed',
        summary: fatalIssues.length > 0
            ? 'Preview render failed with ' + fatalIssues.length + ' blocking finding' + (fatalIssues.length === 1 ? '' : 's') + '.'
            : issues.length === 0
            ? 'Preview loaded and passed the DOM smoke check (' + interactive + ' interactive elements).'
            : 'Preview loaded with ' + issues.length + ' visual/accessibility finding' + (issues.length === 1 ? '' : 's') + '.',
        issues: allIssues,
    };
})()`;

function boundedDiagnostic(value: unknown): string {
    const text = value instanceof Error ? value.message : String(value ?? 'Unknown application error');
    return text.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Unknown application error';
}

/** Applies browser/runtime failures to the DOM result without losing the captured screenshot. */
export function applyQaapHeadlessRuntimeDiagnostics(
    result: QaapPreviewVisualValidationResult,
    diagnostics: readonly string[],
): QaapPreviewVisualValidationResult {
    const unique = [...new Set(diagnostics.map(boundedDiagnostic).filter(Boolean))].slice(0, 20);
    if (unique.length === 0) {
        return result;
    }
    return {
        status: 'failed',
        readiness: 'failed',
        summary: nls.localize(
            'qaap/visualVerification/browserRuntimeErrors',
            'Preview render failed with {0} browser/runtime error(s).',
            unique.length,
        ),
        issues: [...unique, ...result.issues].slice(0, 30),
    };
}

/**
 * Navigates one route and combines DOM smoke findings with Playwright's runtime/network truth.
 * A successful HTTP response alone can never produce `passed` when the page throws, rejects,
 * drops a request, or receives a 5xx response.
 */
export async function inspectQaapHeadlessPage(
    page: any,
    url: string,
    settleMs: number = PAGE_SETTLE_MS,
): Promise<QaapPreviewVisualValidationResult> {
    const diagnostics: string[] = [];
    const add = (kind: string, message: unknown): void => {
        diagnostics.push(`${kind}: ${boundedDiagnostic(message)}`);
    };
    const onPageError = (error: unknown): void => add('pageerror', error);
    const onConsole = (message: any): void => {
        if (message.type?.() === 'error') {
            add('console.error', message.text?.() ?? message);
        }
    };
    const onRequestFailed = (request: any): void => {
        const failure = request.failure?.();
        add('requestfailed', `${request.url?.() ?? 'unknown URL'} (${failure?.errorText ?? 'unknown failure'})`);
    };
    const onResponse = (response: any): void => {
        const status = Number(response.status?.());
        if (status >= 500) {
            add('http', `${status} ${response.url?.() ?? 'unknown URL'}`);
        }
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    await page.addInitScript(`(() => {
        const key = '__qaapHeadlessUnhandledRejections';
        globalThis[key] = [];
        addEventListener('unhandledrejection', event => {
            const reason = event.reason;
            const message = reason && reason.message ? reason.message : String(reason || 'Unknown rejection');
            if (globalThis[key].length < 20) { globalThis[key].push(message.slice(0, 500)); }
        });
    })()`);
    try {
        await page.goto(url, { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(settleMs);
        const result = await page.evaluate(PAGE_SMOKE_CHECK) as QaapPreviewVisualValidationResult;
        const rejections = await page.evaluate(`globalThis.__qaapHeadlessUnhandledRejections || []`)
            .catch(() => []) as string[];
        for (const rejection of rejections) {
            add('unhandledrejection', rejection);
        }
        return applyQaapHeadlessRuntimeDiagnostics(result, diagnostics);
    } finally {
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
    }
}

@injectable()
export class QaapHeadlessVisualCaptureService {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapPreviewSupervisor)
    protected readonly supervisor: QaapPreviewSupervisor;

    @inject(QaapDevPreviewPortRegistry)
    protected readonly previewRegistry: QaapDevPreviewPortRegistry;

    protected readonly inFlight = new Set<string>();
    /** One headless attempt per settled turn (`conversationId:messageCount`). */
    protected readonly attemptedTurns = new Set<string>();
    /** Successful capture previews are short-lived links, not permanent background processes. */
    protected readonly retainedPreviews = new Map<string, QaapRetainedHeadlessPreview>();
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
        // (turns that settled mid-restart, or before this service existed). BOUNDED: an unbounded
        // sweep over a day's backlog once queued a capture per pending conversation right after
        // boot, spawned a dev server for each, pinned the CPU, failed the container healthcheck,
        // and crash-looped the VPS. Only the most recent few are worth settling automatically —
        // older ones settle if/when their conversation becomes active again.
        setTimeout(() => {
            const pending = this.store.list(undefined)
                .filter(summary => summary.visualVerificationPending)
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                .slice(0, STARTUP_SWEEP_MAX_CAPTURES);
            for (const summary of pending) {
                this.schedule(summary.id, summary.messageCount);
            }
        }, STARTUP_SWEEP_DELAY_MS);
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
            .catch(async error => {
                console.warn('[qaap-headless-visual-capture] capture failed:', error);
                await this.recordHeadlessCaptureFailure(conversationId, error);
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
    protected async recordHeadlessCaptureFailure(conversationId: string, error: unknown): Promise<void> {
        const conv = this.store.get(conversationId);
        if (!conv || !conversationNeedsVisualVerificationEvidence(conv)) {
            return;
        }
        const target = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!target || agentMessageHasVisualVerificationMarker(target)) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        await this.store.recordVisualVerificationFailure(
            conversationId,
            nls.localize('qaap/headlessCapture/failed', 'Headless capture failed: {0}', message),
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
                await this.store.recordVisualVerificationFailure(
                    conversationId,
                    nls.localize(
                        'qaap/headlessCapture/videoChromiumRequired',
                        'Video recording requires a server-side Chromium binary (set QAAP_HEADLESS_CHROMIUM '
                        + 'or install playwright browsers). Screenshots cannot substitute for [QAAP record].',
                    ),
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
            await this.store.recordVisualVerificationFailure(
                conversationId,
                nls.localize(
                    'qaap/headlessCapture/noRunnablePreview',
                    'No runnable preview target was found. Add a supported entry point or .qaap/preview.json before requesting visual evidence.',
                ),
                target.id,
            );
            return;
        }
        this.releaseRetainedPreview(conversationId);
        let staticServer: http.Server | undefined;
        let supervisedPreviewId: string | undefined;
        let publicPreview: QaapHeadlessPublicPreview | undefined;
        let captureSucceeded = false;
        try {
            let port: number;
            if (app.kind === 'static') {
                const started = await this.startStaticServer(app.root);
                staticServer = started.server;
                port = started.port;
                publicPreview = this.registerPublicPreview(conv, app.root, port);
            } else {
                const preferredPort = this.previewPortForApp(app);
                publicPreview = this.registerPublicPreview(conv, app.root, preferredPort);
                const ready = await this.ensureScriptServer(app, publicPreview?.identity);
                if (ready.ok) {
                    supervisedPreviewId = ready.startedPreviewId;
                    port = ready.port;
                    if (publicPreview && supervisedPreviewId) {
                        this.previewRegistry.attachProcess(
                            publicPreview.record.previewId,
                            publicPreview.ownerLogin,
                            this.supervisor.describe(supervisedPreviewId)?.processId,
                        );
                    }
                } else {
                    // The dev script did not yield a reachable port, but the app may still be a
                    // plain static site behind a wrapper script — serve it in-process instead of
                    // giving up (a landing page's `dev: http-server` counts on exactly this).
                    const staticRoot = [app.root, conv.cwd].find(dir => fs.existsSync(path.join(dir, 'index.html')));
                    if (!staticRoot) {
                        await this.store.recordVisualVerificationFailure(
                            conversationId,
                            nls.localize(
                                'qaap/headlessCapture/devServerNotReady',
                                'The dev server did not become ready for the capture: {0}',
                                ready.reason,
                            ),
                            target.id,
                        );
                        return;
                    }
                    if (publicPreview?.registeredByCapture) {
                        this.previewRegistry.releasePreview(publicPreview.record.previewId, publicPreview.ownerLogin);
                    }
                    publicPreview = undefined;
                    const started = await this.startStaticServer(staticRoot);
                    staticServer = started.server;
                    port = started.port;
                    publicPreview = this.registerPublicPreview(conv, staticRoot, port);
                }
            }
            const previewUrl = publicPreview
                ? buildQaapIdentityPreviewUrl('', publicPreview.record.previewId, deriveVisualFlowSteps(conv)[0] ?? '/')
                : undefined;
            if (captureDirective.mode === 'video') {
                captureSucceeded = await this.recordFlowVideo(conversationId, conv, target.id, port, previewUrl);
            } else {
                captureSucceeded = await this.captureFlow(conversationId, conv, target.id, port, previewUrl);
            }
            if (captureSucceeded && publicPreview?.registeredByCapture) {
                this.retainPublicPreview(conversationId, publicPreview, staticServer, supervisedPreviewId);
                staticServer = undefined;
                supervisedPreviewId = undefined;
                publicPreview = undefined;
            }
        } finally {
            staticServer?.close();
            if (supervisedPreviewId) {
                this.supervisor.stop(supervisedPreviewId);
            }
            if (publicPreview?.registeredByCapture) {
                this.previewRegistry.releasePreview(publicPreview.record.previewId, publicPreview.ownerLogin);
            }
        }
    }

    protected retainPublicPreview(
        conversationId: string,
        preview: QaapHeadlessPublicPreview,
        staticServer?: http.Server,
        supervisedPreviewId?: string,
    ): void {
        this.releaseRetainedPreview(conversationId);
        const expiryTimer = setTimeout(
            () => this.releaseRetainedPreview(conversationId),
            qaapHeadlessPublicPreviewLeaseMs(),
        );
        expiryTimer.unref?.();
        this.retainedPreviews.set(conversationId, {
            conversationId,
            ownerLogin: preview.ownerLogin,
            preview,
            staticServer,
            supervisedPreviewId,
            retainedAt: Date.now(),
            expiryTimer,
        });
        const owned = [...this.retainedPreviews.values()]
            .filter(retained => retained.ownerLogin === preview.ownerLogin)
            .sort((left, right) => left.retainedAt - right.retainedAt);
        for (const retained of owned.slice(0, Math.max(0, owned.length - MAX_RETAINED_PREVIEWS_PER_OWNER))) {
            this.releaseRetainedPreview(retained.conversationId);
        }
    }

    protected releaseRetainedPreview(conversationId: string): void {
        const retained = this.retainedPreviews.get(conversationId);
        if (!retained) {
            return;
        }
        this.retainedPreviews.delete(conversationId);
        clearTimeout(retained.expiryTimer);
        retained.staticServer?.close();
        if (retained.supervisedPreviewId) {
            this.supervisor.stop(retained.supervisedPreviewId);
        }
        this.previewRegistry.releasePreview(retained.preview.record.previewId, retained.ownerLogin);
    }

    protected previewPortForApp(app: QaapHeadlessCaptureAppTarget): number {
        return app.expectedPort === qaapIdeListenPort() ? app.expectedPort + 7 : app.expectedPort;
    }

    /** Registers a capture server as a normal identity-scoped preview so transcript links can open it. */
    protected registerPublicPreview(
        conv: QaapAgentConversation,
        root: string,
        port: number,
    ): QaapHeadlessPublicPreview | undefined {
        const ownerLogin = conv.ownerLogin ?? QAAP_SKIP_AUTH_USER_LOGIN;
        const existing = this.previewRegistry.getByPort(port);
        if (existing) {
            if (existing.ownerLogin !== ownerLogin || existing.root !== root) {
                return undefined;
            }
            if (!isQaapProcessPreviewIdentity(existing)) {
                return undefined;
            }
            return {
                identity: {
                    userId: existing.userId,
                    workspaceId: existing.workspaceId,
                    projectId: existing.projectId,
                    conversationId: existing.conversationId,
                    processId: existing.processId,
                    previewId: existing.previewId,
                },
                ownerLogin,
                record: existing,
                registeredByCapture: false,
            };
        }
        const identity = resolveQaapPreviewIdentity({
            userId: ownerLogin,
            workspaceId: conv.cwd,
            projectId: conv.cwd,
            conversationId: conv.id,
            processId: `visual-${conv.id}`,
        });
        const record = this.previewRegistry.register({
            ...identity,
            ownerLogin,
            root,
            port,
        });
        return record
            ? { identity, ownerLogin, record, registeredByCapture: true }
            : undefined;
    }

    /** Reuses an already-listening expected port, otherwise starts the app via the supervisor. */
    protected async ensureScriptServer(
        app: QaapHeadlessCaptureAppTarget,
        publicIdentity?: QaapProcessPreviewIdentity & { readonly previewId: string },
    ): Promise<{ ok: true; port: number; startedPreviewId?: string } | { ok: false; reason: string }> {
        // Probing the IDE's own listen port would "find" Qaap itself and screenshot the wrong
        // thing — shift to an alternate port instead ($PORT-honoring dev servers follow along).
        const port = this.previewPortForApp(app);
        if (await this.probePort(port)) {
            return { ok: true, port };
        }
        // Identity-keyed (per app root), never the global `legacy-port-<port>` supervisor key:
        // capture servers must not collide with — or be mistaken for — user preview processes.
        const startedPreviewId = publicIdentity?.previewId ?? `qaap-headless-capture:${app.root}`;
        const launch = app.launch ? materializeQaapPreviewLaunchPlan(app.launch, port) : undefined;
        this.supervisor.start(app.root, port, {
            previewId: startedPreviewId,
            projectId: publicIdentity?.projectId ?? app.root,
            ...(publicIdentity ? {
                userId: publicIdentity.userId,
                workspaceId: publicIdentity.workspaceId,
                conversationId: publicIdentity.conversationId,
                processId: publicIdentity.processId,
                ownerLogin: publicIdentity.userId,
            } : {}),
        }, launch);
        const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (await this.probePort(port)) {
                return { ok: true, port, startedPreviewId };
            }
            const snapshot = this.supervisor.describe(port);
            if (snapshot?.status === 'exited') {
                const tail = snapshot.stderrTail?.slice(-3).join(' ').trim();
                this.supervisor.stop(startedPreviewId);
                return { ok: false, reason: tail || `the dev process exited (code ${snapshot.exitCode ?? '?'})` };
            }
            await new Promise(resolve => setTimeout(resolve, SERVER_PROBE_INTERVAL_MS));
        }
        this.supervisor.stop(startedPreviewId);
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
                const filePath = await resolveQaapStaticPreviewFile(root, request.url ?? '/');
                if (!filePath) {
                    response.writeHead(403).end();
                    return;
                }
                const body = await fsp.readFile(filePath);
                const types: Record<string, string> = {
                    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
                    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
                };
                response.writeHead(200, {
                    'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream',
                    'X-Content-Type-Options': 'nosniff',
                });
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
        previewUrl?: string,
    ): Promise<boolean> {
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
                    const result = await inspectQaapHeadlessPage(page, `http://127.0.0.1:${port}${step}`);
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
                    skipped.push(nls.localize(
                        'qaap/headlessCapture/routeFailure',
                        '`{0}`: {1}',
                        step,
                        error instanceof Error ? error.message : String(error),
                    ));
                }
            }
            if (captured.length === 0) {
                await this.store.recordVisualVerificationFailure(
                    conversationId,
                    nls.localize(
                        'qaap/headlessCapture/noRouteCaptured',
                        'Headless capture reached the dev server but no route could be captured — {0}',
                        skipped.join('; '),
                    ),
                    targetAgentMessageId,
                );
                return false;
            }
            if (skipped.length > 0) {
                const first = captured[0];
                captured[0] = {
                    ...first,
                    result: {
                        ...first.result,
                        status: 'failed',
                        readiness: 'failed',
                        issues: [...first.result.issues, ...skipped.map(reason => nls.localize(
                            'qaap/headlessCapture/couldNotCaptureRoute',
                            'Could not capture {0}.',
                            reason,
                        ))],
                    },
                };
            }
            return (await this.store.recordVisualVerificationFlow(
                conversationId,
                captured,
                targetAgentMessageId,
                previewUrl,
            )) !== undefined;
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
        previewUrl?: string,
    ): Promise<boolean> {
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
                    const result = await inspectQaapHeadlessPage(page, `http://127.0.0.1:${port}${step}`);
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
                    skipped.push(nls.localize(
                        'qaap/headlessCapture/routeFailure',
                        '`{0}`: {1}',
                        step,
                        error instanceof Error ? error.message : String(error),
                    ));
                }
            }
            await context.close();
            videoPath = video ? await video.path() : undefined;
        } finally {
            await browser.close().catch(() => undefined);
        }
        try {
            if (stepResults.length === 0 || !videoPath) {
                await this.store.recordVisualVerificationFailure(
                    conversationId,
                    nls.localize(
                        'qaap/headlessCapture/noVideoProduced',
                        'Headless recording reached the dev server but produced no video — {0}',
                        skipped.join('; ') || nls.localize('qaap/headlessCapture/noRouteLoaded', 'no route loaded'),
                    ),
                    targetAgentMessageId,
                );
                return false;
            }
            if (skipped.length > 0) {
                const first = stepResults[0];
                stepResults[0] = {
                    ...first,
                    result: {
                        ...first.result,
                        status: 'failed',
                        readiness: 'failed',
                        issues: [...first.result.issues, ...skipped.map(reason => nls.localize(
                            'qaap/headlessCapture/couldNotRecordRoute',
                            'Could not record {0}.',
                            reason,
                        ))],
                    },
                };
            }
            const evidenceId = await this.store.saveVisualEvidenceVideo(conversationId, videoPath);
            if (!evidenceId) {
                await this.store.recordVisualVerificationFailure(
                    conversationId,
                    nls.localize(
                        'qaap/headlessCapture/videoStoreRejected',
                        'The recorded video could not be stored (size cap or storage limit reached).',
                    ),
                    targetAgentMessageId,
                );
                return false;
            }
            return (await this.store.recordVisualVerificationVideo(
                conversationId,
                evidenceId,
                stepResults,
                targetAgentMessageId,
                previewUrl,
            )) !== undefined;
        } finally {
            await fsp.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

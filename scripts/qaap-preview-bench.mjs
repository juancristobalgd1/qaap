#!/usr/bin/env node
// Dev-preview reliability bench (roadmap H1.2): for each app directory, ask a running Qaap backend to
// start its dev server through the preview supervisor, wait for the preview probe to report ready,
// then load the proxied preview URL in headless Chromium at desktop and mobile size and require a
// rendered, interactive page without page errors. Repeats each app N times and prints a pass rate.
//
// It exercises exactly the path a user hits after "Open preview": supervisor launch plan + port
// pinning, readiness, the /qaap-preview/<id>/ proxy and its HTML/HMR rewriting, and hydration.
//
// Usage:
//   node scripts/qaap-preview-bench.mjs --base http://127.0.0.1:3456 \
//       --app vite=scripts/qaap-preview-bench-apps/lovable-vite \
//       --app next=scripts/qaap-preview-bench-apps/next [--runs 3] [--out dir] [--install]
// Bench apps: scripts/qaap-preview-bench-apps (see its README); --install installs their dependencies.
// The backend must accept the requests: a local backend with QAAP_SKIP_AUTH=true and
// QAAP_CLOUD_MODE=local, or pass --cookie 'qaap_sid=...' for a signed-in one.
// An app passes when the page has no uncaught page error, shows text, and (when the app marks one
// with data-qaap-bench="counter") a click on it re-renders, which proves hydration.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const RESTART_PATH = '/qaap/api/cloud/preview/restart';
const PROBE_PATH = '/qaap-preview/api/probe';
const RELEASE_PATH = '/qaap-dev/api/release';

export function parseArgs(argv) {
    const options = { base: '', apps: [], runs: 1, out: '', cookie: '', readyTimeoutMs: 120_000, install: false };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--base') { options.base = value.replace(/\/+$/, ''); i++; }
        else if (flag === '--app') {
            const at = value.indexOf('=');
            if (at < 1) { throw new Error(`--app expects name=dir, got ${value}`); }
            options.apps.push({ name: value.slice(0, at), dir: resolve(value.slice(at + 1)) });
            i++;
        }
        else if (flag === '--runs') { options.runs = Math.max(1, Number(value)); i++; }
        else if (flag === '--out') { options.out = resolve(value); i++; }
        else if (flag === '--cookie') { options.cookie = value; i++; }
        else if (flag === '--ready-timeout') { options.readyTimeoutMs = Number(value) * 1000; i++; }
        else if (flag === '--install') { options.install = true; }
        else { throw new Error(`Unknown option ${flag}`); }
    }
    if (!/^https?:\/\//.test(options.base) || options.apps.length === 0) {
        throw new Error('Usage: qaap-preview-bench.mjs --base <url> --app name=dir [--app ...] [--runs N] [--out dir] [--cookie c]');
    }
    return options;
}

/** Page-level verdict from what the browser observed. */
export function judgePage({ pageErrors, text, hydrated }) {
    if (pageErrors.length > 0) {
        return { ok: false, reason: `page error: ${pageErrors[0]}` };
    }
    if (!text || text.trim().length === 0) {
        return { ok: false, reason: 'blank page (no visible text)' };
    }
    if (hydrated === false) {
        return { ok: false, reason: 'not hydrated (counter click did not re-render)' };
    }
    return { ok: true, reason: hydrated ? 'rendered + hydrated' : 'rendered' };
}

async function freePort() {
    return new Promise((done, fail) => {
        const server = createServer();
        server.on('error', fail);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => done(port));
        });
    });
}

async function api(options, method, path, body) {
    const response = await fetch(options.base + path, {
        method,
        headers: { ...(options.cookie ? { cookie: options.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, json, text };
}

async function waitReady(options, previewId) {
    const started = Date.now();
    let last;
    while (Date.now() - started < options.readyTimeoutMs) {
        last = await api(options, 'GET', `${PROBE_PATH}/${encodeURIComponent(previewId)}`).catch(error => ({ status: 0, text: String(error) }));
        if (last.json?.ready === true) {
            return { ready: true, ms: Date.now() - started };
        }
        if (last.json?.state === 'gone' || last.json?.state === 'stopped') {
            return { ready: false, ms: Date.now() - started, reason: `preview ${last.json.state}` };
        }
        await new Promise(r => setTimeout(r, 750));
    }
    return { ready: false, ms: Date.now() - started, reason: `not ready after ${options.readyTimeoutMs / 1000}s (last ${last?.json?.state ?? last?.status})` };
}

async function checkViewport(browser, devices, options, url, viewport, shotPath) {
    const context = await browser.newContext(viewport === 'mobile'
        ? { ...devices['iPhone 13'], extraHTTPHeaders: options.cookie ? { cookie: options.cookie } : undefined }
        : { viewport: { width: 1280, height: 800 }, extraHTTPHeaders: options.cookie ? { cookie: options.cookie } : undefined });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.message ?? error)));
    page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); } });
    const started = Date.now();
    let text = '';
    let hydrated;
    try {
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        text = await page.evaluate(() => document.body?.innerText ?? '');
        const counter = page.locator('[data-qaap-bench="counter"]');
        if (await counter.count() > 0) {
            const before = await counter.first().innerText();
            await counter.first().click({ timeout: 5_000 });
            await page.waitForTimeout(300);
            hydrated = (await counter.first().innerText()) !== before;
        }
        if (shotPath) { await page.screenshot({ path: shotPath }); }
    } catch (error) {
        pageErrors.push(`navigation: ${error?.message ?? error}`);
    }
    const loadMs = Date.now() - started;
    await context.close();
    return { ...judgePage({ pageErrors, text, hydrated }), loadMs, pageErrors, consoleErrors: consoleErrors.slice(0, 5) };
}

async function main(argv) {
    const options = parseArgs(argv);
    if (options.out) { mkdirSync(options.out, { recursive: true }); }
    if (options.install) {
        for (const app of options.apps.filter(candidate => !existsSync(join(candidate.dir, 'node_modules')))) {
            console.log(`Installing ${app.name} dependencies...`);
            execFileSync('npm', ['install', '--no-fund', '--no-audit', '--no-package-lock'], { cwd: app.dir, stdio: 'inherit' });
        }
    }
    // Loaded here so the pure helpers above can be unit-tested without dependencies installed.
    const { chromium, devices } = await import('playwright-core');
    const browser = await chromium.launch();
    const results = [];
    try {
        for (const app of options.apps) {
            for (let run = 1; run <= options.runs; run++) {
                const port = await freePort();
                const identity = { projectId: `bench-${app.name}`, conversationId: 'preview-bench', runId: `run-${Date.now()}-${run}` };
                const row = { app: app.name, run, port };
                const started = await api(options, 'POST', RESTART_PATH, { port, cwd: app.dir, ...identity });
                if (started.status !== 200 || !started.json?.previewId) {
                    results.push({ ...row, ok: false, reason: `restart HTTP ${started.status}: ${started.text.slice(0, 200)}` });
                    continue;
                }
                const { previewId, previewUrl } = started.json;
                const ready = await waitReady(options, previewId);
                row.readyMs = ready.ms;
                if (!ready.ready) {
                    results.push({ ...row, ok: false, reason: ready.reason });
                } else {
                    const url = new URL(previewUrl, options.base).href;
                    for (const viewport of ['desktop', 'mobile']) {
                        const shot = options.out ? join(options.out, `${app.name}-${run}-${viewport}.png`) : undefined;
                        const page = await checkViewport(browser, devices, options, url, viewport, shot);
                        results.push({ ...row, viewport, ...page });
                    }
                }
                await api(options, 'POST', RELEASE_PATH, { previewId }).catch(() => undefined);
            }
        }
    } finally {
        await browser.close();
    }

    const passed = results.filter(result => result.ok).length;
    for (const result of results) {
        console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.app.padEnd(10)} run ${result.run} ${(result.viewport ?? '-').padEnd(7)} ready ${result.readyMs ?? '-'}ms load ${result.loadMs ?? '-'}ms  ${result.reason}`);
    }
    console.log(`\n${passed}/${results.length} checks passed`);
    if (options.out) { writeFileSync(join(options.out, 'preview-bench.json'), JSON.stringify(results, undefined, 2)); }
    return passed === results.length ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
        console.error(error?.message ?? error);
        process.exitCode = 2;
    });
}

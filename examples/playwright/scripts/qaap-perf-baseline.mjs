#!/usr/bin/env node

import { chromium, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE_URL = process.env.QAAP_PERF_URL || 'https://161.97.69.219.sslip.io/';
const OUTPUT = process.env.QAAP_PERF_OUTPUT || '/workspace/logs/perf-2s.md';
const PHASE = process.env.QAAP_PERF_PHASE || 'baseline';
/** `ide` runs on a desktop viewport; `ide-mobile` opens the IDE surface on the same 375×812 phone as the Work Hub. */
const isIdeMode = mode => mode === 'ide' || mode === 'ide-mobile';
const MODES = (process.env.QAAP_PERF_MODES || 'work-hub,ide').split(',').map(mode => mode.trim()).filter(Boolean);
const BUILD_SHA = process.env.QAAP_PERF_BUILD_SHA || 'not specified';
const AUTH_METHOD = process.env.QAAP_PERF_AUTH_METHOD
    || (process.env.QAAP_PERF_STORAGE_STATE ? 'Playwright storage state (QAAP_PERF_STORAGE_STATE)' : 'not specified');
// CDP throttling is attached to the page target only; fetches a service worker makes on the
// page's behalf bypass it, and the worker's first-visit claim can reload the page mid-boot.
// Block workers by default so every byte is throttled and each run is a single document.
const SERVICE_WORKERS = process.env.QAAP_PERF_SERVICE_WORKERS === 'allow' ? 'allow' : 'block';
const MILESTONE_TIMEOUT_MS = Number(process.env.QAAP_PERF_MILESTONE_TIMEOUT_MS || 240_000);
const AUTH_SETTLE_MS = 3_000;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const IDE_VIEWPORT = { width: 1280, height: 900 };
const NETWORK = process.env.QAAP_PERF_NETWORK === 'none' ? 'none' : '4g';
const SELECTOR_TIMEOUT_MS = Number(process.env.QAAP_PERF_SELECTOR_TIMEOUT_MS || 30_000);
const FOUR_G = {
    offline: false,
    latency: 150,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
    connectionType: 'cellular4g',
};

const initMarks = String.raw`
(() => {
    const marks = {};
    Object.defineProperty(window, '__qaapPerfMarks', { value: marks, configurable: false });
    const mark = name => {
        if (marks[name] !== undefined) return;
        marks[name] = Math.round(performance.now());
        performance.mark('qaap:' + name);
    };
    const visible = element => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const check = () => {
        const splash = document.querySelector('.theia-preload');
        const loginLogo = document.querySelector('#qaap-login-host .qaap-login-logo');
        const icon = document.querySelector('meta[name="application-icon"]')?.getAttribute('content');
        const logoUrl = icon ? new URL(icon, document.baseURI).href : '';
        const splashLogoLoaded = logoUrl.startsWith('data:') || performance.getEntriesByType('resource')
            .some(entry => entry.name === logoUrl && entry.responseEnd > 0);
        const loginLogoLoaded = loginLogo instanceof HTMLImageElement && loginLogo.complete && loginLogo.naturalWidth > 0;
        if ((visible(splash) && getComputedStyle(splash).backgroundImage !== 'none' && splashLogoLoaded)
            || (visible(loginLogo) && loginLogoLoaded)) {
            mark('logo');
        }
        const workHub = [...document.querySelectorAll('.theia-mobile-projects')].find(visible);
        const workHubControl = workHub?.querySelector(
            'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), '
            + 'textarea:not(:disabled), input:not(:disabled), [contenteditable="true"]',
        );
        if (workHub && visible(workHubControl)) mark('workHubInteractive');
        const instantComposer = [...document.querySelectorAll('#qaap-instant-work-hub textarea')]
            .find(element => visible(element) && !element.disabled && !element.readOnly);
        if (instantComposer) mark('instantComposerTypeable');
        const composer = [...document.querySelectorAll('textarea.theia-mobile-projects-sticky-composer-input')]
            .find(element => visible(element) && !element.disabled && !element.readOnly);
        if (composer) mark('composerTypeable');
        if (instantComposer || composer) mark('firstUsableComposer');
        if (document.querySelector('.theia-mobile-projects')) mark('workHubInDom');
        if (document.querySelector('textarea.theia-mobile-projects-sticky-composer-input')) mark('composerInDom');
        if (marks.logo !== undefined && !visible(splash)) mark('splashHidden');

        const appShell = document.getElementById('theia-app-shell');
        const mainPanel = document.getElementById('theia-main-content-panel');
        const workHubVisible = [...document.querySelectorAll('.theia-mobile-projects-sticky-composer-input')].some(visible);
        // The phone IDE (ide-mobile) legitimately runs one-column; the Work Hub is excluded by its landing class and visible composer.
        if (visible(appShell) && visible(mainPanel)
            && !document.body.classList.contains('theia-mobile-mod-landing')
            && !workHubVisible) {
            mark('ideShell');
        }
        if (visible(document.getElementById('qaap-login-host'))) mark('loginGate');
    };
    const observe = () => {
        check();
        new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
        setInterval(check, 100);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true });
    else observe();
    window.addEventListener('qaap-startup-ready', () => mark('startupReady'), { once: true });
})();
`;

function fmtMs(value) {
    return value === undefined || value === null ? '—' : `${(value / 1000).toFixed(2)} s`;
}

function safeText(value) {
    return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function parseRpcFrame(raw) {
    try {
        const values = JSON.parse(raw);
        return Array.isArray(values) ? values : [values];
    } catch {
        return [];
    }
}

async function configureNetwork(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    if (NETWORK === '4g') {
        await cdp.send('Network.emulateNetworkConditions', FOUR_G);
    }
    const requests = new Map();
    const responses = new Map();
    const rpcCalls = new Map();
    const rpcTimings = [];
    cdp.on('Network.requestWillBeSent', event => {
        requests.set(event.requestId, {
            url: event.request.url,
            type: event.type,
            startedAt: event.timestamp,
            initiator: event.initiator?.type,
        });
    });
    cdp.on('Network.responseReceived', event => {
        const request = requests.get(event.requestId) || {};
        responses.set(event.requestId, {
            ...request,
            status: event.response.status,
            mimeType: event.response.mimeType,
            cacheControl: event.response.headers['cache-control'] || event.response.headers['Cache-Control'],
            encodedDataLength: event.response.encodedDataLength,
            fromDiskCache: event.response.fromDiskCache,
            fromServiceWorker: event.response.fromServiceWorker,
        });
    });
    cdp.on('Network.loadingFinished', event => {
        const response = responses.get(event.requestId);
        if (response) response.encodedDataLength = event.encodedDataLength;
    });
    cdp.on('Network.webSocketWillSendHandshakeRequest', event => {
        const request = requests.get(event.requestId) || {};
        requests.set(event.requestId, { ...request, url: event.request.url, type: 'WebSocket', startedAt: event.timestamp });
    });
    cdp.on('Network.webSocketFrameSent', event => {
        const request = requests.get(event.requestId);
        if (!request?.url?.includes('/services')) return;
        for (const message of parseRpcFrame(event.response.payloadData)) {
            if (message?.id === undefined || !message.method) continue;
            rpcCalls.set(String(message.id), { method: message.method, startedAt: event.timestamp });
        }
    });
    cdp.on('Network.webSocketFrameReceived', event => {
        const request = requests.get(event.requestId);
        if (!request?.url?.includes('/services')) return;
        for (const message of parseRpcFrame(event.response.payloadData)) {
            if (message?.id === undefined) continue;
            const sent = rpcCalls.get(String(message.id));
            if (sent) {
                rpcTimings.push({ method: sent.method, durationMs: Math.round((event.timestamp - sent.startedAt) * 1000) });
                rpcCalls.delete(String(message.id));
            }
        }
    });
    return { cdp, requests, responses, rpcTimings };
}

async function waitForMilestone(page, mode) {
    const target = isIdeMode(mode) ? 'ideShell' : 'firstUsableComposer';
    await page.waitForFunction(({ target }) => {
        const marks = window.__qaapPerfMarks || {};
        return marks[target] !== undefined || marks.loginGate !== undefined;
    }, { target }, { timeout: MILESTONE_TIMEOUT_MS }).catch(() => undefined);
    const gateVisible = await page.locator('#qaap-login-host').isVisible().catch(() => false);
    if (gateVisible) await page.waitForTimeout(AUTH_SETTLE_MS);
    return gateVisible;
}

const SELECTOR_PROBE = String.raw`
(() => {
    const visible = element => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
    };
    const probe = window.__qaapSelectorProbe;
    if (probe.skeletonMs === undefined && [...document.querySelectorAll('.theia-qaap-agent-sheet-skeleton')].some(visible)) {
        probe.skeletonMs = Math.round(performance.now() - probe.startedAt);
    }
    if ([...document.querySelectorAll('.theia-qaap-agent-sheet-load-error')].some(visible)) {
        return { status: 'load error', ms: Math.round(performance.now() - probe.startedAt), skeletonMs: probe.skeletonMs };
    }
    const options = [...document.querySelectorAll('.theia-qaap-agent-sheet-option')].filter(visible);
    return options.length
        ? { status: 'list', ms: Math.round(performance.now() - probe.startedAt), skeletonMs: probe.skeletonMs, options: options.length }
        : undefined;
})()
`;

/**
 * Types into the composer (proves it accepts input, then restores it) and times the agent/model
 * selector from the click until its first agent row is visible. The skeleton time is reported
 * separately: a skeleton is feedback, not a usable list.
 */
async function measureComposerAndSelector(page) {
    const instantComposer = page.locator('#qaap-instant-work-hub textarea:visible').first();
    const realComposer = page.locator('textarea.theia-mobile-projects-sticky-composer-input:visible').first();
    const composer = await instantComposer.count() ? instantComposer : realComposer;
    let typeable = false;
    let composerKind;
    try {
        const previous = await composer.inputValue({ timeout: 2_000 });
        composerKind = await composer.evaluate(element => element.closest('#qaap-instant-work-hub') ? 'instant' : 'Theia');
        await composer.fill(`${previous}q`, { timeout: 2_000 });
        typeable = (await composer.inputValue()) === `${previous}q`;
        await composer.fill(previous);
    } catch {
        typeable = false;
    }
    const realComposerReady = await realComposer.waitFor({ state: 'visible', timeout: MILESTONE_TIMEOUT_MS })
        .then(() => true, () => false);
    const button = page.locator('.theia-mobile-projects-sticky-composer-agent:visible').first();
    await page.waitForFunction(() => [...document.querySelectorAll('.theia-mobile-projects-sticky-composer-agent')]
        .some(element => element instanceof HTMLButtonElement && !element.disabled), undefined,
    { timeout: SELECTOR_TIMEOUT_MS }).catch(() => undefined);
    if (!await button.isEnabled({ timeout: 2_000 }).catch(() => false)) {
        return { typeable, composerKind, realComposerReady, selector: { status: 'agent button not available' } };
    }
    const selector = await timeSelectorOpen(page, button);
    // A second open once the main thread is idle separates the picker's own cost from startup contention.
    await page.evaluate(() => new Promise(resolve => requestIdleCallback(() => resolve(undefined), { timeout: 15_000 })));
    await page.waitForTimeout(500);
    const idleSelector = await timeSelectorOpen(page, button);
    return { typeable, composerKind, realComposerReady, selector, idleSelector };
}

async function timeSelectorOpen(page, button) {
    await page.evaluate(() => { window.__qaapSelectorProbe = { startedAt: performance.now() }; });
    const clickError = await button.click({ timeout: 5_000 }).then(() => undefined, error => error);
    if (clickError) {
        const blocker = /<[^>]+> (?:from <[^>]+> subtree )?intercepts pointer events/.exec(clickError.message);
        return { status: `agent button not clickable${blocker ? `: ${blocker[0]}` : ''}` };
    }
    const handle = await page.waitForFunction(SELECTOR_PROBE, undefined, { timeout: SELECTOR_TIMEOUT_MS, polling: 16 })
        .catch(() => undefined);
    const selector = handle ? await handle.jsonValue() : { status: `no list within ${SELECTOR_TIMEOUT_MS / 1000} s` };
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForFunction(() => !document.querySelector('.theia-qaap-agent-sheet-option'), undefined, { timeout: 3_000 })
        .catch(() => undefined);
    return selector;
}

async function captureNavigation(browser, mode, navigation) {
    const isIde = mode === 'ide';
    const contextOptions = {
        ...(isIde ? devices['Desktop Chrome'] : devices['Pixel 7']),
        viewport: isIde ? IDE_VIEWPORT : MOBILE_VIEWPORT,
        serviceWorkers: SERVICE_WORKERS,
    };
    if (process.env.QAAP_PERF_STORAGE_STATE) {
        contextOptions.storageState = process.env.QAAP_PERF_STORAGE_STATE;
    }
    const context = await browser.newContext(contextOptions);
    const ideSessionSeed = isIdeMode(mode) ? "sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');\n" : '';
    await context.addInitScript(`${ideSessionSeed}${initMarks}`);

    const page = await context.newPage();
    const documentLoads = { count: 0 };
    page.on('domcontentloaded', () => documentLoads.count++);
    const consoleMessages = [];
    page.on('console', message => {
        const text = message.text();
        if (/Frontend|Backend|startup|Starting frontend|measurement|service/i.test(text)) {
            consoleMessages.push(text);
        }
    });
    page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.message}`));
    const network = await configureNetwork(page);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const loginRequired = await waitForMilestone(page, mode);
    const interaction = mode === 'work-hub' && !loginRequired ? await measureComposerAndSelector(page) : undefined;

    const metrics = await page.evaluate(() => {
        const visible = element => {
            if (!(element instanceof HTMLElement)) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
        };
        return {
        marks: { ...(window.__qaapPerfMarks || {}) },
        navigation: performance.getEntriesByType('navigation').map(entry => ({
            domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
            loadMs: Math.round(entry.loadEventEnd),
            responseStartMs: Math.round(entry.responseStart),
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
        }))[0],
        resources: performance.getEntriesByType('resource').map(entry => ({
            name: entry.name,
            type: entry.initiatorType,
            startMs: Math.round(entry.startTime),
            durationMs: Math.round(entry.duration),
            transferBytes: entry.transferSize,
            compressedBytes: entry.encodedBodySize,
            decodedBytes: entry.decodedBodySize,
        })),
        documentState: {
            title: document.title,
            loginGate: !!document.querySelector('#qaap-login-host'),
            bodyClass: document.body.className,
            appShellVisible: visible(document.getElementById('theia-app-shell')),
            mainPanelVisible: visible(document.getElementById('theia-main-content-panel')),
            workHubRootVisible: [...document.querySelectorAll('.theia-mobile-projects')].some(visible),
            workHubVisible: [...document.querySelectorAll('.theia-mobile-projects-sticky-composer-input')]
                .some(element => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
                }),
            instantComposerVisible: [...document.querySelectorAll('#qaap-instant-work-hub textarea')].some(visible),
            ideShellVisible: !!document.querySelector('#theia-app-shell #theia-main-content-panel'),
        },
        };
    });
    const requestMetadata = [...network.responses.values()];
    const byUrl = new Map(requestMetadata.map(response => [response.url, response]));
    const resources = metrics.resources.map(resource => ({ ...resource, ...byUrl.get(resource.name) }));
    const result = {
        mode,
        navigation,
        device: isIde ? 'Desktop Chrome' : 'Pixel 7 mobile',
        viewport: contextOptions.viewport,
        loginRequired,
        interaction,
        metrics,
        resources,
        rpcTimings: network.rpcTimings.sort((a, b) => b.durationMs - a.durationMs),
        consoleMessages,
        documentLoads: documentLoads.count,
    };

    return { result, context, page, network, documentLoads };
}

async function measureMode(browser, mode) {
    const { result: cold, context, page, network, documentLoads } = await captureNavigation(browser, mode, 'cold');
    const consoleMessages = [...cold.consoleMessages];
    await page.waitForTimeout(1_000);
    documentLoads.count = 0;
    network.rpcTimings.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    const loginRequired = await waitForMilestone(page, mode);
    const interaction = mode === 'work-hub' && !loginRequired ? await measureComposerAndSelector(page) : undefined;
    const metrics = await page.evaluate(() => ({
        marks: { ...(window.__qaapPerfMarks || {}) },
        navigation: performance.getEntriesByType('navigation').map(entry => ({
            domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
            loadMs: Math.round(entry.loadEventEnd),
            responseStartMs: Math.round(entry.responseStart),
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
        }))[0],
        resources: performance.getEntriesByType('resource').map(entry => ({
            name: entry.name,
            type: entry.initiatorType,
            startMs: Math.round(entry.startTime),
            durationMs: Math.round(entry.duration),
            transferBytes: entry.transferSize,
            compressedBytes: entry.encodedBodySize,
            decodedBytes: entry.decodedBodySize,
        })),
        documentState: {
            title: document.title,
            loginGate: !!document.querySelector('#qaap-login-host'),
            bodyClass: document.body.className,
            appShellVisible: (() => {
                const element = document.getElementById('theia-app-shell');
                if (!element) return false;
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
            })(),
            mainPanelVisible: (() => {
                const element = document.getElementById('theia-main-content-panel');
                if (!element) return false;
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
            })(),
            workHubRootVisible: [...document.querySelectorAll('.theia-mobile-projects')].some(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
            }),
            workHubVisible: [...document.querySelectorAll('.theia-mobile-projects-sticky-composer-input')]
                .some(element => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
                }),
            ideShellVisible: !!document.querySelector('#theia-app-shell #theia-main-content-panel'),
        },
    }));
    const byUrl = new Map([...network.responses.values()].map(response => [response.url, response]));
    const resources = metrics.resources.map(resource => ({ ...resource, ...byUrl.get(resource.name) }));
    const warm = {
        mode,
        navigation: 'warm reload',
        device: cold.device,
        viewport: cold.viewport,
        loginRequired: loginRequired || cold.loginRequired,
        interaction,
        metrics,
        resources,
        rpcTimings: network.rpcTimings.sort((a, b) => b.durationMs - a.durationMs),
        consoleMessages,
        documentLoads: documentLoads.count,
    };
    await network.cdp.detach();
    await context.close();
    return [cold, warm];
}

function renderSelector(interaction, key = 'selector') {
    const selector = interaction?.[key];
    if (!selector) {
        return '—';
    }
    const skeleton = selector.skeletonMs === undefined ? '' : `; skeleton after ${fmtMs(selector.skeletonMs)}`;
    return selector.ms === undefined
        ? selector.status
        : `${fmtMs(selector.ms)} (${selector.status}${selector.options ? `, ${selector.options} rows` : ''}${skeleton})`;
}

function renderRun(run) {
    const readyKey = isIdeMode(run.mode) ? 'ideShell' : 'firstUsableComposer';
    const marks = run.metrics.marks;
    const milestone = marks[readyKey];
    const status = milestone !== undefined ? 'ready' : run.loginRequired ? 'login required' : 'not reached';
    const navigation = run.metrics.navigation || {};
    const lines = [
        `### ${run.mode} — ${run.navigation}`,
        '',
        `- Emulation: ${run.device}; viewport: ${run.viewport.width}×${run.viewport.height}; throttling: ${NETWORK === '4g' ? '4G (150 ms RTT, 1.6 Mbps down, 750 Kbps up)' : 'none (real link)'}.`,
        `- Result: ${status}`,
        `- Document loads: ${run.documentLoads}${run.documentLoads > 1 ? ' — the page reloaded during the run; marks are relative to the last document and understate the real time' : ''}`,
        `- Time to logo: ${fmtMs(marks.logo)}`,
        `- Time to first enabled Work Hub control: ${fmtMs(marks.workHubInteractive)}`,
        `- Time to first usable Work Hub composer: ${fmtMs(run.mode === 'work-hub' ? milestone : undefined)}${run.interaction ? ` (typing ${run.interaction.typeable ? 'accepted' : 'rejected'} via ${run.interaction.composerKind || 'unknown'})` : ''}`,
        `- Time to real Theia composer: ${fmtMs(marks.composerTypeable)}${run.interaction ? ` (visible at selector check: ${run.interaction.realComposerReady ? 'yes' : 'no'})` : ''}`,
        `- Time to instant shell composer: ${fmtMs(marks.instantComposerTypeable)}`,
        `- Agent selector open → list: ${renderSelector(run.interaction)}`,
        `- Agent selector open → list once idle: ${renderSelector(run.interaction, 'idleSelector')}`,
        `- Time to IDE shell: ${fmtMs(isIdeMode(run.mode) ? milestone : undefined)}`,
        `- Navigation TTFB / DOMContentLoaded / load: ${fmtMs(navigation.responseStartMs)} / ${fmtMs(navigation.domContentLoadedMs)} / ${fmtMs(navigation.loadMs)}`,
        `- Navigation transfer / decoded: ${navigation.transferSize ?? '—'} / ${navigation.decodedBodySize ?? '—'} bytes`,
        `- DOM state: ${safeText(JSON.stringify(run.metrics.documentState))}`,
        `- Work Hub startup-ready event: ${fmtMs(marks.startupReady)}`,
        `- Work Hub root / composer in DOM / splash hidden: ${fmtMs(marks.workHubInDom)} / ${fmtMs(marks.composerInDom)} / ${fmtMs(marks.splashHidden)}`,
        `- Observed frontend startup logs: ${run.consoleMessages.length ? run.consoleMessages.map(value => `\`${safeText(value)}\``).join('; ') : 'none'}`,
        `- Slowest /services RPCs: ${run.rpcTimings.length ? run.rpcTimings.slice(0, 10).map(rpc => `\`${safeText(rpc.method)} ${rpc.durationMs} ms\``).join(', ') : 'not observed'}`,
        '',
        '| Request | Start | Duration | Encoded / decoded bytes | Status | Cache | Source |',
        '|---|---:|---:|---:|---:|---|---|',
        ...[...run.resources]
            .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
            .slice(0, 25)
            .map(resource => `| ${safeText(new URL(resource.name).pathname + new URL(resource.name).search)} | ${fmtMs(resource.startMs)} | ${fmtMs(resource.durationMs)} | ${resource.transferBytes ?? '—'} / ${resource.decodedBytes ?? '—'} | ${resource.status ?? '—'} | ${safeText(resource.cacheControl || '—')} | ${resource.fromServiceWorker ? 'service worker' : resource.fromDiskCache ? 'disk cache' : resource.transferBytes === 0 ? 'memory/cache' : 'network'} |`),
        '',
    ];
    return lines.join('\n');
}

/**
 * Playwright's default browser cache is `~/.cache/ms-playwright`. Sandboxes that keep their
 * browsers and the shared libraries chromium needs elsewhere (no root to apt-get them) set
 * QAAP_PERF_CHROMIUM_PATH / QAAP_PERF_CHROMIUM_LIB_DIR, or keep them under
 * `~/.cache/playwright` and `~/.cache/chromium-runtime`.
 */
function resolveLaunchOptions() {
    const options = { headless: true };
    const home = os.homedir();
    const executable = process.env.QAAP_PERF_CHROMIUM_PATH
        || (existsSync(chromium.executablePath()) ? undefined : findHeadlessShell(path.join(home, '.cache', 'playwright')));
    if (executable) {
        options.executablePath = executable;
    }
    const runtime = process.env.QAAP_PERF_CHROMIUM_LIB_DIR || path.join(home, '.cache', 'chromium-runtime');
    const libDirs = [path.join(runtime, 'usr', 'lib', 'x86_64-linux-gnu'), path.join(runtime, 'lib', 'x86_64-linux-gnu'), runtime]
        .filter(dir => existsSync(dir));
    if (libDirs.length) {
        options.env = { ...process.env, LD_LIBRARY_PATH: [...libDirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
    }
    return options;
}

function findHeadlessShell(root) {
    const revision = existsSync(root)
        ? (readdirSync(root).filter(name => name.startsWith('chromium_headless_shell-')).sort().pop())
        : undefined;
    const candidate = revision && path.join(root, revision, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    return candidate && existsSync(candidate) ? candidate : undefined;
}

async function main() {
    const validModes = new Set(['work-hub', 'ide', 'ide-mobile']);
    if (!MODES.length || MODES.some(mode => !validModes.has(mode))) {
        throw new Error(`QAAP_PERF_MODES must contain work-hub, ide and/or ide-mobile; received: ${MODES.join(', ')}`);
    }
    const browser = await chromium.launch(resolveLaunchOptions());
    const results = [];
    try {
        for (const mode of MODES) {
            results.push(...await measureMode(browser, mode));
        }
    } finally {
        await browser.close();
    }

    const date = new Date().toISOString();
    const section = [
        `## ${PHASE === 'baseline' ? 'Baseline' : PHASE} — ${date}`,
        '',
        `Endpoint: ${BASE_URL}`, 
        `Build: ${BUILD_SHA}`,
        `Authentication: ${AUTH_METHOD}`,
        `Service workers: ${SERVICE_WORKERS === 'block' ? 'blocked (every request throttled; HTTP cache only on warm reload)' : 'allowed (worker fetches bypass CDP throttling; numbers are optimistic)'}`,
        '',
        `Network: ${NETWORK === '4g' ? '4G emulation (150 ms RTT, 1.6 Mbps down)' : 'unthrottled'}`,
        '',
        '| Mode | Navigation | Logo | First usable composer | Theia composer | IDE workbench | Selector open → list | Selector once idle | Document loads | Outcome |',
        '|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
        ...results.map(run => {
            const marks = run.metrics.marks;
            const expected = isIdeMode(run.mode) ? marks.ideShell : marks.firstUsableComposer;
            const outcome = expected !== undefined ? 'ready' : run.loginRequired ? 'auth gate; startup not measurable' : 'milestone not reached';
            return `| ${run.mode} | ${run.navigation} | ${fmtMs(marks.logo)} | ${fmtMs(run.mode === 'work-hub' ? expected : undefined)} | ${fmtMs(run.mode === 'work-hub' ? marks.composerTypeable : undefined)} | ${fmtMs(isIdeMode(run.mode) ? expected : undefined)} | ${run.mode === 'work-hub' ? renderSelector(run.interaction) : '—'} | ${run.mode === 'work-hub' ? renderSelector(run.interaction, 'idleSelector') : '—'} | ${run.documentLoads} | ${outcome} |`;
        }),
        '',
        ...results.map(renderRun),
    ].join('\n');

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    // Always append: a later run must never erase the measurements it is compared against.
    await fs.appendFile(OUTPUT, `\n\n${section}\n`, 'utf8');
    console.log(`Saved ${PHASE} performance measurements to ${OUTPUT}`);
}

main().catch(error => {
    // A top-level rejection only printed "Error at line 416"; say what failed and how to fix it.
    console.error(`qaap-perf-baseline failed: ${error?.message?.split('\n')[0] ?? error}`);
    if (/Executable doesn't exist|error while loading shared libraries/.test(String(error?.message))) {
        console.error('Set QAAP_PERF_CHROMIUM_PATH and QAAP_PERF_CHROMIUM_LIB_DIR, or run `npx playwright install --with-deps chromium`.');
    }
    process.exitCode = 1;
});

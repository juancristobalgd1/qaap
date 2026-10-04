#!/usr/bin/env node

import { chromium, devices } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.QAAP_PERF_URL || 'https://161.97.69.219.sslip.io/';
const OUTPUT = process.env.QAAP_PERF_OUTPUT || '/workspace/logs/perf-baseline.md';
const PHASE = process.env.QAAP_PERF_PHASE || 'baseline';
const MODES = (process.env.QAAP_PERF_MODES || 'work-hub,ide').split(',').map(mode => mode.trim()).filter(Boolean);
const BUILD_SHA = process.env.QAAP_PERF_BUILD_SHA || 'not specified';
const AUTH_METHOD = process.env.QAAP_PERF_AUTH_METHOD
    || (process.env.QAAP_PERF_STORAGE_STATE ? 'Playwright storage state (QAAP_PERF_STORAGE_STATE)' : 'not specified');
const MILESTONE_TIMEOUT_MS = Number(process.env.QAAP_PERF_MILESTONE_TIMEOUT_MS || 120_000);
const AUTH_SETTLE_MS = 3_000;
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const IDE_VIEWPORT = { width: 1280, height: 900 };
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

        const appShell = document.getElementById('theia-app-shell');
        const mainPanel = document.getElementById('theia-main-content-panel');
        const workHubVisible = [...document.querySelectorAll('.theia-mobile-projects-sticky-composer-input')].some(visible);
        if (visible(appShell) && visible(mainPanel)
            && !appShell.classList.contains('theia-mod-mobile-one-column')
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
    await cdp.send('Network.emulateNetworkConditions', FOUR_G);
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
    const target = mode === 'work-hub' ? 'workHubInteractive' : 'ideShell';
    await page.waitForFunction(({ target }) => {
        const marks = window.__qaapPerfMarks || {};
        return marks[target] !== undefined || marks.loginGate !== undefined;
    }, { target }, { timeout: MILESTONE_TIMEOUT_MS }).catch(() => undefined);
    const gateVisible = await page.locator('#qaap-login-host').isVisible().catch(() => false);
    if (gateVisible) await page.waitForTimeout(AUTH_SETTLE_MS);
    return gateVisible;
}

async function captureNavigation(browser, mode, navigation) {
    const isIde = mode === 'ide';
    const contextOptions = {
        ...devices['Pixel 7'],
        viewport: isIde ? IDE_VIEWPORT : MOBILE_VIEWPORT,
        serviceWorkers: 'allow',
    };
    if (process.env.QAAP_PERF_STORAGE_STATE) {
        contextOptions.storageState = process.env.QAAP_PERF_STORAGE_STATE;
    }
    const context = await browser.newContext(contextOptions);
    const ideSessionSeed = mode === 'ide' ? "sessionStorage.setItem('qaap.mobileProjects.preferDesktopIde', '1');\n" : '';
    await context.addInitScript(`${ideSessionSeed}${initMarks}`);

    const page = await context.newPage();
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
        viewport: contextOptions.viewport,
        loginRequired,
        metrics,
        resources,
        rpcTimings: network.rpcTimings.sort((a, b) => b.durationMs - a.durationMs),
        consoleMessages,
    };

    return { result, context, page, network };
}

async function measureMode(browser, mode) {
    const { result: cold, context, page, network } = await captureNavigation(browser, mode, 'cold');
    const consoleMessages = [...cold.consoleMessages];
    await page.waitForTimeout(1_000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    const loginRequired = await waitForMilestone(page, mode);
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
        viewport: cold.viewport,
        loginRequired: loginRequired || cold.loginRequired,
        metrics,
        resources,
        rpcTimings: network.rpcTimings.sort((a, b) => b.durationMs - a.durationMs),
        consoleMessages,
    };
    await network.cdp.detach();
    await context.close();
    return [cold, warm];
}

function renderRun(run) {
    const readyKey = run.mode === 'work-hub' ? 'workHubInteractive' : 'ideShell';
    const marks = run.metrics.marks;
    const milestone = marks[readyKey];
    const status = milestone !== undefined ? 'ready' : run.loginRequired ? 'login required' : 'not reached';
    const navigation = run.metrics.navigation || {};
    const lines = [
        `### ${run.mode} — ${run.navigation}`,
        '',
        `- Viewport: ${run.viewport.width}×${run.viewport.height}; throttling: 4G (150 ms RTT, 1.6 Mbps down, 750 Kbps up).`,
        `- Result: ${status}`,
        `- Time to logo: ${fmtMs(marks.logo)}`,
        `- Time to first interactive Work Hub screen: ${fmtMs(run.mode === 'work-hub' ? milestone : undefined)}`,
        `- Time to IDE shell: ${fmtMs(run.mode === 'ide' ? milestone : undefined)}`,
        `- Navigation TTFB / DOMContentLoaded / load: ${fmtMs(navigation.responseStartMs)} / ${fmtMs(navigation.domContentLoadedMs)} / ${fmtMs(navigation.loadMs)}`,
        `- Navigation transfer / decoded: ${navigation.transferSize ?? '—'} / ${navigation.decodedBodySize ?? '—'} bytes`,
        `- DOM state: ${safeText(JSON.stringify(run.metrics.documentState))}`,
        `- Work Hub startup-ready event: ${fmtMs(marks.startupReady)}`,
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

async function main() {
    const validModes = new Set(['work-hub', 'ide']);
    if (!MODES.length || MODES.some(mode => !validModes.has(mode))) {
        throw new Error(`QAAP_PERF_MODES must contain work-hub and/or ide; received: ${MODES.join(', ')}`);
    }
    const browser = await chromium.launch({ headless: true });
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
        '',
        '| Mode | Navigation | Logo | Work Hub usable | IDE shell | Outcome |',
        '|---|---|---:|---:|---:|---|',
        ...results.map(run => {
            const marks = run.metrics.marks;
            const expected = run.mode === 'work-hub' ? marks.workHubInteractive : marks.ideShell;
            const outcome = expected !== undefined ? 'ready' : run.loginRequired ? 'auth gate; startup not measurable' : 'milestone not reached';
            return `| ${run.mode} | ${run.navigation} | ${fmtMs(marks.logo)} | ${fmtMs(run.mode === 'work-hub' ? expected : undefined)} | ${fmtMs(run.mode === 'ide' ? expected : undefined)} | ${outcome} |`;
        }),
        '',
        ...results.map(renderRun),
    ].join('\n');

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    if (PHASE !== 'baseline') {
        const existing = await fs.readFile(OUTPUT, 'utf8').catch(() => '');
        await fs.writeFile(OUTPUT, `${existing}\n\n${section}\n`, 'utf8');
    } else {
        await fs.writeFile(OUTPUT, `${section}\n`, 'utf8');
    }
    console.log(`Saved ${PHASE} performance measurements to ${OUTPUT}`);
}

await main();

// *****************************************************************************
// Qaap per-section preview audit — runtime metrics for desktop + mobile.
// Runs against a live Qaap instance at http://localhost:3000.
// Exercises: open 2 projects, trigger each preview, switch between them, verify
// isolation (independent iframes + ports), measure TTI/TTFT/TTP/RAM/FPS/console errors.
// *****************************************************************************

import { chromium, devices } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'examples/playwright/src/tests/resources');
const VITE_FIXTURE = path.join(RESOURCES, 'qaap-vite-fixture');
const NEXT_FIXTURE = path.join(RESOURCES, 'qaap-next-fixture');
const QAAP_URL = process.env.QAAP_URL || 'http://localhost:3000';

function ensureFixtureDeps(cwd) {
    if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
        execSync('npm install --no-audit --no-fund', {
            cwd,
            stdio: 'inherit',
            timeout: 180_000,
            env: { ...process.env, NODE_ENV: 'development' },
        });
    }
}

function killPort(port) {
    try { execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' }); } catch { /* free */ }
}

// Collect performance metrics from a page via CDP + Performance API.
async function collectMetrics(context, page, label) {
    const client = await context.newCDPSession(page);
    // Enable Performance + GC tracking
    await client.send('Performance.enable');
    const perfMetrics = await client.send('Performance.getMetrics');
    // Performance API timings
    const nav = await page.evaluate(() => {
        const [entry] = performance.getEntriesByType('navigation');
        if (!entry) return null;
        return {
            domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
            load: Math.round(entry.loadEventEnd),
            domInteractive: Math.round(entry.domInteractive),
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
        };
    });
    // JS heap (RAM) — only available in Chromium with client.send
    const heap = perfMetrics.metrics.find(m => m.name === 'JSHeapUsedSize');
    const jsHeapTotal = perfMetrics.metrics.find(m => m.name === 'JSHeapTotalSize');
    const nodes = perfMetrics.metrics.find(m => m.name === 'Nodes');
    const listeners = perfMetrics.metrics.find(m => m.name === 'JSEventListeners');
    // FPS sample via rAF over 1s
    const fps = await page.evaluate(async () => {
        return new Promise(resolve => {
            let frames = 0;
            const start = performance.now();
            const tick = () => {
                frames++;
                if (performance.now() - start < 1000) {
                    requestAnimationFrame(tick);
                } else {
                    resolve(Math.round(frames * 1000 / (performance.now() - start)));
                }
            };
            requestAnimationFrame(tick);
        });
    });
    // Count console errors accumulated so far
    const errors = page._qaapErrors || [];
    return {
        label,
        nav,
        jsHeapUsedMB: heap ? Math.round(heap.value / 1024 / 1024) : null,
        jsHeapTotalMB: jsHeapTotal ? Math.round(jsHeapTotal.value / 1024 / 1024) : null,
        domNodes: nodes ? nodes.value : null,
        eventListeners: listeners ? listeners.value : null,
        fps,
        consoleErrors: errors.length,
        consoleErrorSamples: errors.slice(0, 5),
    };
}

async function dismissTutorial(page) {
    const skip = page.locator('button').filter({ hasText: /^skip$/i }).first();
    if (await skip.count()) { await skip.click(); }
}

async function openProjectAndTriggerPreview(page, projectName, prompt) {
    const t0 = Date.now();
    // Wait for composer
    await page.locator('.theia-mobile-projects-sticky-composer-input').first().waitFor({ state: 'visible', timeout: 60_000 });
    const composer = page.locator('.theia-mobile-projects-sticky-composer-input').first();
    await composer.fill(prompt);
    await page.getByRole('button', { name: /^send$|^create$/i }).first().click();
    // Wait for the task heading
    await page.getByRole('heading', { name: new RegExp(prompt, 'i') }).first().waitFor({ state: 'visible', timeout: 60_000 });
    // Wait for preview iframe to appear with a qaap-dev or qaap-preview src
    await page.waitForSelector('iframe[src*="qaap-dev/"], iframe[src*="qaap-preview/"]', { timeout: 180_000 });
    const ttp = Date.now() - t0;
    return { ttp };
}

async function snapshotPreviewState(page) {
    return page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe[src*="qaap-dev/"], iframe[src*="qaap-preview/"]'));
        const offscreen = document.querySelector('#qaap-preview-offscreen-host');
        return {
            visiblePreviewIframes: iframes.filter(f => f.offsetParent !== null).length,
            totalPreviewIframes: iframes.length,
            offscreenIframes: offscreen ? offscreen.querySelectorAll('iframe').length : 0,
            offscreenHostExists: !!offscreen,
            previewSrcs: iframes.map(f => f.getAttribute('src')).slice(0, 5),
        };
    });
}

async function runAudit(viewportLabel, viewport, deviceName) {
    console.log(`\n========== ${viewportLabel.toUpperCase()} AUDIT ==========`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport,
        ...(deviceName ? devices[deviceName] : {}),
    });
    const page = await context.newPage();
    page._qaapErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            page._qaapErrors.push(msg.text().slice(0, 200));
        }
    });
    page.on('pageerror', err => {
        page._qaapErrors.push(`pageerror: ${err.message.slice(0, 200)}`);
    });

    const results = { viewport: viewportLabel, steps: [], metrics: [] };

    try {
        // --- Step 1: load Qaap (TTI / TTFT) ---
        const navStart = Date.now();
        await page.goto(QAAP_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        const tti = Date.now() - navStart;
        // Wait for Work Hub shell ready
        await page.waitForSelector('.theia-mobile-projects-sticky-composer-input, .theia-mobile-work-hub', { timeout: 120_000 });
        const ttft = Date.now() - navStart;
        await dismissTutorial(page);
        results.steps.push({ step: 'initial-load', ttiMs: tti, ttftMs: ttft });
        console.log(`[load] TTI=${tti}ms TTFT(Work Hub ready)=${ttft}ms`);

        // --- Step 2: open project A (Vite) and trigger preview ---
        killPort(5173);
        ensureFixtureDeps(VITE_FIXTURE);
        const aStart = Date.now();
        const aResult = await openProjectAndTriggerPreview(page, 'vite-fixture', 'levanta la app');
        const aMetrics = await collectMetrics(context, page, 'project-A-vite-preview');
        const aState = await snapshotPreviewState(page);
        results.steps.push({ step: 'open-project-A', ttpMs: aResult.ttp, previewState: aState });
        results.metrics.push(aMetrics);
        console.log(`[project A] TTP=${aResult.ttp}ms iframes=${aState.totalPreviewIframes} visible=${aState.visiblePreviewIframes} offscreen=${aState.offscreenIframes}`);
        console.log(`[project A] heap=${aMetrics.jsHeapUsedMB}MB fps=${aMetrics.fps} consoleErrors=${aMetrics.consoleErrors}`);

        // --- Step 3: open project B (Next) in a second section — switch away from A ---
        // For the audit we simulate switching by going back to Work Hub and starting a new task.
        // In the real product this would be a second project card; here we drive the composer again.
        // NOTE: This exercises the suspend/park path for project A's iframe.
        killPort(3456);
        ensureFixtureDeps(NEXT_FIXTURE);
        // Go back to Work Hub root (collapse the open transcript)
        const backButton = page.locator('[data-qaap-back-to-hub], .theia-mobile-back-button, button').filter({ hasText: /back|hub|projects/i }).first();
        if (await backButton.count()) {
            await backButton.click().catch(() => {});
        }
        const bStart = Date.now();
        const bResult = await openProjectAndTriggerPreview(page, 'next-fixture', 'levanta la next app');
        const bMetrics = await collectMetrics(context, page, 'project-B-next-preview');
        const bState = await snapshotPreviewState(page);
        results.steps.push({ step: 'open-project-B', ttpMs: bResult.ttp, previewState: bState });
        results.metrics.push(bMetrics);
        console.log(`[project B] TTP=${bResult.ttp}ms iframes=${bState.totalPreviewIframes} visible=${bState.visiblePreviewIframes} offscreen=${bState.offscreenIframes}`);
        console.log(`[project B] heap=${bMetrics.jsHeapUsedMB}MB fps=${bMetrics.fps} consoleErrors=${bMetrics.consoleErrors}`);

        // --- Step 4: isolation check — are A and B on different ports/srcs? ---
        const isolation = {
            aSrcs: aState.previewSrcs,
            bSrcs: bState.previewSrcs,
            distinctPorts: aState.previewSrcs.some(s => bState.previewSrcs.every(t => t !== s)),
            aPreservedOffscreen: aState.offscreenIframes > 0,
        };
        results.steps.push({ step: 'isolation-check', ...isolation });
        console.log(`[isolation] distinctPorts=${isolation.distinctPorts} aPreservedOffscreen=${isolation.aPreservedOffscreen}`);
        console.log(`[isolation] A srcs=${JSON.stringify(aState.previewSrcs)}`);
        console.log(`[isolation] B srcs=${JSON.stringify(bState.previewSrcs)}`);

    } catch (err) {
        results.error = err.message;
        console.error(`AUDIT ERROR (${viewportLabel}):`, err.message);
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
    return results;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

const desktopResults = await runAudit('desktop', DESKTOP, undefined);
const mobileResults = await runAudit('mobile', MOBILE, 'iPhone 13');

const report = {
    timestamp: new Date().toISOString(),
    qaapUrl: QAAP_URL,
    desktop: desktopResults,
    mobile: mobileResults,
};

const outPath = path.join(ROOT, '.dbg', 'qaap-preview-per-section-audit-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\n========== AUDIT COMPLETE ==========`);
console.log(`Report written to: ${outPath}`);
console.log(JSON.stringify({
    desktop: { tti: desktopResults.steps[0]?.ttiMs, error: desktopResults.error },
    mobile: { tti: mobileResults.steps[0]?.ttiMs, error: mobileResults.error },
}, null, 2));

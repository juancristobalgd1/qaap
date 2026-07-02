#!/usr/bin/env node
/**
 * Work Hub composer audit — runs the 5 mandatory prompts via createConversation
 * (same path as submitBackgroundAgentTask), not the chat panel FastPath harness.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { execSync } from 'child_process';

const URL = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';
const WORKSPACE = process.env.QAAP_AUDIT_CWD ?? '/Users/jc/qaap';
const MAX_WAIT_MS = 900_000; // 15 min for full suite (task 5 can be slow)
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function resolveBundlePaths() {
    const root = '/Users/jc/qaap/examples/browser/lib/frontend';
    return {
        js: `${root}/bundle.js`,
        css: `${root}/bundle.css`,
    };
}

async function main() {
    const report = {
        timestamp: new Date().toISOString(),
        pipeline: 'work-hub-composer',
        workspace: WORKSPACE,
        bundle: {},
        tasks: [],
        system: {},
    };

    const bundlePaths = resolveBundlePaths();
    console.log('[WH-AUDIT] Measuring bundle size...');
    try {
        if (fs.existsSync(bundlePaths.js)) {
            const jsStat = fs.statSync(bundlePaths.js);
            report.bundle.jsBytes = jsStat.size;
            report.bundle.jsMB = (jsStat.size / 1024 / 1024).toFixed(2);
            try {
                const jsGz = execSync(`gzip -c "${bundlePaths.js}" | wc -c`, { encoding: 'utf8' }).trim();
                report.bundle.jsGzipKB = (parseInt(jsGz, 10) / 1024).toFixed(0);
            } catch { /* optional */ }
        } else {
            report.bundle.jsMissing = bundlePaths.js;
        }
        if (fs.existsSync(bundlePaths.css)) {
            const cssStat = fs.statSync(bundlePaths.css);
            report.bundle.cssBytes = cssStat.size;
            report.bundle.cssMB = (cssStat.size / 1024 / 1024).toFixed(2);
        }
    } catch (error) {
        report.bundle.error = String(error).slice(0, 200);
    }
    console.log('[WH-AUDIT] Bundle:', JSON.stringify(report.bundle));

    const launchOptions = {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
    if (fs.existsSync(CHROME)) {
        launchOptions.executablePath = CHROME;
    }

    console.log('[WH-AUDIT] Launching browser...');
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    page.setDefaultTimeout(MAX_WAIT_MS);

    const consoleLines = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLines.push(text);
        if (text.includes('QAAP-METRICS') || text.includes('WH-RESULT') || text.includes('FastPath')) {
            console.log('[PAGE]', text.slice(0, 240));
        }
    });
    page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));

    const targetUrl = `${URL}#/${encodeURIComponent(WORKSPACE)}`;
    console.log(`[WH-AUDIT] Navigating to ${targetUrl} ...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 120_000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60_000 });
    console.log('[WH-AUDIT] Shell loaded, waiting 15s for init...');
    await new Promise(r => setTimeout(r, 15_000));

    const memBefore = await page.evaluate(() => ({
        usedJSMB: performance.memory?.usedJSHeapSize / 1024 / 1024,
        totalJSMB: performance.memory?.totalJSHeapSize / 1024 / 1024,
    }));
    report.system.memBefore = memBefore;

    const ready = await page.evaluate(() => ({
        hasMetrics: !!window.__qaapMetrics?.runWorkHubAuditSuite,
    }));
    if (!ready.hasMetrics) {
        throw new Error('window.__qaapMetrics.runWorkHubAuditSuite not found — rebuild browser bundle');
    }

    console.log('[WH-AUDIT] Starting Work Hub audit suite...');
    await page.evaluate(() => {
        window.__qaapMetrics.runWorkHubAuditSuite().catch(error =>
            console.error('[WH-AUDIT] runWorkHubAuditSuite FAILED:', String(error)),
        );
    });

    const startTime = Date.now();
    let completed = false;
    while (!completed && Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(r => setTimeout(r, 5000));
        const status = await page.evaluate(() => ({
            status: window.__qaapMetrics?.getStatus?.() ?? 'unknown',
            count: (window.__qaapMetrics?.getWorkHubAuditResults?.() ?? []).length,
            progress: window.__qaapMetrics?.getProgress?.() ?? '',
        }));
        if (status.status === 'idle' && status.count >= 5) {
            completed = true;
            console.log(`[WH-AUDIT] Suite completed — ${status.count} tasks`);
        } else {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            console.log(`[WH-AUDIT] ${elapsed}s — status=${status.status} count=${status.count} | ${status.progress}`);
        }
    }

    const memAfter = await page.evaluate(() => ({
        usedJSMB: performance.memory?.usedJSHeapSize / 1024 / 1024,
        totalJSMB: performance.memory?.totalJSHeapSize / 1024 / 1024,
    }));
    report.system.memAfter = memAfter;
    report.system.memDeltaMB = (memAfter.usedJSMB - memBefore.usedJSMB).toFixed(2);

    report.tasks = await page.evaluate(() => window.__qaapMetrics?.getWorkHubAuditResults?.() ?? []);

    await browser.close();

    const reportPath = '/Users/jc/qaap/qaap-work-hub-audit.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[WH-AUDIT] Report saved to ${reportPath}`);

    console.log('\n[WH-AUDIT] === SUMMARY ===\n');
    console.log('| Task | Agent | Fast | Total (ms) | Tools | Reason |');
    console.log('|------|-------|------|------------|-------|--------|');
    for (const task of report.tasks) {
        console.log(`| ${task.description?.slice(0, 24).padEnd(24)} | ${String(task.agentId).padEnd(5)} | ${task.fastPath ? 'yes' : 'no '} | ${String(task.totalMs).padStart(10)} | ${String(task.toolCalls).padStart(5)} | ${task.reason} |`);
    }
    const success = report.tasks.filter(task => task.reason === 'success').length;
    const fast = report.tasks.filter(task => task.fastPath).length;
    console.log(`\n[WH-AUDIT] ${success}/${report.tasks.length} success | ${fast}/${report.tasks.length} fast-path`);
    if (!completed) {
        console.warn('[WH-AUDIT] WARNING: suite timed out before all tasks finished');
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error('[WH-AUDIT] Fatal:', err);
    process.exit(1);
});

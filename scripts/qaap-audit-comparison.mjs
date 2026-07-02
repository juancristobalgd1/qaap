#!/usr/bin/env node
/**
 * Qaap Full Audit — captures task metrics + memory + CPU + bundle size.
 * Outputs a structured JSON report for BEFORE vs AFTER comparison.
 */
import puppeteer from 'puppeteer';
import { execSync } from 'child_process';
import fs from 'node:fs';

const URL = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';

async function main() {
    const report = {
        timestamp: new Date().toISOString(),
        bundle: {},
        tasks: [],
        system: {},
    };

    // --- Bundle size ---
    console.log('[AUDIT] Measuring bundle size...');
    try {
        const bundlePath = '/Users/jc/qaap/examples/browser/lib/frontend/bundle.js';
        const cssPath = '/Users/jc/qaap/examples/browser/lib/frontend/bundle.css';
        if (fs.existsSync(bundlePath)) {
            const jsStat = fs.statSync(bundlePath);
            report.bundle.jsBytes = jsStat.size;
            report.bundle.jsMB = (jsStat.size / 1024 / 1024).toFixed(2);
        }
        if (fs.existsSync(cssPath)) {
            const cssStat = fs.statSync(cssPath);
            report.bundle.cssBytes = cssStat.size;
            report.bundle.cssMB = (cssStat.size / 1024 / 1024).toFixed(2);
        }
        // Gzip estimates
        try {
            const jsGz = execSync(`gzip -c ${bundlePath} | wc -c`, { encoding: 'utf8' }).trim();
            report.bundle.jsGzipKB = (parseInt(jsGz) / 1024).toFixed(0);
        } catch { }
        try {
            const cssGz = execSync(`gzip -c ${cssPath} | wc -c`, { encoding: 'utf8' }).trim();
            report.bundle.cssGzipKB = (parseInt(cssGz) / 1024).toFixed(0);
        } catch { }
    } catch (e) {
        report.bundle.error = String(e).slice(0, 200);
    }
    console.log('[AUDIT] Bundle:', JSON.stringify(report.bundle));

    // --- Launch browser & run tests ---
    console.log('[AUDIT] Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(300_000);

    const consoleLines = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLines.push(text);
        if (text.includes('QAAP-METRICS') || text.includes('FastPath')) {
            console.log('[PAGE]', text.slice(0, 200));
        }
    });
    page.on('pageerror', err => console.error('[PAGE ERROR]', err.message));

    // Navigate
    console.log(`[AUDIT] Navigating to ${URL} ...`);
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120_000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60_000 });
    console.log('[AUDIT] Shell loaded, waiting 15s for init...');
    await new Promise(r => setTimeout(r, 15_000));

    // --- Memory before tests ---
    const memBefore = await page.evaluate(() => ({
        usedJSMB: performance.memory?.usedJSHeapSize / 1024 / 1024,
        totalJSMB: performance.memory?.totalJSHeapSize / 1024 / 1024,
        limitJSMB: performance.memory?.jsHeapSizeLimit / 1024 / 1024,
    }));
    report.system.memBefore = memBefore;
    console.log('[AUDIT] Memory before tests:', JSON.stringify(memBefore));

    // --- Run test suite ---
    console.log('[AUDIT] Running test suite...');
    await page.evaluate(() => {
        if (window.__qaapMetrics) {
            window.__qaapMetrics.runTestSuite().catch(e =>
                console.error('[AUDIT] runTestSuite FAILED:', String(e))
            );
        }
    });

    // Wait for completion
    const startTime = Date.now();
    let completed = false;
    while (!completed && Date.now() - startTime < 300_000) {
        await new Promise(r => setTimeout(r, 5000));
        const status = await page.evaluate(() => ({
            status: window.__qaapMetrics?.getStatus?.() ?? 'unknown',
            count: (window.__qaapMetrics?.getAllMetrics?.() ?? []).length,
        }));
        if (status.status === 'idle' && status.count > 0) {
            completed = true;
            console.log(`[AUDIT] Suite completed — ${status.count} tasks`);
        } else {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            console.log(`[AUDIT] ${elapsed}s — status=${status.status} | count=${status.count}`);
        }
    }

    // --- Memory after tests ---
    const memAfter = await page.evaluate(() => ({
        usedJSMB: performance.memory?.usedJSHeapSize / 1024 / 1024,
        totalJSMB: performance.memory?.totalJSHeapSize / 1024 / 1024,
        limitJSMB: performance.memory?.jsHeapSizeLimit / 1024 / 1024,
    }));
    report.system.memAfter = memAfter;
    report.system.memDeltaMB = (memAfter.usedJSMB - memBefore.usedJSMB).toFixed(2);
    console.log('[AUDIT] Memory after tests:', JSON.stringify(memAfter));
    console.log(`[AUDIT] Memory delta: ${report.system.memDeltaMB} MB`);

    // --- CPU profile (rough) ---
    const cpuMetrics = await page.metrics();
    report.system.cpu = {
        taskDuration: (cpuMetrics.TaskDuration / 1000).toFixed(2) + 's',
        jsHeapUsed: (cpuMetrics.JSHeapUsedSize / 1024 / 1024).toFixed(2) + 'MB',
        jsHeapTotal: (cpuMetrics.JSHeapTotalSize / 1024 / 1024).toFixed(2) + 'MB',
    };
    console.log('[AUDIT] CPU metrics:', JSON.stringify(report.system.cpu));

    // --- Collect task metrics ---
    const pageMetrics = await page.evaluate(() =>
        window.__qaapMetrics?.getAllMetrics?.() ?? []
    );

    for (const m of pageMetrics) {
        const totalMs = m.endTime - m.startTime;
        report.tasks.push({
            description: m.taskDescription,
            agentId: m.agentId,
            totalMs: parseFloat(totalMs.toFixed(0)),
            ttftMs: m.ttftMs,
            timeToFirstResponseMs: m.timeToFirstResponseMs,
            timeToFirstToolMs: m.timeToFirstToolMs,
            toolCalls: m.toolCalls,
            toolCallsByType: m.toolCallsByType,
            error: m.error ?? null,
            reason: m.reason,
        });
    }

    // --- Count registered tools ---
    const toolCount = await page.evaluate(() => {
        // Try to count via ToolInvocationRegistry if accessible
        try {
            const registry = window.__qaapToolRegistry;
            if (registry && registry.getAllFunctions) {
                return registry.getAllFunctions().length;
            }
        } catch { }
        return null;
    });
    report.system.registeredTools = toolCount;

    await browser.close();

    // --- Print report ---
    const reportPath = '/Users/jc/qaap/qaap-audit-after.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[AUDIT] Report saved to ${reportPath}`);

    // --- Print summary table ---
    console.log('\n[AUDIT] === AUDIT SUMMARY ===\n');
    console.log('Bundle:');
    console.log(`  JS: ${report.bundle.jsMB} MB (${report.bundle.jsGzipKB} KB gzip)`);
    console.log(`  CSS: ${report.bundle.cssMB} MB (${report.bundle.cssGzipKB} KB gzip)`);
    console.log('\nMemory:');
    console.log(`  Before: ${memBefore.usedJSMB?.toFixed(1)} MB used`);
    console.log(`  After:  ${memAfter.usedJSMB?.toFixed(1)} MB used`);
    console.log(`  Delta:  ${report.system.memDeltaMB} MB`);
    console.log('\nTasks:');
    for (const t of report.tasks) {
        console.log(`  ${t.description.padEnd(30)} | agent=${t.agentId} | total=${t.totalMs}ms | firstTool=${t.timeToFirstToolMs}ms | tools=${t.toolCalls} | error=${t.error}`);
    }
    console.log('\n[AUDIT] Done.');
}

main().catch(err => {
    console.error('[AUDIT] Fatal:', err);
    process.exit(1);
});

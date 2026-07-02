#!/usr/bin/env node
/**
 * Qaap Agent Metrics Runner — uses Puppeteer to load the IDE, execute the
 * test-harness command, and collect console output with real metrics.
 */
import puppeteer from 'puppeteer';

const URL = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';
const COMMAND_ID = 'qaap.metrics.run-test';
const MAX_WAIT_MS = 300_000; // 5 minutes max for quick 3-task suite

async function main() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(MAX_WAIT_MS);

    // Collect console output
    const consoleLines = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLines.push(text);
        // Print QAAP-METRICS lines and any errors to our stdout
        if (text.includes('QAAP-METRICS') || text.includes('FLOW-TRACE') || text.includes('error') || text.includes('Error')) {
            console.log('[PAGE]', text);
        }
    });
    page.on('pageerror', err => {
        console.error('[PAGE ERROR]', err.message);
    });

    console.log(`[RUNNER] Navigating to ${URL} ...`);
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120_000 });

    // Wait for the Theia shell to load — look for the application shell element
    console.log('[RUNNER] Waiting for Theia shell to load...');
    try {
        await page.waitForSelector('#theia-app-shell', { timeout: 60_000 });
        console.log('[RUNNER] Theia shell found.');
    } catch {
        // Try alternate selector
        await page.waitForSelector('.theia-ApplicationShell', { timeout: 30_000 });
        console.log('[RUNNER] Theia shell found (alt selector).');
    }

    // Give it a few more seconds to fully initialize services
    console.log('[RUNNER] Waiting 15s for services to initialize...');
    await new Promise(r => setTimeout(r, 15_000));

    // Execute the test harness via the exposed window.__qaapMetrics
    // Fire and forget — don't await, since it takes minutes
    console.log('[RUNNER] Executing via window.__qaapMetrics...');
    const result = await page.evaluate(async () => {
        try {
            if (window.__qaapMetrics) {
                // Fire and forget with error catch
                window.__qaapMetrics.runTestSuite().catch(e =>
                    console.error('[QAAP-METRICS] runTestSuite FAILED:', String(e))
                );
                return 'started ok';
            }
            return 'window.__qaapMetrics not found';
        } catch (e) {
            return 'error: ' + String(e);
        }
    });

    console.log('[RUNNER] Command result: ' + result);

    if (result.includes('not found') || result.includes('error')) {
        console.log('[RUNNER] Fallback: trying command palette...');
        await page.keyboard.down('Control');
        await page.keyboard.down('Shift');
        await page.keyboard.press('KeyP');
        await page.keyboard.up('Shift');
        await page.keyboard.up('Control');
        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.type('Qaap: Run Agent Metrics Test', { delay: 50 });
        await new Promise(r => setTimeout(r, 500));
        await page.keyboard.press('Enter');
    }

    // Wait for the test suite to complete — look for the completion message in console
    console.log('[RUNNER] Waiting for test suite to complete (max 10 minutes)...');
    const startTime = Date.now();
    let completed = false;

    while (!completed && Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(r => setTimeout(r, 5000));
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

        // Poll the test harness status directly from the page
        const status = await page.evaluate(() => {
            if (window.__qaapMetrics) {
                return {
                    status: window.__qaapMetrics.getStatus?.() ?? 'unknown',
                    progress: window.__qaapMetrics.getProgress?.() ?? '',
                    completedCount: (window.__qaapMetrics.getAllMetrics?.() ?? []).length,
                };
            }
            return { status: 'not-found', progress: '', completedCount: 0 };
        });

        const metricsLines = consoleLines.filter(l => l.includes('QAAP-METRICS'));
        const hasComplete = metricsLines.some(l => l.includes('Test suite complete')) ||
            metricsLines.some(l => l.includes('RESULTS TABLE')) ||
            status.status === 'idle' && status.completedCount > 0;

        if (hasComplete) {
            completed = true;
            console.log(`[RUNNER] Test suite completed after ${elapsed}s — ${status.completedCount} tasks completed`);
        } else {
            console.log(`[RUNNER] ${elapsed}s — status=${status.status} | progress="${status.progress}" | completed=${status.completedCount}`);
        }
    }

    if (!completed) {
        console.log('[RUNNER] TIMEOUT — test suite did not complete within 10 minutes');
    }

    // Debug: print first 50 console lines
    console.log('\n[RUNNER] === FIRST 50 CONSOLE LINES (debug) ===');
    for (let i = 0; i < Math.min(50, consoleLines.length); i++) {
        console.log(`[${i}] ${consoleLines[i].slice(0, 200)}`);
    }

    // Debug: print all error/error lines
    const errorLines = consoleLines.filter(l =>
        l.toLowerCase().includes('error') || l.toLowerCase().includes('failed') || l.toLowerCase().includes('exception')
    );
    if (errorLines.length > 0) {
        console.log('\n[RUNNER] === ERROR LINES ===');
        for (const line of errorLines.slice(0, 20)) {
            console.log(line.slice(0, 300));
        }
    }

    // Print all QAAP-METRICS lines
    console.log('\n[RUNNER] === ALL QAAP-METRICS OUTPUT ===\n');
    for (const line of consoleLines.filter(l => l.includes('QAAP-METRICS'))) {
        console.log(line);
    }

    // Print all FLOW-TRACE lines
    console.log('\n[RUNNER] === ALL FLOW-TRACE OUTPUT ===\n');
    for (const line of consoleLines.filter(l => l.includes('FLOW-TRACE'))) {
        console.log(line);
    }

    // Fetch metrics directly from the page
    const pageMetrics = await page.evaluate(() => {
        if (window.__qaapMetrics?.getAllMetrics) {
            return window.__qaapMetrics.getAllMetrics();
        }
        if (window.__qaapMetrics?.getCompletedMetrics) {
            return window.__qaapMetrics.getCompletedMetrics();
        }
        return [];
    });

    if (pageMetrics.length > 0) {
        console.log('\n[RUNNER] === METRICS FROM PAGE (JSON) ===\n');
        for (const m of pageMetrics) {
            const totalMs = m.endTime - m.startTime;
            console.log(JSON.stringify({
                taskId: m.taskId,
                description: m.taskDescription,
                complexity: m.complexity,
                agentId: m.agentId,
                totalMs: totalMs.toFixed(0),
                ttftMs: m.ttftMs.toFixed(0),
                timeToFirstToolMs: m.timeToFirstToolMs.toFixed(0),
                timeToFirstFileWriteMs: m.timeToFirstFileWriteMs.toFixed(0),
                toolCalls: m.toolCalls,
                toolCallsByType: m.toolCallsByType,
                fileReads: m.fileReads,
                fileWrites: m.fileWrites,
                inputTokens: m.inputTokens,
                outputTokens: m.outputTokens,
                totalTokens: m.totalTokens,
                stuckDetected: m.stuckDetected,
                error: m.error
            }));
        }
    }

    // Also save full console output to a file
    const fs = await import('node:fs');
    const outPath = '/Users/jc/qaap/qaap-metrics-results.txt';
    const allOutput = [...consoleLines];
    if (pageMetrics.length > 0) {
        allOutput.push('', '=== PAGE METRICS JSON ===', ...pageMetrics.map(m => JSON.stringify(m)));
    }
    fs.writeFileSync(outPath, allOutput.join('\n'), 'utf-8');
    console.log(`\n[RUNNER] Full console + metrics saved to ${outPath}`);

    await browser.close();
    console.log('[RUNNER] Done.');
}

main().catch(err => {
    console.error('[RUNNER] Fatal error:', err);
    process.exit(1);
});

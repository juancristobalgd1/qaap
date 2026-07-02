#!/usr/bin/env node
/**
 * Qaap Flow Trace Runner — sends a single real prompt and captures
 * all [FLOW-TRACE] console output with timestamps.
 */
import puppeteer from 'puppeteer';

const URL = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';
const PROMPT = process.env.QAAP_FLOW_PROMPT ?? 'Read the README.md in packages/ai-chat/ and explain what this package does in 3 sentences.';
const AGENT = process.env.QAAP_FLOW_AGENT ?? 'qaiq';
const CWD = process.env.QAAP_FLOW_CWD ?? '/Users/jc/qaap';
const MAX_WAIT_MS = 180_000; // 3 minutes max
const STREAM_WAIT_MS = parseInt(process.env.QAAP_STREAM_WAIT_MS ?? '60000', 10);

async function main() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        userDataDir: '/tmp/qaap-flow-trace-profile',
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(MAX_WAIT_MS);

    // Inject flow trace collector BEFORE any page scripts run
    await page.evaluateOnNewDocument(() => {
        window.__flowTrace = [];
        const origLog = console.log;
        const origWarn = console.warn;
        console.log = function (...args) {
            const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
            if (text.includes('FLOW-TRACE')) {
                window.__flowTrace.push(text);
            }
            origLog.apply(console, args);
        };
        console.warn = function (...args) {
            const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
            if (text.includes('FLOW-TRACE')) {
                window.__flowTrace.push(text);
            }
            origWarn.apply(console, args);
        };
    });

    const consoleLines = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLines.push(text);
        if (text.includes('FLOW-TRACE') || text.includes('QAAP-METRICS') || text.includes('FastPath')) {
            console.log('[PAGE]', text);
        }
    });
    page.on('pageerror', err => {
        console.error('[PAGE ERROR]', err.message);
    });

    console.log(`[FLOW-RUNNER] Navigating to ${URL}?_t=${Date.now()} ...`);
    await page.goto(`${URL}?_t=${Date.now()}`, { waitUntil: 'networkidle2', timeout: 120_000 });

    console.log('[FLOW-RUNNER] Waiting for Theia shell...');
    try {
        await page.waitForSelector('#theia-app-shell', { timeout: 60_000 });
    } catch {
        await page.waitForSelector('.theia-ApplicationShell', { timeout: 30_000 });
    }
    console.log('[FLOW-RUNNER] Shell found. Waiting 15s for services...');
    await new Promise(r => setTimeout(r, 15_000));

    // Debug: check what's on window
    const debugInfo = await page.evaluate(() => ({
        hasQaapMetrics: !!window.__qaapMetrics,
        keys: window.__qaapMetrics ? Object.keys(window.__qaapMetrics) : [],
    }));
    console.log('[FLOW-RUNNER] Debug:', JSON.stringify(debugInfo));

    if (!debugInfo.hasQaapMetrics) {
        console.log('[FLOW-RUNNER] __qaapMetrics not found. Waiting 10 more seconds...');
        await new Promise(r => setTimeout(r, 10_000));
        const retry = await page.evaluate(() => !!window.__qaapMetrics);
        console.log('[FLOW-RUNNER] Retry:', retry);
    }

    // Type the prompt into the composer textarea and press Enter (real user flow)
    console.log(`[FLOW-RUNNER] Looking for composer textarea...`);
    let textareaFound = false;
    for (let attempt = 0; attempt < 10; attempt++) {
        const textarea = await page.$('.theia-mobile-projects-sticky-composer-input');
        if (textarea) {
            console.log('[FLOW-RUNNER] Found composer textarea. Typing prompt...');
            await textarea.focus();
            await page.keyboard.type(PROMPT, { delay: 10 });
            console.log('[FLOW-RUNNER] Prompt typed. Pressing Enter...');
            await page.keyboard.press('Enter');
            textareaFound = true;
            break;
        }
        console.log(`[FLOW-RUNNER] Textarea not found (attempt ${attempt + 1}/10). Waiting 2s...`);
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!textareaFound) {
        console.log('[FLOW-RUNNER] Could not find composer textarea. Falling back to sendWorkHubPrompt.');
        const sendResult = await page.evaluate(async (prompt, agent, cwd) => {
            try {
                const metrics = window.__qaapMetrics;
                if (!metrics || !metrics.sendWorkHubPrompt) {
                    return 'window.__qaapMetrics or sendWorkHubPrompt not found';
                }
                return await metrics.sendWorkHubPrompt(prompt, agent, cwd);
            } catch (e) {
                return 'error: ' + String(e);
            }
        }, PROMPT, AGENT, CWD);
        console.log(`[FLOW-RUNNER] Fallback result: ${sendResult}`);
    }

    // Wait for streaming to complete (SSE/WS events: t6 first token → t9 streaming complete)
    console.log(`[FLOW-RUNNER] Waiting ${STREAM_WAIT_MS}ms for streaming completion...`);
    await new Promise(r => setTimeout(r, STREAM_WAIT_MS));

    // Read flow trace from the page's global array
    const flowLines = await page.evaluate(() => window.__flowTrace ?? []);

    // Print all FLOW-TRACE lines
    console.log('\n[FLOW-RUNNER] === ALL FLOW-TRACE OUTPUT ===\n');
    for (const line of flowLines) {
        console.log(line);
    }

    // Debug: print all console lines
    console.log('\n[FLOW-RUNNER] === ALL CONSOLE LINES ===');
    for (let i = 0; i < consoleLines.length; i++) {
        console.log(`[${i}] ${consoleLines[i].slice(0, 200)}`);
    }
    console.log(`[FLOW-RUNNER] Total console lines: ${consoleLines.length}`);

    // Save to file
    const fs = await import('node:fs');
    const outPath = '/Users/jc/qaap/qaap-flow-trace-results.txt';
    fs.writeFileSync(outPath, flowLines.join('\n'), 'utf-8');
    console.log(`\n[FLOW-RUNNER] Flow trace saved to ${outPath}`);

    await browser.close();
    console.log('[FLOW-RUNNER] Done.');
}

main().catch(err => {
    console.error('[FLOW-RUNNER] Fatal error:', err);
    process.exit(1);
});

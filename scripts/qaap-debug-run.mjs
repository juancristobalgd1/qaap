import puppeteer from 'puppeteer';

const URL = process.env.QAAP_BASE_URL ?? 'http://localhost:3000';

async function main() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log('[PAGE]', msg.text()));
    page.on('pageerror', err => console.error('[PAGEERR]', err.message));

    console.log('Navigating...');
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120_000 });
    await page.waitForSelector('#theia-app-shell', { timeout: 60_000 });
    console.log('Shell found, waiting 15s...');
    await new Promise(r => setTimeout(r, 15_000));

    // Try to call runTestSuite and capture the result
    console.log('Calling runTestSuite...');
    const result = await page.evaluate(async () => {
        try {
            console.log('[EVAL] window.__qaapMetrics =', !!window.__qaapMetrics);
            if (!window.__qaapMetrics) return 'not found';
            console.log('[EVAL] calling runTestSuite...');
            // Call and wait a bit to see if it starts
            const p = window.__qaapMetrics.runTestSuite();
            console.log('[EVAL] runTestSuite returned a promise, waiting 5s...');
            await new Promise(r => setTimeout(r, 5000));
            console.log('[EVAL] 5s passed, returning');
            return 'started';
        } catch (e) {
            return 'error: ' + String(e) + ' stack: ' + (e?.stack || '');
        }
    });
    console.log('Result:', result);

    // Wait 30s and collect output
    console.log('Waiting 30s for output...');
    await new Promise(r => setTimeout(r, 30_000));

    await browser.close();
    console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

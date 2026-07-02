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

    // Check what's on window
    const probe = await page.evaluate(() => {
        const keys = Object.keys(window).filter(k => k.startsWith('__') || k.includes('qaap') || k.includes('Qaap') || k.includes('metrics'));
        return {
            windowKeys: keys,
            hasQaapMetrics: !!window.__qaapMetrics,
            hasMonaco: !!window.monaco,
            monacoKeys: window.monaco ? Object.keys(window.monaco).slice(0, 20) : [],
        };
    });
    console.log('Probe result:', JSON.stringify(probe, null, 2));

    // Try to find the command service via theia
    const cmdProbe = await page.evaluate(() => {
        // Search for any object with executeCommand
        function findCmdService(obj, path, depth) {
            if (depth > 5 || !obj) return null;
            if (typeof obj.executeCommand === 'function') return path;
            if (typeof obj !== 'object') return null;
            for (const key of Object.keys(obj)) {
                try {
                    const result = findCmdService(obj[key], path + '.' + key, depth + 1);
                    if (result) return result;
                } catch { /* skip */ }
            }
            return null;
        }
        return findCmdService(window, 'window', 0);
    });
    console.log('Command service at:', cmdProbe);

    await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });

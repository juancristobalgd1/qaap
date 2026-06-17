#!/usr/bin/env node
/**
 * Export Playwright storageState after manual login (for headless long-turn scripts).
 *
 * Usage:
 *   QAAP_OUT=./qaap-auth.json node examples/playwright/scripts/qaap-export-auth-state.mjs
 *   QAAP_STORAGE_STATE=./qaap-auth.json QAAP_HEADLESS=1 node examples/playwright/scripts/qaap-agent-trace-long-turn-manual.mjs
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.QAAP_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT = path.resolve(process.env.QAAP_OUT ?? 'qaap-auth.json');

async function launchBrowser() {
    const opts = { headless: false, slowMo: 80 };
    try {
        return await chromium.launch(opts);
    } catch {
        return chromium.launch({ ...opts, channel: 'chrome' });
    }
}

async function main() {
    const browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    console.log(`Abre ${BASE} — inicia sesión en Work Hub, luego pulsa Enter aquí.`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await new Promise(resolve => process.stdin.once('data', resolve));
    await context.storageState({ path: OUT });
    console.log(`Guardado: ${OUT}`);
    await browser.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
